/**
 * storage.js —— localStorage 读写、导出/导入备份
 * 数据存单 key：englishSite.data.v1
 */
(function () {
  'use strict';
  window.App = window.App || {};

  const KEY = 'englishSite.data.v1';

  // 内存态（localStorage 不可用时兜底，如隐私模式）
  let memoryStore = null;

  function defaultData() {
    return {
      schemaVersion: 1,
      videos: [],
      settings: { categories: ['听力', '口语', '阅读', '语法', '词汇'] },
      updatedAt: 0   // 数据最后修改时间（同步冲突判定依据）
    };
  }

  function readLocal() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function writeLocal(data) {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      // 隐私模式/配额满 → 降级内存态
      memoryStore = data;
      return false;
    }
  }

  App.Storage = {
    KEY,

    /** 加载数据；损坏/版本不符时迁移或重置 */
    load() {
      const raw = readLocal() || memoryStore;
      const base = raw && raw.schemaVersion ? raw : defaultData();

      // 字段兜底（迁移钩子：旧数据缺字段时补默认值）
      base.schemaVersion = 1;
      base.videos = Array.isArray(base.videos) ? base.videos : [];
      if (typeof base.updatedAt !== 'number') base.updatedAt = 0;
      base.videos.forEach(v => {
        v.notes = v.notes || '';
        v.markers = Array.isArray(v.markers) ? v.markers : [];
        v.progress = v.progress && typeof v.progress.current === 'number' ? v.progress : null;
        if (v.review && typeof v.review !== 'object') v.review = null;
      });
      base.settings = base.settings || defaultData().settings;
      base.settings.categories = Array.isArray(base.settings.categories) ? base.settings.categories : [];

      if (!raw || raw.schemaVersion !== 1) {
        writeLocal(base); // 首次或迁移后落盘
      }
      return base;
    },

    /** 全量保存（自动更新数据修改时间戳，供跨设备同步判定） */
    save(data) {
      data.updatedAt = Date.now();
      writeLocal(data);
    },

    /** 保存同步元信息（lastSyncAt / lastAction），不进主数据 */
    saveSyncMeta(meta) {
      try { localStorage.setItem(KEY + '.syncMeta', JSON.stringify(meta)); } catch (e) { /* ignore */ }
    },

    /** 读取同步元信息 */
    loadSyncMeta() {
      try {
        const raw = localStorage.getItem(KEY + '.syncMeta');
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }
    },

    /** 导出备份：下载 JSON 文件 */
    exportBackup(data) {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      const d = new Date();
      const pad = n => String(n).padStart(2, '0');
      a.href = URL.createObjectURL(blob);
      a.download = `英语学习备份_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },

    /** 导入备份：解析并合并（校验结构），返回 {ok, msg} */
    importBackup(text) {
      let parsed;
      try { parsed = JSON.parse(text); } catch (e) { return { ok: false, msg: '文件不是有效的 JSON' }; }
      if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.videos)) {
        return { ok: false, msg: '不是有效的英语学习备份文件' };
      }
      const cur = App.Storage.load();
      const existIds = new Set(cur.videos.map(v => v.id));
      const existKeys = new Set(cur.videos.map(v => v.platform === 'bilibili' ? 'b:' + (v.bvid || v.sourceUrl) : 'd:' + v.sourceUrl));
      let added = 0, skipped = 0;
      parsed.videos.forEach(v => {
        if (existIds.has(v.id)) { skipped++; return; }
        const key = v.platform === 'bilibili' ? 'b:' + (v.bvid || v.sourceUrl) : 'd:' + v.sourceUrl;
        if (existKeys.has(key)) { skipped++; return; }
        cur.videos.push(v);
        existIds.add(v.id); existKeys.add(key);
        added++;
      });
      App.Storage.save(cur);
      return { ok: true, msg: `导入完成：新增 ${added} 条${skipped ? `，跳过重复 ${skipped} 条` : ''}` };
    }
  };
})();
