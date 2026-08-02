/**
 * app.js —— 启动引导、hash 路由、全局状态、今日待复习入口提醒
 */
(function () {
  'use strict';
  window.App = window.App || {};

  // 代码版本：与 index.html 脚本 ?v= 同步。缓存里旧代码版本不符时开机自检会强刷。
  const APP_VERSION = '6';

  /* ---------- 全局状态 ---------- */

  App.state = {
    data: null,                       // 数据容器 { videos, settings }
    view: 'list',                     // 'list' | 'detail'
    library: 'daily',                 // 当前列表 Tab
    detailId: null,
    filter: { daily: {}, interest: {} }, // 各 Tab 筛选状态
    calOpen: false,            // 复习日历展开状态
    calMonth: null             // 复习日历当前月份（null=本月）
  };

  /* ---------- 路由 ---------- */

  // 操作历史栈：仅保留最近 MAX_HISTORY 步，超出后返回直接跳首页
  const MAX_HISTORY = 2;
  const navStack = [];

  function pushHistory(hash) {
    navStack.push(hash);
    if (navStack.length > MAX_HISTORY) navStack.shift();   // 只留最近 2 步
  }

  /** 全局返回：取栈中上一步；栈空/超限 → 回首页 */
  function goBack() {
    const prev = navStack.pop();
    if (prev && prev !== location.hash) {
      location.replace(prev);
    } else {
      location.replace('#/daily');
    }
  }

  function router() {
    const hash = location.hash || '#/daily';
    const mDetail = hash.match(/^#\/video\/([\w-]+)/);
    const mList = hash.match(/^#\/(daily|interest)$/);

    // 顶栏 Tab 高亮
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', !!mList && b.dataset.tab === mList[1]));

    App.Player.destroy && App.Player.destroy();

    if (mDetail) {
      App.state.view = 'detail';
      App.state.detailId = mDetail[1];
      // 记录来源列表（供返回按钮用）
      const fromList = App.state.library || 'daily';
      App.UI.renderDetail(mDetail[1]);
      renderDueBanner();              // 详情页也显示顶部提醒条
      App.state.fromList = fromList;
    } else {
      const lib = mList ? mList[1] : 'daily';
      App.state.view = 'list';
      App.state.library = lib;
      App.UI.renderList(lib);
      renderDueBanner();
    }
  }

  /* ---------- 今日待复习入口提醒条（进入网站时） ---------- */

  function renderDueBanner() {
    const banner = document.getElementById('due-banner');
    const due = App.Review.getDueList(App.state.data.videos);
    if (!due.length) { banner.hidden = true; banner.innerHTML = ''; return; }

    banner.innerHTML = `
      <div class="due-banner-inner">
        <span class="due-banner-msg">📌 今日待复习 <b>${due.length}</b> 个视频</span>
        <div class="due-banner-list">
          ${due.map(v => `<a href="#/video/${v.id}" class="due-banner-item">${App.UI.esc(v.title)}</a>`).join('')}
        </div>
        <button class="btn btn-sm btn-ghost due-banner-close" title="本次会话内不再提醒">关闭</button>
      </div>`;
    banner.hidden = false;

    banner.querySelector('.due-banner-close').addEventListener('click', () => {
      banner.hidden = true;
      try { sessionStorage.setItem('dueDismissed', '1'); } catch (e) { /* ignore */ }
    });
  }

  /* ---------- 启动 ---------- */

  function boot() {
    App.state.data = App.Storage.load();
    App.Player.bindShortcuts();

    // 开机自检：若本次加载的代码版本与本地记录不符（= 缓存喂了旧 JS），自动强制刷新
    try {
      const saved = localStorage.getItem('englishSite.appVer');
      if (saved && saved !== APP_VERSION && location.reload && !sessionStorage.getItem('forcedReload')) {
        sessionStorage.setItem('forcedReload', '1');
        location.reload();   // 重载即从网络拉最新 index.html + ?v=5 脚本
        return;              // 后续 boot 不再执行（页面即将重载）
      }
      localStorage.setItem('englishSite.appVer', APP_VERSION);
    } catch (e) { /* 存储不可用时忽略自检 */ }

    // 顶栏 Tab 切换
    document.getElementById('tabs').addEventListener('click', e => {
      const tab = e.target.closest('.tab');
      if (tab) location.hash = '#/' + tab.dataset.tab;
    });

    // 导入按钮
    document.getElementById('btn-import').addEventListener('click', () => {
      App.UI.openImportModal(App.state.view === 'detail'
        ? App.state.data.videos.find(v => v.id === App.state.detailId)?.library
        : App.state.library);
    });

    App.UI.bindFooter();
    bindSyncEntry();
    bindProxyEntry();
    bindOssEntry();

    window.addEventListener('hashchange', () => {
      pushHistory(location.hash);
      router();
    });
    router();

    // 启动自动同步（静默，失败不影响使用）
    App.Sync.autoSync();
    App.Oss.autoSync();

    // 注册 Service Worker（PWA：离线可用 + 快速启动；仅 HTTPS/localhost 支持）
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('./sw.js').catch(err => {
        console.warn('SW registration failed:', err);
      });
    }

    // 进入提醒（会话内仅一次）
    try {
      const dismissed = sessionStorage.getItem('dueDismissed') === '1';
      if (!dismissed) renderDueBanner();
    } catch (e) { renderDueBanner(); }
  }

  function bindSyncEntry() {
    const link = document.getElementById('link-sync');
    if (!link) return;
    link.addEventListener('click', e => {
      e.preventDefault();
      App.Sync.openSyncModal();
    });
  }

  function bindProxyEntry() {
    const link = document.getElementById('link-proxy');
    if (!link) return;
    link.addEventListener('click', e => {
      e.preventDefault();
      App.UI.openProxyModal();
    });
  }

  function bindOssEntry() {
    const link = document.getElementById('link-oss');
    if (!link) return;
    link.addEventListener('click', e => {
      e.preventDefault();
      App.Oss.openOssModal();
    });
  }

  App.goBack = goBack;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
