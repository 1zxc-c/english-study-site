/**
 * sw.js —— Service Worker（PWA 离线支持 + 快速启动）
 *
 * 策略：缓存优先 + 后台更新（+ 5 秒网络超时）
 *   - install 时预缓存全部核心资源（含 JS）→ 无论网络多差，页面永远秒开、功能永远可用
 *   - 静态资源请求：先返回缓存（瞬间），后台同时去网络更新缓存（下次即最新）
 *   - HTML 导航：网络优先（5 秒超时），离线/卡顿时回退缓存
 *   - 版本升级由 index.html 的 ?v= 版本戳 + 开机自检强刷完成：
 *     缓存里是旧代码 → 页面检测版本不符 → 自动 reload → 新 SW 安装新缓存 → 之后全用新代码
 *   - B站/WebDAV/OSS 请求：一律直连网络，不缓存
 *
 * 注意：本项目部署在 GitHub Pages 子路径（/english-study-site/）下，
 *       故所有缓存 key 都带相对路径语义，缓存名含版本以便更新。
 */
const VERSION = 'v9';
const CACHE_NAME = 'english-study-' + VERSION;

// 离线核心资源（相对路径 + 版本戳，适配任意部署子路径）
const CORE_ASSETS = [
  './',
  './index.html',
  './css/style.css?v=7',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/logo-top.png',
  './js/app.js?v=7',
  './js/bilibili.js?v=7',
  './js/data.js?v=7',
  './js/notes.js?v=7',
  './js/oss.js?v=7',
  './js/parse.js?v=7',
  './js/player.js?v=7',
  './js/review.js?v=7',
  './js/storage.js?v=7',
  './js/sync.js?v=7',
  './js/ui.js?v=7'
];

/** 网络请求加超时：github.io 卡住时不至于挂起，快速回退缓存 */
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
  ]);
}

self.addEventListener('install', e => {
  // 容错预缓存：个别资源拉取失败不中断（弱网下避免 SW 安装失败导致无缓存可用）
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.allSettled(CORE_ASSETS.map(url => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 新 SW 接管后：收到 forceUpdate 只清缓存，不自动 reload（页面自己弹提示条，点击才刷新）
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'forceUpdate') {
    e.waitUntil(
      caches.keys()
        .then(keys => Promise.all(keys.map(k => caches.delete(k))))
    );
  }
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // B站 API / 视频流 / WebDAV 同步 / OSS / 本地代理：一律走网络，不缓存
  if (url.hostname === 'api.bilibili.com' ||
      url.pathname.startsWith('/api/') ||
      url.hostname.includes('dav.') ||
      url.hostname.includes('aliyuncs.com') ||
      url.hostname === 'localhost' ||
      e.request.method !== 'GET') {
    return;
  }

  // 页面导航（HTML）：网络优先（5 秒超时），离线/卡顿回退缓存
  if (e.request.mode === 'navigate') {
    e.respondWith(
      withTimeout(fetch(e.request, { cache: 'no-store' }), 5000)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // 静态资源：缓存优先（永远可用）+ 后台更新
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) {
        // 有缓存：立即返回，后台拉网络更新缓存
        withTimeout(fetch(e.request), 5000)
          .then(res => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE_NAME).then(c => c.put(e.request, copy));
            }
          })
          .catch(() => { /* 网络失败不影响已缓存的页面 */ });
        return cached;
      }
      // 无缓存：拉网络（5 秒超时），成功后入缓存；失败回退缓存再试
      return withTimeout(fetch(e.request), 5000)
        .then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => caches.match(e.request));
    })
  );
});
