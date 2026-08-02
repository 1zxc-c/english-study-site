/**
 * sync.js —— WebDAV 数据同步
 *
 * 用途：跨设备同步学习数据（视频条目/笔记/复习进度）到用户的 WebDAV 网盘
 *       （如坚果云 WebDAV：https://dav.jianguoyun.com/dav/）。
 *
 * 工作方式：
 *   - 设置存 localStorage（key: englishSite.sync），含 baseUrl / username / password
 *   - 同步文件：<baseUrl>/english-study-site-data.json（WebDAV 根或自定义路径下）
 *   - 冲突策略：比较云端文件与本地数据的 updatedAt，以较新者为准
 *   - 触发：设置弹窗内手动同步 / 上传 / 拉取；每次启动页面时自动同步
 *
 * 注意：CORS —— WebDAV 服务需允许跨域（坚果云 dav.jianguoyun.com 支持）。
 *       GitHub Pages 上的在线版也可用；本地版同样适用。
 */
(function () {
  'use strict';
  window.App = window.App || {};

  const SYNC_KEY = 'englishSite.sync';
  const FILE_NAME = 'english-study-site-data.json';
  const REMOTE = 'syncFile';

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SYNC_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function saveSettings(s) {
    localStorage.setItem(SYNC_KEY, JSON.stringify(s));
  }

  /** 直接写 localStorage（保留远端 updatedAt，不走 App.Storage.save 的自动时间戳） */
  function writeRaw(data) {
    try {
      localStorage.setItem(App.Storage.KEY, JSON.stringify(data));
    } catch (e) {
      // 隐私模式兜底：内存态
      App.state.data = data;
    }
  }

  /** 组装远端文件 URL：处理 baseUrl 结尾斜杠与自定义子路径 */
  function remoteUrl(s) {
    let base = (s.baseUrl || '').trim();
    if (base && !base.endsWith('/')) base += '/';
    return base + FILE_NAME;
  }

  /** 基本认证头 */
  function authHeader(s) {
    return 'Basic ' + btoa((s.username || '') + ':' + (s.password || ''));
  }

  /** 是否运行在本地 server.js 环境（可走本地 WebDAV 代理） */
  function isLocalHost() {
    return location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  }

  /**
   * 上传本地数据到云端（PUT）
   *  - 本地版：走 /api/webdav/put 本地代理（坚果云无 CORS，浏览器直连会 fail）
   *  - 在线版：直接 fetch（若目标 WebDAV 支持 CORS 则可用，否则提示用备份）
   */
  async function upload(s) {
    const body = JSON.stringify(App.state.data);
    if (isLocalHost()) {
      const qs = `base=${encodeURIComponent(s.baseUrl)}&user=${encodeURIComponent(s.username)}&pass=${encodeURIComponent(s.password)}`;
      const resp = await fetch(`/api/webdav/put?${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
      });
      const j = await resp.json().catch(() => ({ ok: false, msg: '代理响应异常' }));
      return j.ok ? { ok: true, msg: j.msg, action: 'pushed' } : { ok: false, msg: j.msg };
    }
    const url = remoteUrl(s);
    const resp = await fetch(url, {
      method: 'PUT',
      headers: { 'Authorization': authHeader(s), 'Content-Type': 'application/json' },
      body
    });
    if (resp.ok || resp.status === 201 || resp.status === 204) return { ok: true, msg: '上传成功', action: 'pushed' };
    return { ok: false, msg: '上传失败 HTTP ' + resp.status + (await safeText(resp)) };
  }

  /**
   * 从云端拉取数据（GET）
   * 返回 { ok, msg, data }
   */
  async function download(s) {
    if (isLocalHost()) {
      const qs = `base=${encodeURIComponent(s.baseUrl)}&user=${encodeURIComponent(s.username)}&pass=${encodeURIComponent(s.password)}`;
      const resp = await fetch(`/api/webdav/get?${qs}`);
      const j = await resp.json().catch(() => ({ ok: false, msg: '代理响应异常' }));
      if (j.notFound) return { ok: false, msg: '云端还没有数据，请先上传', notFound: true };
      if (!j.ok) return { ok: false, msg: j.msg };
      return { ok: true, data: j.data };
    }
    const url = remoteUrl(s);
    const resp = await fetch(url, { method: 'GET', headers: { 'Authorization': authHeader(s) } });
    if (resp.status === 404) return { ok: false, msg: '云端还没有数据，请先上传', notFound: true };
    if (!resp.ok) return { ok: false, msg: '拉取失败 HTTP ' + resp.status + (await safeText(resp)) };
    let j;
    try { j = await resp.json(); } catch (e) { return { ok: false, msg: '云端数据不是有效 JSON' }; }
    return { ok: true, data: j };
  }

  async function safeText(resp) {
    try { const t = await resp.text(); return t ? '：' + t.slice(0, 120) : ''; } catch (e) { return ''; }
  }

  /** 校验本地数据结构（与 storage.js 兜底一致） */
  function normalizeData(d) {
    if (!d || typeof d !== 'object') return null;
    if (d.schemaVersion !== 1 || !Array.isArray(d.videos)) return null;
    return d;
  }

  /**
   * 执行同步：比较本地与云端 updatedAt，以新者为准。
   * 返回 { ok, msg, action: 'pushed'|'pulled'|'none'|'error' }
   */
  async function syncNow(s) {
    const localUpdated = App.state.data.updatedAt || 0;

    // 1) 拉取云端（不存在则直接上传）
    const dl = await download(s);
    if (dl.notFound) {
      return await upload(s);
    }
    if (!dl.ok) return dl;

    const remote = normalizeData(dl.data);
    if (!remote) return { ok: false, msg: '云端数据格式异常，未覆盖本地' };

    const remoteUpdated = remote.updatedAt || 0;

    // 2) 比较时间戳
    if (remoteUpdated > localUpdated) {
      // 云端更新 → 拉取覆盖本地（保留远端 updatedAt，勿覆盖为当前时间，否则下次重复拉取）
      App.state.data = remote;
      writeRaw(remote);
      App.Storage.saveSyncMeta({ lastSyncAt: Date.now(), lastAction: 'pulled' });
      return { ok: true, msg: '已从云端拉取更新（本地较旧）', action: 'pulled' };
    }
    if (remoteUpdated < localUpdated) {
      // 本地更新 → 推送覆盖云端
      const up = await upload(s);
      App.Storage.saveSyncMeta({ lastSyncAt: Date.now(), lastAction: 'pushed' });
      return up;
    }
    // 相同时间戳 → 无需操作
    App.Storage.saveSyncMeta({ lastSyncAt: Date.now(), lastAction: 'none' });
    return { ok: true, msg: '两端数据一致，无需同步', action: 'none' };
  }

  /* ---------- UI：同步设置弹窗 ---------- */

  function openSyncModal() {
    const s = loadSettings() || {};
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    App.UI.activeModal = overlay;
    document.body.classList.add('modal-open');

    overlay.innerHTML = `
      <div class="modal">
        <h3 class="modal-title">数据同步（WebDAV）</h3>
        <div class="modal-body">
          <p class="dim">配置 WebDAV 网盘（如坚果云）后，不同设备间自动同步学习数据。</p>
          <p class="dim">${isLocalHost()
            ? '本地版同步：走本地服务转发（支持坚果云）。'
            : '⚠ 在线版无法直连坚果云（不支持跨域），<b>请用页脚「导出备份/导入备份」手动迁移数据</b>，或使用本地版（双击 启动.bat）同步。'}</p>
          <div class="form-row">
            <span class="form-label">地址</span>
            <input class="inp sync-base" type="url" placeholder="https://dav.jianguoyun.com/dav/" value="${App.UI.esc(s.baseUrl || '')}">
          </div>
          <div class="form-row">
            <span class="form-label">账号</span>
            <input class="inp sync-user" type="text" placeholder="坚果云账号邮箱" value="${App.UI.esc(s.username || '')}">
          </div>
          <div class="form-row">
            <span class="form-label">密码</span>
            <input class="inp sync-pass" type="password" placeholder="坚果云应用密码（非登录密码）" value="${App.UI.esc(s.password || '')}">
          </div>
          <p class="dim">坚果云：设置 → 安全选项 → 添加应用密码。账号信息仅保存在本机浏览器，不会上传。</p>
          <div class="sync-status" data-act="sync-status"></div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-act="cancel">关闭</button>
          <button class="btn btn-ghost" data-act="save" title="保存设置（不同步）">保存设置</button>
          <button class="btn btn-primary" data-act="sync" title="比较本地与云端，以较新者为准">立即同步</button>
        </div>
      </div>`;

    document.getElementById('modal-root').appendChild(overlay);
    const $ = sel => overlay.querySelector(sel);
    const status = $('[data-act=sync-status]');
    const setStatus = (msg, ok) => {
      status.innerHTML = `<span class="${ok === false ? 'text-danger' : 'dim'}">${App.UI.esc(msg)}</span>`;
    };

    const collect = () => ({
      baseUrl: $('.sync-base').value.trim(),
      username: $('.sync-user').value.trim(),
      password: $('.sync-pass').value.trim()
    });

    const validate = s => {
      if (!s.baseUrl) return '请填写 WebDAV 地址';
      if (!/^https?:\/\//.test(s.baseUrl)) return '地址需以 http(s):// 开头';
      if (!s.username) return '请填写账号';
      if (!s.password) return '请填写密码';
      return null;
    };

    $('[data-act=cancel]').onclick = () => App.UI.closeModal(overlay);
    App.UI.wireModalDismiss && App.UI.wireModalDismiss(overlay);

    $('[data-act=save]').onclick = () => {
      const v = collect();
      const err = validate(v);
      if (err) { setStatus(err, false); return; }
      saveSettings(v);
      setStatus('设置已保存', true);
    };

    $('[data-act=sync]').onclick = async () => {
      const v = collect();
      const err = validate(v);
      if (err) { setStatus(err, false); return; }
      saveSettings(v);
      const btn = $('[data-act=sync]');
      btn.disabled = true;
      setStatus('正在同步…');
      try {
        const r = await syncNow(v);
        setStatus(r.msg, r.ok);
      } catch (e) {
        setStatus('同步失败：' + e.message, false);
      }
      btn.disabled = false;
    };
  }

  /** 启动时自动同步（静默，失败不打扰） */
  async function autoSync() {
    const s = loadSettings();
    if (!s || !s.baseUrl || !s.username || !s.password) return;
    try {
      await syncNow(s);
    } catch (e) {
      // 静默失败（离线/服务不可达时不影响使用）
    }
  }

  App.Sync = { loadSettings, saveSettings, syncNow, upload, download, openSyncModal, autoSync, REMOTE };
})();
