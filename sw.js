/**
 * sw.js —— Service Worker（PWA 离线支持 + 快速启动）
 *
 * 策略：缓存优先 + 网络回退（stale-while-revalidate 简化版）
 *   - 首次访问后，所有静态资源（html/css/js/图标/manifest）离线可用
 *   - 数据（localStorage + WebDAV）不经过 SW
 *   - B站相关请求永远直连网络（不缓存），失败降级由页面处理
 *
 * 注意：本项目部署在 GitHub Pages 子路径（/english-study-site/）下，
 *       故所有缓存 key 都带相对路径语义，缓存名含版本以便更新。
 */
const VERSION = 'v2';
const CACHE_NAME = 'english-study-' + VERSION;

// 离线核心资源（相对路径，适配任意部署子路径）
const CORE_ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/logo-top.png',
  './js/app.js',
  './js/bilibili.js',
  './js/data.js',
  './js/notes.js',
  './js/parse.js',
  './js/player.js',
  './js/review.js',
  './js/storage.js',
  './js/sync.js',
  './js/ui.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CORE_ASSETS))
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

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // B站 API / 视频流 / WebDAV 同步请求：一律走网络，不缓存
  if (url.hostname === 'api.bilibili.com' ||
      url.pathname.startsWith('/api/') ||
      url.hostname.includes('dav.') ||
      url.hostname === 'localhost' ||
      e.request.method !== 'GET') {
    return;
  }

  // 页面导航（HTML）：网络优先，离线时回退缓存
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // 静态资源：缓存优先 + 后台更新
  e.respondWith(
    caches.match(e.request).then(cached => {
      const fetchPromise = fetch(e.request)
        .then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
