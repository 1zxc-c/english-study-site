/**
 * sw.js —— Service Worker（PWA 离线支持 + 快速启动）
 *
 * 策略：
 *   - JS 资源：永远走网络（network-first + 断网兜底缓存），避免旧缓存导致功能失效
 *   - 其他静态资源（css/图标/字体）：缓存优先 + 后台更新
 *   - HTML 导航：网络优先，离线回退缓存
 *   - B站/WebDAV/OSS 请求：一律直连网络，不缓存
 *
 * 注意：本项目部署在 GitHub Pages 子路径（/english-study-site/）下，
 *       故所有缓存 key 都带相对路径语义，缓存名含版本以便更新。
 */
const VERSION = 'v6';
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
  './icons/logo-top.png'
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

  // B站 API / 视频流 / WebDAV 同步 / OSS：一律走网络，不缓存
  if (url.hostname === 'api.bilibili.com' ||
      url.pathname.startsWith('/api/') ||
      url.hostname.includes('dav.') ||
      url.hostname === 'localhost' ||
      url.hostname.includes('aliyuncs.com') ||
      e.request.method !== 'GET') {
    return;
  }

  // 页面导航（HTML）：强制绕过 HTTP 缓存拿最新（GitHub Pages 默认缓存 10 分钟），离线时回退缓存
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' })
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // JS / CSS 资源：网络优先（保证功能永远最新），断网时回退缓存
  if (e.request.destination === 'script' || e.request.destination === 'style' || /\.(js|css)(\?.*)?$/.test(url.pathname)) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // 其他静态资源（css/图片/图标）：缓存优先 + 后台更新
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
