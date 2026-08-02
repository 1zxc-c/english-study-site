/**
 * 英语学习网站 - 本地服务（零依赖）
 *
 * 职责：
 *  1. 静态文件托管（index.html / css / js）
 *  2. B站 API 代理转发：绕开浏览器 CORS 限制
 *     （api.bilibili.com 在浏览器带 Origin 请求时返回 403，服务器侧无 Origin 则正常）
 *
 * 用法：node server.js  →  打开 http://localhost:8668
 */
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = 8668;
const ROOT = __dirname;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg'
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/* ---------- B站 API 代理 ---------- */

// 把 {a, b} 拼成 a=b&c=d
function qs(params) {
  return Object.keys(params).filter(k => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
}

/** 转发 bilibili API，原样回传 JSON */
function proxyBili(req, res, upstreamPath, params, opts = {}) {
  const refererBvid = opts.refererBvid;
  const url = 'https://api.bilibili.com' + upstreamPath + '?' + qs(params);
  const upstreamReq = https.request(url, {
    method: 'GET',
    headers: {
      'User-Agent': UA,
      'Referer': refererBvid ? `https://www.bilibili.com/video/${refererBvid}` : 'https://www.bilibili.com/',
      'Accept': 'application/json, text/plain, */*'
    }
  }, upstreamRes => {
    const chunks = [];
    upstreamRes.on('data', c => chunks.push(c));
    upstreamRes.on('end', () => {
      const body = Buffer.concat(chunks);
      res.writeHead(upstreamRes.statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(body);
    });
  });
  upstreamReq.on('error', err => {
    console.error('[bili proxy]', upstreamPath, err.message);
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: -1, message: 'proxy_error: ' + err.message }));
  });
  upstreamReq.end();
}

/**
 * 视频流代理：先经 API 拿新鲜直链 → 带 B站 Referer/UA 转发媒体流
 * 支持 Range（浏览器拖动进度条会发 Range 请求，需透传）
 */
function streamBili(req, res, bvid, cid, qn) {
  const playUrl = `https://api.bilibili.com/x/player/playurl?${qs({ bvid, cid, qn, fnval: 1, fnver: 0, fourk: 0, platform: 'pc' })}`;
  https.get(playUrl, {
    headers: {
      'User-Agent': UA,
      'Referer': `https://www.bilibili.com/video/${bvid}`,
      'Accept': 'application/json, text/plain, */*'
    }
  }, apiRes => {
    const chunks = [];
    apiRes.on('data', c => chunks.push(c));
    apiRes.on('end', () => {
      let j;
      try { j = JSON.parse(Buffer.concat(chunks).toString('utf-8')); } catch (e) { j = null; }
      const durl = j && j.code === 0 && j.data && j.data.durl;
      if (!durl || !durl.length) {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ code: -1, message: 'no playable stream' }));
        return;
      }
      forwardStream(req, res, durl[0].url, bvid);
    });
  }).on('error', err => {
    console.error('[bili stream] playurl', err.message);
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: -1, message: 'stream_playurl_error' }));
  });
}

/** 转发 CDN 媒体流：透传 Range / Accept-Ranges / Content-Range / Content-Type */
function forwardStream(req, res, streamUrl, bvid) {
  const range = req.headers.range;
  const headers = {
    'User-Agent': UA,
    'Referer': `https://www.bilibili.com/video/${bvid}`,
    'Accept': '*/*'
  };
  if (range) headers['Range'] = range;

  const upstreamReq = https.request(streamUrl, { method: 'GET', headers }, upstreamRes => {
    const h = {};
    ['content-type', 'content-length', 'content-range', 'accept-ranges', 'content-encoding'].forEach(k => {
      const v = upstreamRes.headers[k];
      if (v !== undefined) h[k] = v;
    });
    // 允许跨域（同源其实不需要，但保留兼容 file:// 等场景）
    h['Access-Control-Allow-Origin'] = '*';
    res.writeHead(upstreamRes.statusCode, h);
    upstreamRes.pipe(res);
  });
  upstreamReq.on('error', err => {
    console.error('[bili stream] forward', err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ code: -1, message: 'stream_forward_error' }));
    } else {
      res.end();
    }
  });
  upstreamReq.end();

  // 浏览器断连时回收资源
  req.on('close', () => { if (!res.writableEnded) { upstreamReq.destroy(); } });
}

