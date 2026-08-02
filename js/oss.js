/**
 * oss.js —— 阿里云 OSS 数据同步（基于官方 SDK，浏览器端可用）
 *
 * 原理：官方 ali-oss SDK 处理所有签名/请求细节（含浏览器 Date 头限制），
 *       配置存 localStorage key: englishSite.oss（bucket/region/ak/sk）。
 * 数据文件：<bucket>/app-data/english-study-site-data.json
 *
 * ⚠ 安全：AccessKey 存本机浏览器 localStorage。仅适合个人/信任设备。
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

  /** 创建 OSS 客户端实例 */
  function createClient(cfg) {
    if (typeof OSS === 'undefined') return null;
    return new OSS({
      region: cfg.region,
      bucket: cfg.bucket,
      accessKeyId: cfg.ak,
      accessKeySecret: cfg.sk,
      secure: true
    });
  }

  /** 上传数据到 OSS */
  async function uploadData(cfg, data) {
    try {
      const client = createClient(cfg);
      if (!client) return { ok: false, msg: 'SDK 未加载' };
      const body = JSON.stringify(data);
      const result = await client.put(DATA_PATH, new Blob([body], { type: 'application/json' }));
      return result.res && (result.res.status === 200 || result.res.status === 201)
        ? { ok: true, msg: '已上传到云端' }
        : { ok: false, msg: '上传失败 HTTP ' + (result.res && result.res.status) };
    } catch (e) {
      return { ok: false, msg: '上传失败：' + (e && e.message ? e.message.slice(0, 80) : '未知错误') };
    }
  }

  /** 从 OSS 拉取数据 */
  async function downloadData(cfg) {
    try {
      const client = createClient(cfg);
      if (!client) return { ok: false, msg: 'SDK 未加载' };
      let result;
      try {
        result = await client.get(DATA_PATH);
      } catch (e) {
        // 404 = 云端无数据
        if (e && (e.status === 404 || e.code === 'NoSuchKey')) {
          return { ok: false, msg: '云端还没有数据，请先上传', notFound: true };
        }
        return { ok: false, msg: '拉取失败：' + (e && e.message ? e.message.slice(0, 80) : '未知错误') };
      }
      const text = result.content.toString('utf-8');
      let j;
      try { j = JSON.parse(text); } catch (e2) { return { ok: false, msg: '云端数据不是有效 JSON' }; }
      return { ok: true, data: j };
    } catch (e) {
      return { ok: false, msg: '拉取失败：' + (e && e.message ? e.message.slice(0, 80) : '未知错误') };
    }
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
            <input class="inp oss-bucket" placeholder="zynxj-english-data" value="${App.UI.esc(cfg.bucket || '')}"></div>
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
