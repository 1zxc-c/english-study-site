/**
 * Vercel Serverless 函数 —— B站 API + 视频流代理
 *
 * 部署：Vercel 连接 GitHub 仓库后，此文件自动成为 /api/bili/[...path] 端点。
 * 网站与代理同源，前端相对路径 /api/bili/* 自动打到此处，无需任何配置。
 *
 * 端点：
 *   GET /api/bili/view?bvid=       → 视频元信息（标题/封面/时长/cid）
 *   GET /api/bili/playurl?bvid=&cid=&qn= → 播放地址
 *   GET /api/bili/stream?bvid=&cid=&qn= → 视频流（支持 Range 拖动）
 *   GET /api/bili/resolve?url=     → b23.tv 短链解析
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range'
};

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');

  // CORS 预检
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Range');
    res.status(204).end();
    return;
  }

  const path = (url.pathname.match(/\/api\/bili\/([a-z]+)/) || [])[1];

  // b23.tv 短链解析
  if (path === 'resolve') {
    const target = url.searchParams.get('url');
    if (!target || !/^https?:\/\//.test(target)) return json(res, { code: -1, message: 'bad url' });
    try {
      const r = await fetch(target, { redirect: 'follow' });
      return json(res, { finalUrl: r.url || target });
    } catch (e) {
      return json(res, { code: -1, message: 'resolve_error' });
    }
  }

  // 视频元信息
  if (path === 'view') {
    const bvid = url.searchParams.get('bvid');
    if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) return json(res, { code: -1, message: 'bad bvid' });
    return proxyApi(req, res, '/x/web-interface/view', `bvid=${encodeURIComponent(bvid)}`, bvid);
  }

  // 播放地址
  if (path === 'playurl') {
    const bvid = url.searchParams.get('bvid');
    const cid = url.searchParams.get('cid');
    if (!/^BV[0-9A-Za-z]{10}$/.test(bvid) || !/^\d+$/.test(cid)) return json(res, { code: -1, message: 'bad bvid/cid' });
    const qn = url.searchParams.get('qn') || '64';
    const qs = `bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(cid)}&qn=${qn}&fnval=1&fnver=0&fourk=0&platform=pc`;
    return proxyApi(req, res, '/x/player/playurl', qs, bvid);
  }

  // 视频流（Range 转发）
  if (path === 'stream') {
    const bvid = url.searchParams.get('bvid');
    const cid = url.searchParams.get('cid');
    if (!/^BV[0-9A-Za-z]{10}$/.test(bvid) || !/^\d+$/.test(cid)) return json(res, { code: -1, message: 'bad bvid/cid' });
    const qn = url.searchParams.get('qn') || '64';

    try {
      // 1) 拿新鲜直链
      const playResp = await fetch(
        `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(cid)}&qn=${qn}&fnval=1&fnver=0&fourk=0&platform=pc`,
        { headers: { 'User-Agent': UA, 'Referer': `https://www.bilibili.com/video/${bvid}` } }
      );
      const playData = await playResp.json();
      const durl = playData && playData.data && playData.data.durl;
      if (!durl || !durl.length) return json(res, { code: -1, message: 'no playable stream' });

      // 2) 转发媒体流
      const range = req.headers.range;
      const headers = { 'User-Agent': UA, 'Referer': `https://www.bilibili.com/video/${bvid}`, 'Accept': '*/*' };
      if (range) headers['Range'] = range;

      const mediaResp = await fetch(durl[0].url, { headers });
      res.setHeader('Access-Control-Allow-Origin', '*');
      ['content-type', 'content-length', 'content-range', 'accept-ranges'].forEach(k => {
        const v = mediaResp.headers.get(k);
        if (v) res.setHeader(k, v);
      });
      res.status(mediaResp.status);
      // Vercel 流式转发 body
      const reader = mediaResp.body.getReader();
      res.on('close', () => reader.cancel().catch(() => {}));
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
        // 背压：等可写
        if (!res.write('')) { await new Promise(r => res.once('drain', r)); }
      }
      res.end();
    } catch (e) {
      return json(res, { code: -1, message: 'stream_error' });
    }
    return;
  }

  return json(res, { code: -1, message: 'not found' });
}

/** 转发 B站 API JSON */
async function proxyApi(req, res, upstreamPath, qs, refererBvid) {
  try {
    const resp = await fetch(`https://api.bilibili.com${upstreamPath}?${qs}`, {
      headers: {
        'User-Agent': UA,
        'Referer': refererBvid ? `https://www.bilibili.com/video/${refererBvid}` : 'https://www.bilibili.com/'
      }
    });
    const body = await resp.text();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(resp.status).send(body);
  } catch (e) {
    json(res, { code: -1, message: 'proxy_error' });
  }
}

function json(res, obj) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json(obj);
}
