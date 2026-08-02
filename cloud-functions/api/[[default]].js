/**
 * EdgeOne Pages Node Functions —— B站 API + 视频流代理
 *
 * 部署：腾讯云 EdgeOne Pages（国内直连）→ 静态托管 + 本函数自动成为 /api/bili/* 端点。
 * 网站与代理同源，前端相对路径 /api/bili/* 自动打到此处。
 *
 * 端点（经本函数转发）：
 *   GET /api/bili/view?bvid=            → 视频元信息（标题/封面/时长/cid）
 *   GET /api/bili/playurl?bvid=&cid=&qn= → 播放地址（durl mp4 音画合一）
 *   GET /api/bili/stream?bvid=&cid=&qn=  → 视频流（支持 Range，可拖动进度）
 *   GET /api/bili/resolve?url=          → b23.tv 短链解析
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range'
};

/** 转发 B站 API JSON */
async function proxyApi(url, refererBvid) {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Referer': refererBvid ? `https://www.bilibili.com/video/${refererBvid}` : 'https://www.bilibili.com/'
    }
  });
  const body = await resp.text();
  return new Response(body, {
    status: resp.status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' }
  });
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // CORS 预检
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS });
  }

  // b23.tv 短链解析
  if (path === '/api/bili/resolve') {
    const target = url.searchParams.get('url');
    if (!target || !/^https?:\/\//.test(target)) return json({ code: -1, message: 'bad url' });
    try {
      const r = await fetch(target, { redirect: 'follow' });
      return json({ finalUrl: r.url || target });
    } catch (e) {
      return json({ code: -1, message: 'resolve_error' });
    }
  }

  // 视频元信息
  if (path === '/api/bili/view') {
    const bvid = url.searchParams.get('bvid');
    if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) return json({ code: -1, message: 'bad bvid' });
    return proxyApi(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, bvid);
  }

  // 播放地址
  if (path === '/api/bili/playurl') {
    const bvid = url.searchParams.get('bvid');
    const cid = url.searchParams.get('cid');
    if (!/^BV[0-9A-Za-z]{10}$/.test(bvid) || !/^\d+$/.test(cid)) return json({ code: -1, message: 'bad bvid/cid' });
    const qn = url.searchParams.get('qn') || '64';
    const qs = `bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(cid)}&qn=${qn}&fnval=1&fnver=0&fourk=0&platform=pc`;
    return proxyApi(`https://api.bilibili.com/x/player/playurl?${qs}`, bvid);
  }

  // 视频流（Range 转发）
  if (path === '/api/bili/stream') {
    const bvid = url.searchParams.get('bvid');
    const cid = url.searchParams.get('cid');
    if (!/^BV[0-9A-Za-z]{10}$/.test(bvid) || !/^\d+$/.test(cid)) return json({ code: -1, message: 'bad bvid/cid' });
    const qn = url.searchParams.get('qn') || '64';

    try {
      // 1) 拿新鲜直链
      const playResp = await fetch(
        `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(cid)}&qn=${qn}&fnval=1&fnver=0&fourk=0&platform=pc`,
        { headers: { 'User-Agent': UA, 'Referer': `https://www.bilibili.com/video/${bvid}` } }
      );
      const playData = await playResp.json();
      const durl = playData && playData.data && playData.data.durl;
      if (!durl || !durl.length) return json({ code: -1, message: 'no playable stream' });

      // 2) 转发媒体流（透传 Range / Content-Range / Content-Type）
      const range = request.headers.get('Range');
      const headers = { 'User-Agent': UA, 'Referer': `https://www.bilibili.com/video/${bvid}`, 'Accept': '*/*' };
      if (range) headers['Range'] = range;

      const mediaResp = await fetch(durl[0].url, { headers });
      const respHeaders = new Headers(CORS);
      ['content-type', 'content-length', 'content-range', 'accept-ranges'].forEach(k => {
        const v = mediaResp.headers.get(k);
        if (v) respHeaders.set(k, v);
      });
      return new Response(mediaResp.body, { status: mediaResp.status, headers: respHeaders });
    } catch (e) {
      return json({ code: -1, message: 'stream_error' });
    }
  }

  return json({ code: -1, message: 'not found' });
}

function json(obj) {
  return new Response(JSON.stringify(obj), {
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' }
  });
}
