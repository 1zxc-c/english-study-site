/**
 * player.js —— 播放器控制：B站 mp4 直链播放 / iframe 降级、抖音外链、
 * 15秒快进快退、快捷键、进度保存续播、关键节点跳转。
 * 只操作 video 元素与回调。
 */
(function () {
  'use strict';
  window.App = window.App || {};

  const SAVE_THROTTLE_MS = 5000;   // 进度保存节流
  const STEP_SEC = 15;             // 快进快退步长

  /**
   * 初始化 B站 播放器：
   * 1) mp4 直链（经本地代理拿新鲜签名）原生播放
   * 2) 失败 → iframe 官方嵌入
   * 3) 再失败 → 显示外链入口（由 UI 处理）
   * container 为播放器容器元素；回调 onState('loading'|'playing'|'iframe'|'error', msg)
   */
  async function initBiliPlayer(container, item, onState) {
    onState('loading');
    try {
      // 缺 cid 时先补解析
      if (!item.cid) {
        const info = await App.Bili.fetchVideoInfo({ bvid: item.bvid });
        item.cid = info.cid;
        if (!item.title || item.title === '未命名视频') item.title = info.title;
        if (!item.duration) item.duration = info.duration;
        App.Storage.save(App.state.data);
      }
      // 校验可播放性（顺带确认 cid 有效），然后走本地流代理播放
      await App.Bili.fetchPlayUrl(item.bvid, item.cid, 64);
      const url = App.Bili.streamUrl(item.bvid, item.cid, 64);

      const video = document.createElement('video');
      video.className = 'player-video';
      video.controls = true;
      video.playsInline = true;
      video.preload = 'auto';
      container.innerHTML = '';
      container.appendChild(video);
      video.src = url;

      // 慢网保护：下载有进展就重置计时；连续 30 秒既无进展也无错误才降级 iframe
      let failTimer = null;
      let lastProgress = Date.now();
      const armFailTimer = () => {
        clearTimeout(failTimer);
        failTimer = setTimeout(() => {
          if (video.error) {
            fallbackExternal(container, item, "直链播放失败");
            onState('iframe', '直链播放失败，已切换官方嵌入播放');
          } else if (Date.now() - lastProgress > 30000 && video.readyState < 2) {
            fallbackExternal(container, item, "视频加载超时");
            onState('iframe', '视频加载超时，已切换官方嵌入播放');
          } else {
            armFailTimer();   // 仍在进展，继续等
          }
        }, 15000);
      };
      video.addEventListener('progress', () => { lastProgress = Date.now(); });
      video.addEventListener('loadedmetadata', () => { clearTimeout(failTimer); });

      function cleanup() { clearTimeout(failTimer); }

      video.addEventListener('error', () => {
        cleanup();
        fallbackExternal(container, item);
        onState('iframe', '直链播放失败，已切换官方嵌入播放');
      }, { once: true });
      video.addEventListener('loadedmetadata', () => {
        cleanup();
        // 恢复上次进度
        if (item.progress && item.progress.current > 5) {
          try { video.currentTime = Math.min(item.progress.current, (video.duration || 0) - 5); } catch (e) { /* ignore */ }
        }
      });
      armFailTimer();

      App.Player._attachControls(video, item, onState);
      onState('playing');
      return video;
    } catch (e) {
      console.warn('[player] direct play failed:', e);
      fallbackExternal(container, item);
      onState('iframe', e && e.msg ? e.msg : '直链获取失败，已切换官方嵌入播放');
      return null;
    }
  }

  /** 降级：左侧区域内 iframe 加载完整视频页（不新开标签，右侧笔记常驻） */
  function fallbackExternal(container, item, reason) {
    container.innerHTML = '';
    const iframe = document.createElement('iframe');
    iframe.className = 'player-iframe';
    iframe.src = item.sourceUrl;
    iframe.setAttribute('allowfullscreen', '');
    iframe.setAttribute('allow', 'autoplay; fullscreen; encrypted-media');
    container.appendChild(iframe);
    container.classList.add('player-embed');   // 高度自适应内容
    // 提示移到播放器框下方（由 onState 通知 UI 渲染），此处仅通知
    if (reason) {
      // 回调给 UI 显示提示行
      const evt = new CustomEvent('player-fallback', {
        detail: { url: item.sourceUrl, reason }
      });
      container.dispatchEvent(evt);
    }
    return iframe;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** 降级：iframe 官方嵌入（旧逻辑，保留备用） */
  function fallbackIframe(container, item) {
    container.innerHTML = '';
    const iframe = document.createElement('iframe');
    iframe.className = 'player-iframe';
    iframe.src = App.Bili.embedUrl(item.bvid);
    iframe.setAttribute('allowfullscreen', '');
    iframe.setAttribute('allow', 'autoplay; fullscreen; encrypted-media');
    container.appendChild(iframe);
    container.classList.add('player-embed');
    return iframe;
  }

  /** 抖音：容器显示外链按钮（由 UI 决定布局），这里只提供跳转 */
  function openExternal(item) {
    window.open(item.sourceUrl, '_blank');
  }

  /** 统一播放控制（B站直链 & 有进度条的场景） */
  function _attachControls(video, item, onState) {
    let lastSave = 0;

    // 1) 进度保存（节流）
    video.addEventListener('timeupdate', () => {
      const now = Date.now();
      if (now - lastSave >= SAVE_THROTTLE_MS && video.currentTime > 0) {
        lastSave = now;
        item.progress = { current: video.currentTime, updatedAt: now };
        item.lastPlayedAt = now;
        App.Storage.save(App.state.data);
      }
      // 2) 播放 → 每日库自动「学习中」
      if (!video.__learningSet && !video.paused && video.currentTime > 0) {
        video.__learningSet = true;
        App.Review.ensureLearning(item);
        App.Storage.save(App.state.data);
        App.UI.refreshDetailState && App.UI.refreshDetailState();
      }
    });

    // 3) 播完 → 感兴趣库自动「已观看」
    video.addEventListener('ended', () => {
      App.Review.markAutoWatched(item);
      App.Storage.save(App.state.data);
      App.UI.refreshDetailState && App.UI.refreshDetailState();
    });
  }

  /* ---------- 供 UI 调用的控制动作 ---------- */

  function getVideo() {
    return document.querySelector('#detail-player .player-video');
  }

  function seekBy(delta) {
    const v = getVideo();
    if (!v) return;
    const dur = v.duration || 0;
    v.currentTime = Math.max(0, Math.min(dur > 0 ? dur - 0.5 : 0, v.currentTime + delta));
  }

  function togglePlay() {
    const v = getVideo();
    if (!v) return;
    if (v.paused) v.play().catch(() => {}); else v.pause();
  }

  function jumpTo(time) {
    const v = getVideo();
    if (!v) return;
    const dur = v.duration || 0;
    v.currentTime = dur > 0 ? Math.min(time, dur - 0.5) : time;
  }

  function setVolume(delta) {
    const v = getVideo();
    if (!v) return;
    v.volume = Math.max(0, Math.min(1, v.volume + delta));
    v.muted = false;
  }

  function toggleMute() {
    const v = getVideo();
    if (!v) return;
    v.muted = !v.muted;
  }

  function toggleFullscreen() {
    const v = getVideo();
    if (!v) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else if (v.requestFullscreen) v.requestFullscreen().catch(() => {});
  }

  /* ---------- 快捷键 ---------- */

  const SHORTCUTS = {
    ' ': togglePlay,
    'ArrowLeft': () => seekBy(-STEP_SEC),
    'ArrowRight': () => seekBy(STEP_SEC),
    'ArrowUp': () => setVolume(0.1),
    'ArrowDown': () => setVolume(-0.1),
    'f': toggleFullscreen,
    'm': toggleMute,
    'n': () => App.UI.addMarkerAtCurrentTime && App.UI.addMarkerAtCurrentTime(),
    '[': () => App.UI.jumpPrevMarker && App.UI.jumpPrevMarker(),
    ']': () => App.UI.jumpNextMarker && App.UI.jumpNextMarker()
  };

  /** 焦点在输入控件时不触发快捷键 */
  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  function bindShortcuts() {
    document.addEventListener('keydown', e => {
      if (App.UI.activeModal) return;                    // 弹窗打开时不响应
      if (isTypingTarget(e.target)) return;              // 输入框内不误触
      if (App.state.view !== 'detail') return;           // 仅详情页
      if (!document.querySelector('#detail-player .player-video')) return; // 需有站内播放器
      const fn = SHORTCUTS[e.key];
      if (fn) { e.preventDefault(); fn(); }
    });
  }

  App.Player = {
    STEP_SEC,
    initBiliPlayer, fallbackExternal, fallbackIframe, openExternal,
    _attachControls,
    getVideo, seekBy, togglePlay, jumpTo, setVolume, toggleMute, toggleFullscreen,
    bindShortcuts
  };
})();