/* ---------- 静态文件 ---------- */

function serveStatic(req, res, urlPath) {
  // 安全：拒绝路径穿越
  const safe = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  let filePath = path.join(ROOT, safe);
  if (urlPath === '/' || filePath === ROOT || filePath === path.join(ROOT, '\\')) {
    filePath = path.join(ROOT, 'index.html'); // 根路径 → index.html
  }

  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const mime = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
    fs.createReadStream(filePath).pipe(res);
  });
}

/* ---------- 路由 ---------- */

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost:' + PORT);

  // /api/bili/view?bvid=xxx —— 视频元信息（标题/封面/时长/cid）
  if (url.pathname === '/api/bili/view' && req.method === 'GET') {
    const bvid = url.searchParams.get('bvid') || '';
    if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ code: -1, message: 'bad bvid' }));
      return;
    }
    proxyBili(req, res, '/x/web-interface/view', { bvid }, { refererBvid: bvid });
    return;
  }

  // /api/bili/resolve?url=短链 —— 跟随重定向，返回最终 URL（b23.tv → www.bilibili.com/video/BV...）
  if (url.pathname === '/api/bili/resolve' && req.method === 'GET') {
    const target = url.searchParams.get('url') || '';
    if (!/^https?:\/\//.test(target) || !/b23\.tv|douyin\.com|bilibili\.com/.test(target)) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ code: -1, message: 'bad url' }));
      return;
    }
    const upstreamReq = https.request(target, {
      method: 'GET',
      headers: { 'User-Agent': UA }
    }, upstreamRes => {
      // 跟随到最终响应（重定向由 Node 自动处理）
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ finalUrl: upstreamRes.statusCode === 200 ? upstreamRes.url || target : target }));
    });
    upstreamReq.on('error', err => {
      console.error('[bili proxy] resolve', err.message);
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ code: -1, message: 'resolve_error' }));
    });
    upstreamReq.end();
    return;
  }

  // /api/bili/stream?bvid=xxx&cid=xxx&qn=64 —— 视频流代理
  // 背景：B站 CDN 防盗链校验 Referer 必须来自 bilibili 域；浏览器直连直链（本地 Referer）会 403。
  // 方案：服务器侧调 playurl 拿新鲜直链，再带 B站 Referer 转发媒体流（支持 Range，进度拖动可用）。
  if (url.pathname === '/api/bili/stream' && req.method === 'GET') {
    const bvid = url.searchParams.get('bvid') || '';
    const cid = url.searchParams.get('cid') || '';
    const qn = url.searchParams.get('qn') || '64';
    if (!/^BV[0-9A-Za-z]{10}$/.test(bvid) || !/^\d+$/.test(cid)) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ code: -1, message: 'bad bvid/cid' }));
      return;
    }
    streamBili(req, res, bvid, cid, qn);
    return;
  }

  // /api/bili/playurl?bvid=xxx&cid=xxx&qn=64 —— 视频播放直链（durl mp4 音画合一）
  if (url.pathname === '/api/bili/playurl' && req.method === 'GET') {
    const bvid = url.searchParams.get('bvid') || '';
    const cid = url.searchParams.get('cid') || '';
    const qn = url.searchParams.get('qn') || '64';
    if (!/^BV[0-9A-Za-z]{10}$/.test(bvid) || !/^\d+$/.test(cid)) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ code: -1, message: 'bad bvid/cid' }));
      return;
    }
    // fnval=1 → durl（音画合一 mp4），免 MSE 合成，<video> 原生可播
    proxyBili(req, res, '/x/player/playurl', {
      bvid, cid, qn, fnval: 1, fnver: 0, fourk: 0, platform: 'pc'
    }, { refererBvid: bvid });
    return;
  }

  // /api/webdav/* —— WebDAV 代理（浏览器侧无 CORS，走本地服务转发）
  // 用法：/api/webdav/put?base=xxx&user=xxx&pass=xxx&body=json
  //       /api/webdav/get?base=xxx&user=xxx&pass=xxx
  if (url.pathname === '/api/webdav/put' && req.method === 'POST') {
    const base = url.searchParams.get('base') || '';
    const user = url.searchParams.get('user') || '';
    const pass = url.searchParams.get('pass') || '';
    if (!/^https?:\/\//.test(base)) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, msg: 'bad base url' }));
      return;
    }
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const fileUrl = (base.endsWith('/') ? base : base + '/') + 'english-study-site-data.json';
      const auth = 'Basic ' + Buffer.from(user + ':' + pass).toString('base64');
      const client = fileUrl.startsWith('https:') ? https : http;
      const upstreamReq = client.request(fileUrl, {
        method: 'PUT',
        headers: { 'User-Agent': UA, 'Authorization': auth, 'Content-Type': 'application/json' }
      }, upstreamRes => {
        const respChunks = [];
        upstreamRes.on('data', c => respChunks.push(c));
        upstreamRes.on('end', () => {
          const ok = upstreamRes.statusCode === 200 || upstreamRes.statusCode === 201 || upstreamRes.statusCode === 204;
          res.writeHead(ok ? 200 : upstreamRes.statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok, msg: ok ? '上传成功' : '上传失败 HTTP ' + upstreamRes.statusCode }));
        });
      });
      upstreamReq.on('error', err => {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, msg: '连接 WebDAV 失败: ' + err.message }));
      });
      upstreamReq.write(body);
      upstreamReq.end();
    });
    return;
  }

  if (url.pathname === '/api/webdav/get' && req.method === 'GET') {
    const base = url.searchParams.get('base') || '';
    const user = url.searchParams.get('user') || '';
    const pass = url.searchParams.get('pass') || '';
    if (!/^https?:\/\//.test(base)) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, msg: 'bad base url' }));
      return;
    }
    const fileUrl = (base.endsWith('/') ? base : base + '/') + 'english-study-site-data.json';
    const auth = 'Basic ' + Buffer.from(user + ':' + pass).toString('base64');
    const client = fileUrl.startsWith('https:') ? https : http;
    const upstreamReq = client.request(fileUrl, {
      method: 'GET',
      headers: { 'User-Agent': UA, 'Authorization': auth }
    }, upstreamRes => {
      if (upstreamRes.statusCode === 404) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, msg: 'not_found', notFound: true }));
        return;
      }
      const chunks = [];
      upstreamRes.on('data', c => chunks.push(c));
      upstreamRes.on('end', () => {
        if (upstreamRes.statusCode !== 200) {
          res.writeHead(upstreamRes.statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, msg: '拉取失败 HTTP ' + upstreamRes.statusCode }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        const raw = chunks.length ? Buffer.concat(chunks) : Buffer.from('{}');
        // 包装成 {ok:true, data:...} 结构，供前端统一解析
        let parsed;
        try { parsed = JSON.parse(raw.toString('utf-8')); } catch (e) { parsed = null; }
        res.end(JSON.stringify({ ok: true, data: parsed }));
      });
    });
    upstreamReq.on('error', err => {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, msg: '连接 WebDAV 失败: ' + err.message }));
    });
    upstreamReq.end();
    return;
  }

  // 其余一律静态托管
  serveStatic(req, res, url.pathname);
});

server.listen(PORT, () => {
  console.log('========================================');
  console.log('  英语学习网站 已启动');
  console.log('  请访问: http://localhost:' + PORT);
  console.log('  (Ctrl+C 停止)');
  console.log('========================================');
});
