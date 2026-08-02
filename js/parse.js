/**
 * parse.js —— 平台识别与链接解析（B站 / 抖音）
 * 纯逻辑，不碰 DOM。
 */
(function () {
  'use strict';
  window.App = window.App || {};

  const BV_RE = /BV[0-9A-Za-z]{10}/;
  const BILI_SHORT_RE = /https?:\/\/(?:www\.)?b23\.tv\/[A-Za-z0-9]+/i;
  const BILI_FULL_RE = /https?:\/\/(?:www\.|m\.)?bilibili\.com\/video\/(BV[0-9A-Za-z]{10})/i;
  const DOUYIN_SHORT_RE = /https?:\/\/v\.douyin\.com\/[A-Za-z0-9_-]+/i;
  const DOUYIN_FULL_RE = /https?:\/\/(?:www\.)?douyin\.com\/video\/(\d+)/i;
  const DOUYIN_SHARE_RE = /douyin\.com\/(?:share\/)?video\/(\d+)/i;
  const TITLE_BRACKET_RE = /【(.{1,60}?)】/;   // 【标题】形式（B站分享）

  /**
   * 从分享文本提取标题（无需网络）：
   *  - B站分享文本通常是 【标题】BV号 https://b23.tv/xxx → 取【】内
   *  - 抖音分享文本通常是 "文案 复制打开抖音..." → 取最前面的文案（最多 40 字）
   */
  function extractTitle(text) {
    if (!text) return '';
    const t = text.trim();
    // B站【】标题
    const b = t.match(TITLE_BRACKET_RE);
    if (b) return b[1].trim();
    // 去掉链接后的前置文案（抖音/其他）
    const withoutLinks = t
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/BV[0-9A-Za-z]{10}/g, ' ')
      .replace(/[\s|｜]+/g, ' ')
      .trim();
    // 抖音的"复制打开抖音"尾部提示去掉
    const cleaned = withoutLinks
      .replace(/复制.*?(抖音|打开).*$/g, '')
      .replace(/^[0-9.]+[,\s]\s*/, '')
      .trim();
    return cleaned.slice(0, 40);
  }

  /**
   * 从分享文本识别平台，返回：
   * { platform:'bilibili'|'douyin'|null, bvid, biliShortUrl, douyinUrl, canonical }
   * canonical = 规范化播放链接（B站 www 长链 / 抖音原分享链接）
   */
  function detect(text) {
    if (!text) return { platform: null };
    const t = text.trim();

    // B站：完整链接 / BV 号 / b23 短链
    const full = t.match(BILI_FULL_RE);
    const bv = t.match(BV_RE);
    const short = t.match(BILI_SHORT_RE);

    if (full || bv || short) {
      const bvid = (full && full[1]) || (bv && bv[0]) || null;
      return {
        platform: 'bilibili',
        bvid,
        biliShortUrl: short ? short[0] : null,
        canonical: bvid ? `https://www.bilibili.com/video/${bvid}` : (short ? short[0] : null)
      };
    }

    // 抖音：短链 / 完整链接
    const dyShort = t.match(DOUYIN_SHORT_RE);
    const dyFull = t.match(DOUYIN_FULL_RE) || t.match(DOUYIN_SHARE_RE);
    if (dyShort || dyFull) {
      const url = (dyFull && dyFull[0]) || dyShort[0];
      return {
        platform: 'douyin',
        douyinUrl: url,
        canonical: url
      };
    }

    return { platform: null };
  }

  /** 纯文本里提 BV 号 */
  function extractBvid(text) {
    const m = text && text.match(BV_RE);
    return m ? m[0] : null;
  }

  App.Parse = { detect, extractBvid, extractTitle };
})();
