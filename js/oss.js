/**
 * oss.js —— 阿里云 OSS 数据同步（在线版可用，无需本地服务）
 *
 * 原理：浏览器端直接用 AccessKey 对 OSS 请求做签名（HMAC-SHA1），
 *       实现数据的 PUT（上传）/ GET（下载）—— 存到私有路径，只有带密钥的客户端能读写。
 *
 * 配置存 localStorage key: englishSite.oss（含 bucket/region/ak/sk）
 * 数据文件路径：<bucket>/app-data/english-study-site-data.json
 *
 * ⚠ 安全：AccessKey 存本机浏览器 localStorage。本方案仅适合个人单机/信任设备使用；
 *         更安全的做法是用云函数代理签名（见 cloud-functions），本地版可用。
 */
(function () {
  'use strict';
  window.App = window.App || {};

  const OSS_KEY = 'englishSite.oss';
  const DATA_PATH = 'app-data/english-study-site-data.json';

  function loadCfg() {
    try {
      const raw = localStorage.getItem(OSS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function saveCfg(c) {
    localStorage.setItem(OSS_KEY, JSON.stringify(c));
  }

  function clearCfg() {
    localStorage.removeItem(OSS_KEY);
  }

  /** 阿里云 OSS 签名请求（HMAC-SHA1）
   *  注意：签名串与请求头必须完全一致（Content-Type 都留空，
   *  OSS 对 JSON 按二进制存储，读取后前端自行解析，不影响使用） */
  async function ossRequest(cfg, method, path, body) {
    const { bucket, region, ak, sk } = cfg;
    const host = `${bucket}.${region}.aliyuncs.com`;
    const date = new Date().toUTCString();
    const canonicalizedResource = `/${bucket}/${path}`;
    // 签名串：METHOD\nContent-MD5\nContent-Type\nDate\nCanonicalizedResource（均留空）
    const stringToSign = `${method}\n\n\n${date}\n${canonicalizedResource}`;

    // HMAC-SHA1 签名（浏览器端需支持 crypto.subtle 或 fallback）
    const sig = await hmacSha1(sk, stringToSign);
    const auth = `OSS ${ak}:${sig}`;

    const url = `https://${host}/${encodeURI(path)}`;
    const headers = { 'Date': date, 'Authorization': auth };

    const resp = await fetch(url, { method, headers, body });
    return resp;
  }

  /** HMAC-SHA1 签名（优先 Web Crypto，fallback 纯 JS 实现） */
  async function hmacSha1(key, message) {
    // 尝试 Web Crypto
    try {
      if (crypto && crypto.subtle) {
        const enc = new TextEncoder();
        const keyData = await crypto.subtle.importKey(
          'raw', enc.encode(key),
          { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
        );
        const sigBuf = await crypto.subtle.sign('HMAC', keyData, enc.encode(message));
        const sigBytes = new Uint8Array(sigBuf);
        let bin = '';
        sigBytes.forEach(b => { bin += String.fromCharCode(b); });
        return btoa(bin);
      }
    } catch (e) { /* fallback below */ }
    // 纯 JS fallback（SHA-1 + HMAC）
    return jsHmacSha1(key, message);
  }

  /* ---------- 纯 JS SHA-1 / HMAC 实现（fallback） ---------- */

  function jsHmacSha1(key, message) {
    function sha1(msg) {
      // 标准 SHA-1 实现
      function rotl(n, b) { return (n << b) | (n >>> (32 - b)); }
      function toHex(n) { let s = ''; for (let i = 28; i >= 0; i -= 4) s += ((n >>> i) & 0xf).toString(16); return s; }
      const ml = msg.length * 8;
      const msg2 = msg + String.fromCharCode(0x80);
      while (msg2.length % 64 !== 56) msg2 += String.fromCharCode(0);
      const words = [];
      for (let i = 0; i < msg2.length; i += 4) {
        words.push(((msg2.charCodeAt(i) << 24) | (msg2.charCodeAt(i + 1) << 16) | (msg2.charCodeAt(i + 2) << 8) | msg2.charCodeAt(i + 3)) >>> 0);
      }
      words.push(ml >>> 32); words.push(ml >>> 0);
      let h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;
      for (let i = 0; i < words.length; i += 16) {
        const w = words.slice(i, i + 16);
        for (let t = 16; t < 80; t++) w[t] = rotl(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);
        let a = h0, b = h1, c = h2, d = h3, e = h4;
        for (let t = 0; t < 80; t++) {
          const f = t < 20 ? ((b & c) | (~b & d)) : t < 40 ? (b ^ c ^ d) : t < 60 ? ((b & c) | (b & d) | (c & d)) : (b ^ c ^ d);
          const k = t < 20 ? 0x5A827999 : t < 40 ? 0x6ED9EBA1 : t < 60 ? 0x8F1BBCDC : 0xCA62C1D6;
          const tmp = (rotl(a, 5) + f + e + k + w[t]) >>> 0;
          e = d; d = c; c = rotl(b, 30); b = a; a = tmp;
        }
        h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
      }
      return toHex(h0) + toHex(h1) + toHex(h2) + toHex(h3) + toHex(h4);
    }
    // HMAC: key 分块处理
    const blockSize = 64;
    let k = key;
    if (k.length > blockSize) k = sha1(k);
    while (k.length < blockSize) k += String.fromCharCode(0);
    const ipad = [], opad = [];
    for (let i = 0; i < blockSize; i++) {
      ipad.push(String.fromCharCode(k.charCodeAt(i) ^ 0x36));
      opad.push(String.fromCharCode(k.charCodeAt(i) ^ 0x5c));
    }
    const inner = sha1(ipad.join('') + message);
    return sha1(opad.join('') + inner);
  }

  /* ---------- 对外接口 ---------- */

  /** 上传数据到 OSS */
  async function uploadData(cfg, data) {
    const body = JSON.stringify(data);
    const resp = await ossRequest(cfg, 'PUT', DATA_PATH, body, 'application/json');
    if (resp.ok || resp.status === 200) return { ok: true, msg: '已上传到云端' };
    const t = await resp.text().catch(() => '');
    return { ok: false, msg: '上传失败 HTTP ' + resp.status + (t.includes('AccessDenied') ? '（密钥权限不足）' : '') };
  }

  /** 从 OSS 拉取数据 */
  async function downloadData(cfg) {
    const resp = await ossRequest(cfg, 'GET', DATA_PATH);
    if (resp.status === 404) return { ok: false, msg: '云端还没有数据，请先上传', notFound: true };
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      return { ok: false, msg: '拉取失败 HTTP ' + resp.status + (t.includes('AccessDenied') ? '（密钥权限不足）' : '') };
    }
    let j;
    try { j = await resp.json(); } catch (e) { return { ok: false, msg: '云端数据不是有效 JSON' }; }
    return { ok: true, data: j };
  }

  /** 执行同步：比较 updatedAt，新者优先 */
  async function syncNow(cfg) {
    const localUpdated = App.state.data.updatedAt || 0;
    const dl = await downloadData(cfg);
    if (dl.notFound) return uploadData(cfg, App.state.data);
    if (!dl.ok) return dl;
    const remote = dl.data;
    if (!remote || !remote.schemaVersion) return { ok: false, msg: '云端数据格式异常' };
    if ((remote.updatedAt || 0) > localUpdated) {
      App.state.data = remote;
      // 保留远端时间戳
      try { localStorage.setItem(App.Storage.KEY, JSON.stringify(remote)); } catch (e) { /* ignore */ }
      return { ok: true, msg: '已从云端拉取更新', action: 'pulled' };
    }
    if ((remote.updatedAt || 0) < localUpdated) return uploadData(cfg, App.state.data);
    return { ok: true, msg: '两端数据一致', action: 'none' };
  }

  /** 设置弹窗 */
  function openOssModal() {
    const cfg = loadCfg() || {};
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    App.UI.activeModal = overlay;
    document.body.classList.add('modal-open');
    overlay.innerHTML = `
      <div class="modal">
        <h3 class="modal-title">阿里云 OSS 数据同步</h3>
        <div class="modal-body">
          <p class="dim">配置后，数据自动上传/下载到你的阿里云 OSS，多设备（含手机在线版）共享同一份数据。</p>
          <div class="form-row"><span class="form-label">Bucket</span>
            <input class="inp oss-bucket" placeholder="ynxj-english-data" value="${App.UI.esc(cfg.bucket || '')}"></div>
          <div class="form-row"><span class="form-label">地域</span>
            <input class="inp oss-region" placeholder="oss-cn-beijing" value="${App.UI.esc(cfg.region || '')}"></div>
          <div class="form-row"><span class="form-label">AccessKey</span>
            <input class="inp oss-ak" placeholder="LTAI... " value="${App.UI.esc(cfg.ak || '')}"></div>
          <div class="form-row"><span class="form-label">Secret</span>
            <input class="inp oss-sk" type="password" placeholder="你的 Secret" value="${App.UI.esc(cfg.sk || '')}"></div>
          <p class="dim">⚠ 密钥仅存本机浏览器。建议使用只授权 OSS 的 RAM 子账号密钥。</p>
          <div class="sync-status" data-act="oss-status"></div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-act="cancel">关闭</button>
          <button class="btn btn-ghost" data-act="save">保存</button>
          <button class="btn btn-primary" data-act="sync">立即同步</button>
        </div>
      </div>`;
    document.getElementById('modal-root').appendChild(overlay);
    App.UI.wireModalDismiss && App.UI.wireModalDismiss(overlay);
    const $ = sel => overlay.querySelector(sel);
    const status = $('[data-act=oss-status]');
    const setStatus = (m, ok) => { status.innerHTML = `<span class="${ok === false ? 'text-danger' : 'dim'}">${App.UI.esc(m)}</span>`; };
    const collect = () => ({
      bucket: $('.oss-bucket').value.trim(),
      region: $('.oss-region').value.trim(),
      ak: $('.oss-ak').value.trim(),
      sk: $('.oss-sk').value.trim()
    });
    const validate = c => {
      if (!c.bucket || !c.region || !c.ak || !c.sk) return '请填写全部 4 项';
      return null;
    };
    $('[data-act=cancel]').onclick = () => App.UI.closeModal(overlay);
    $('[data-act=save]').onclick = () => {
      const c = collect();
      const err = validate(c);
      if (err) { setStatus(err, false); return; }
      saveCfg(c);
      setStatus('已保存', true);
    };
    $('[data-act=sync]').onclick = async () => {
      const c = collect();
      const err = validate(c);
      if (err) { setStatus(err, false); return; }
      saveCfg(c);
      const btn = $('[data-act=sync]');
      btn.disabled = true;
      setStatus('正在同步…');
      try {
        const r = await syncNow(c);
        setStatus(r.msg, r.ok);
      } catch (e) {
        setStatus('同步失败：' + e.message, false);
      }
      btn.disabled = false;
    };
  }

  /** 启动自动同步（静默） */
  async function autoSync() {
    const cfg = loadCfg();
    if (!cfg || !cfg.bucket) return;
    try { await syncNow(cfg); } catch (e) { /* 静默 */ }
  }

  App.Oss = { loadCfg, saveCfg, clearCfg, syncNow, uploadData, downloadData, openOssModal, autoSync };
})();
