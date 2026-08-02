/**
 * data.js —— 数据模型、状态枚举、时间格式化工具
 * 所有模块的字段契约，从这里读取常量。
 */
(function () {
  'use strict';
  window.App = window.App || {};

  const STATUS = {
    daily: { UNLEARNED: 'unlearned', LEARNING: 'learning', LEARNED: 'learned', DONE: 'reviewDone' },
    interest: { UNWATCHED: 'unwatched', WATCHED: 'watched' }
  };

  const STATUS_LABEL = {
    unlearned: '未学习', learning: '学习中', learned: '已学习', reviewDone: '复习完成',
    unwatched: '未观看', watched: '已观看'
  };

  // 库中文名
  const LIB_LABEL = { daily: '每日学习', interest: '感兴趣视频' };

  function uid(prefix) {
    return (prefix || 'v') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /** 新建一个视频条目（字段契约） */
  function createItem({ platform, sourceUrl, shareText, bvid, cid, title, cover, duration, library, category }) {
    return {
      id: uid('v'),
      platform,                       // 'bilibili' | 'douyin'
      sourceUrl,                      // 规范化播放链接
      shareText: shareText || '',     // 用户粘贴的原文，留档
      bvid: bvid || null,
      cid: cid || null,
      title: title || '未命名视频',
      cover: cover || null,
      duration: duration || null,     // 秒；未知 null → 显示 '--'
      category: category || '',       // 分区标签，'' = 未分类
      library,                        // 'daily' | 'interest'
      status: library === 'daily' ? STATUS.daily.UNLEARNED : STATUS.interest.UNWATCHED,
      importedAt: Date.now(),
      lastPlayedAt: null,
      progress: null,                 // { current: 秒, updatedAt }
      notes: '',
      markers: [],                    // { id, time, label, createdAt }
      review: null                    // { startedAt, round, nextReviewAt, markedAt, completedAt }
    };
  }

  /* ---------- 时间工具 ---------- */

  /** 今天零点（本地时区） */
  function startOfToday() {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  /** 今天结束（本地时区，含毫秒） */
  function endOfToday() {
    return startOfToday() + 24 * 3600 * 1000 - 1;
  }

  /** 把某天的日期对象转成时间戳（本地时区零点） */
  function dateToStartOfDay(ts) {
    const d = new Date(ts);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  function addDays(ts, days) {
    const d = new Date(ts);
    d.setDate(d.getDate() + days);
    return d.getTime();
  }

  /** 秒 → mm:ss（超一小时 h:mm:ss） */
  function formatTime(sec) {
    if (sec === null || sec === undefined || isNaN(sec)) return '--';
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const mm = String(m).padStart(2, '0'), ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  /** 时间戳 → 日期字符串 M-D */
  function formatDate(ts) {
    if (!ts) return '--';
    const d = new Date(ts);
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }

  /** 时间戳 → 完整日期时间 YYYY-M-D HH:mm */
  function formatDateTime(ts) {
    if (!ts) return '--';
    const d = new Date(ts);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /** 下一个自然日：今天/明天/周几 */
  function relativeDay(ts) {
    const todayStart = startOfToday();
    const targetStart = dateToStartOfDay(ts);
    const diff = Math.round((targetStart - todayStart) / 86400000);
    if (diff === 0) return '今天';
    if (diff === 1) return '明天';
    const d = new Date(ts);
    const weeks = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return diff > 1 ? `${d.getMonth() + 1}月${d.getDate()}日 ${weeks[d.getDay()]}` : '已逾期';
  }

  App.Data = {
    STATUS, STATUS_LABEL, LIB_LABEL,
    uid, createItem,
    startOfToday, endOfToday, dateToStartOfDay, addDays,
    formatTime, formatDate, formatDateTime, relativeDay
  };
})();
