/**
 * bilibili.js —— B站 API 封装（经代理转发，绕开 CORS）
 *
 * 代理选择（优先级）：
 *   1. 用户配置的 Cloudflare Worker 云代理（在线版/手机端站内直播的关键）
 *   2. 本地 server.js 代理（http://localhost:8668，电脑本地版）
 * 云端配置存 localStorage key: englishSite.cloudProxy。
 */
(function () {
  'use strict';
  window.App = window.App || {};

  /** 当前生效的代理基址：云代理优先，否则本机 */
  function apiBase() {
    let cloud = null;
    try { cloud = localStorage.getItem('englishSite.cloudProxy'); } catch (e) { /* ignore */ }
    if (cloud && /^https?:\/\//.test(cloud)) {
      return cloud.replace(/\/+$/, '');
    }
    return '';   // 空 = 本地代理（同源 /api/...）
  }

  async function fetchJson(url) {
    let resp;
    try { resp = await fetch(url); } catch (e) {
      throw { type: 'network', msg: '无法连接视频服务，请检查网络或代理设置' };
    }
    if (!resp.ok) throw { type: 'network', msg: '视频服务异常 HTTP ' + resp.status };
    let j;
    try { j = await resp.json(); } catch (e) {
      throw { type: 'network', msg: '返回数据格式错误' };
    }
    if (j.code !== 0) throw { type: 'business', code: j.code, msg: j.message || ('错误码 ' + j.code) };
    return j.data;
  }

  /** b23.tv 短链 → 长链（代理跟随重定向后返回最终 URL） */
  async function resolveShortUrl(shortUrl) {
    const resp = await fetch(`${apiBase()}/api/bili/resolve?url=${encodeURIComponent(shortUrl)}`);
    if (!resp.ok) throw { type: 'network', msg: '短链解析失败' };
    const j = await resp.json();
    if (!j.finalUrl) throw { type: 'business', msg: '短链解析失败' };
    return j.finalUrl;
  }

  /**
   * 获取视频元信息。bvid 已知 → 直接用；
   * 只有短链 → 先经代理解析长链拿 BV。
   * 返回 { bvid, title, cover, duration, cid }
   */
  async function fetchVideoInfo({ bvid, biliShortUrl }) {
    let finalBvid = bvid;
    if (!finalBvid && biliShortUrl) {
      const longUrl = await resolveShortUrl(biliShortUrl);
      finalBvid = App.Parse.extractBvid(longUrl);
      if (!finalBvid) throw { type: 'business', msg: '短链未能解析出视频（可能已失效）' };
    }
    if (!finalBvid) throw { type: 'invalid', msg: '未识别到 B站 BV 号' };

    const d = await fetchJson(`/api/bili/view?bvid=${encodeURIComponent(finalBvid)}`);
    return {
      bvid: finalBvid,
      title: d.title || '',
      cover: d.pic || null,                 // 注：封面为 http://i0.hdslb.com 等，http 下页面 https 会被动升级，可能加载失败但不影响功能
      duration: d.duration != null ? d.duration : null,   // 秒
      cid: d.cid || null
    };
  }

  /**
   * 获取播放直链（音画合一 mp4，durl）
   * qn: 64=720P, 32=360P（注意 accept_quality 因视频而异）
   *
   * 注意：直链的 Referer 防盗链校验只在服务器侧通过（见 /api/bili/stream 流代理），
   * 浏览器内不得直接访问 CDN 直链（本地 Referer 会 403）。
   * 返回 { durl: [{url, length, size}], quality, timelength }
   */
  async function fetchPlayUrl(bvid, cid, qn) {
    const url = `${apiBase()}/api/bili/playurl?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(cid)}&qn=${qn || 64}`;
    const d = await fetchJson(url);
    if (!d || !Array.isArray(d.durl) || !d.durl.length) {
      throw { type: 'business', msg: '该视频暂无可用播放源' };
    }
    return d;
  }

  /**
   * 流代理地址（浏览器端统一走代理，避免 CDN Referer 403）
   * 该地址支持 Range，浏览器 <video> 可正常拖动进度条。
   */
  function streamUrl(bvid, cid, qn) {
    return `${apiBase()}/api/bili/stream?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(cid)}&qn=${qn || 64}`;
  }

  /** iframe 官方嵌入地址（降级方案2） */
  function embedUrl(bvid) {
    return `//player.bilibili.com/player.html?bvid=${bvid}&page=1&high_quality=1&danmaku=0`;
  }

  /** 读取云代理地址（UI 用） */
  function getCloudProxy() {
    try { return localStorage.getItem('englishSite.cloudProxy') || ''; } catch (e) { return ''; }
  }

  /** 保存云代理地址 */
  function setCloudProxy(url) {
    try {
      if (url) localStorage.setItem('englishSite.cloudProxy', url);
      else localStorage.removeItem('englishSite.cloudProxy');
    } catch (e) { /* ignore */ }
  }

  App.Bili = { fetchVideoInfo, fetchPlayUrl, streamUrl, embedUrl, apiBase, getCloudProxy, setCloudProxy };
})();
