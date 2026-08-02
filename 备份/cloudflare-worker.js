/**
 * Cloudflare Workers 云代理 —— B站 API + 视频流转发
 *
 * 部署方式：
 *   1. 注册/登录 Cloudflare（免费）：https://dash.cloudflare.com
 *   2. Workers & Pages → 创建 Worker → 粘贴本文件全部内容 → 部署
 *   3. 得到地址形如：https://your-name.workers.dev
 *   4. 在英语学习网站页脚 →「云代理」→ 填该地址 → 保存
 *
 * 之后在线版（含手机）的 B站视频即可站内直接播放（15秒快进/节点跳转全支持），
 * 效果与电脑本地版一致。
 *
 * 免费版限制：10 万请求/天（个人学习绰绰有余）；视频流为流式转发，不占内存。
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range'
};

/** 转发 B站 API（服务器侧无 Origin 限制，可正常获取） */
async function proxyApi(request, path, params, refererBvid) {
  const apiUrl = 'https://api.bilibili.com' + path + '?' + params.toString();
  const resp = await fetch(apiUrl, {
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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    // b23.tv 短链解析：跟随重定向返回最终长链
    if (path === '/api/bili/resolve') {
      const target = url.searchParams.get('url');
      if (!target || !/^https?:\/\//.test(target)) {
        return new Response(JSON.stringify({ code: -1, message: 'bad url' }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
      }
      const resp = await fetch(target, { redirect: 'follow' });
      return new Response(JSON.stringify({ finalUrl: resp.url || target }), {
        headers: { ...CORS, 'Content-Type': 'application/json' }
      });
    }

    // 视频元信息（标题/封面/时长/cid）
    if (path === '/api/bili/view') {
      const bvid = url.searchParams.get('bvid');
      if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) return badRequest();
      const p = new URLSearchParams({ bvid });
      return proxyApi(request, '/x/web-interface/view', p, bvid);
    }

    // 播放地址（durl mp4 音画合一）
    if (path === '/api/bili/playurl') {
      const bvid = url.searchParams.get('bvid');
      const cid = url.searchParams.get('cid');
      if (!/^BV[0-9A-Za-z]{10}$/.test(bvid) || !/^\d+$/.test(cid)) return badRequest();
      const qn = url.searchParams.get('qn') || '64';
      const p = new URLSearchParams({ bvid, cid, qn, fnval: '1', fnver: '0', fourk: '0', platform: 'pc' });
      return proxyApi(request, '/x/player/playurl', p, bvid);
    }

    // 视频流代理：先拿新鲜直链 → 带 B站 Referer 转发媒体流（支持 Range，可拖动进度）
    if (path === '/api/bili/stream') {
      const bvid = url.searchParams.get('bvid');
      const cid = url.searchParams.get('cid');
      if (!/^BV[0-9A-Za-z]{10}$/.test(bvid) || !/^\d+$/.test(cid)) return badRequest();
      const qn = url.searchParams.get('qn') || '64';

      // 1) 获取直链
      const playResp = await fetch(
        `https://api.bilibili.com/x/player/playurl?${new URLSearchParams({ bvid, cid, qn, fnval: '1', fnver: '0', fourk: '0', platform: 'pc' })}`,
        { headers: { 'User-Agent': UA, 'Referer': `https://www.bilibili.com/video/${bvid}` } }
      );
      const playData = await playResp.json();
      const durl = playData && playData.data && playData.data.durl;
      if (!durl || !durl.length) {
        return new Response(JSON.stringify({ code: -1, message: 'no playable stream' }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
      }

      // 2) 转发媒体流（透传 Range / Content-Range / Content-Type）
      const range = request.headers.get('Range');
      const headers = {
        'User-Agent': UA,
        'Referer': `https://www.bilibili.com/video/${bvid}`,
        'Accept': '*/*'
      };
      if (range) headers['Range'] = range;

      const mediaResp = await fetch(durl[0].url, { headers });
      const respHeaders = new Headers(CORS);
      ['content-type', 'content-length', 'content-range', 'accept-ranges'].forEach(k => {
        const v = mediaResp.headers.get(k);
        if (v) respHeaders.set(k, v);
      });
      return new Response(mediaResp.body, { status: mediaResp.status, headers: respHeaders });
    }

    return new Response('Not Found', { status: 404, headers: CORS });
  }
};

function badRequest() {
  return new Response(JSON.stringify({ code: -1, message: 'bad bvid/cid' }), {
    headers: { ...CORS, 'Content-Type': 'application/json' }
  });
}
