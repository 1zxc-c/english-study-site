/**
 * ui.js —— 全部视图渲染（列表/详情/导入弹窗/转移弹窗）+ 事件委托
 * 渲染约定：render → innerHTML → afterRender 绑定（动态行一律事件委托）。
 */
(function () {
  'use strict';
  window.App = window.App || {};

  const D = () => App.Data;
  const S = () => App.Data.STATUS;
  const R = () => App.Review;

  /* ---------- 工具 ---------- */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function delegate(root, event, selector, handler) {
    root.addEventListener(event, e => {
      const el = e.target.closest ? e.target.closest(selector) : null;
      if (el && root.contains(el)) handler(e, el);
    });
  }

  function toast(msg, isError) {
    const root = document.getElementById('toast-root');
    const t = document.createElement('div');
    t.className = 'toast' + (isError ? ' toast-error' : '');
    t.textContent = msg;
    root.appendChild(t);
    setTimeout(() => { t.classList.add('toast-out'); setTimeout(() => t.remove(), 300); }, 2500);
  }

  /** 确认弹窗（Promise<boolean>） */
  function confirmModal({ title, message, confirmText = '确定', danger = false }) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal" role="dialog">
          <h3 class="modal-title">${esc(title)}</h3>
          <div class="modal-body">${message}</div>
          <div class="modal-actions">
            <button class="btn btn-ghost" data-act="cancel">取消</button>
            <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok">${esc(confirmText)}</button>
          </div>
        </div>`;
      App.UI.activeModal = overlay;
      document.getElementById('modal-root').appendChild(overlay);
      document.body.classList.add('modal-open');
      overlay.querySelector('[data-act=cancel]').onclick = () => { closeModal(overlay); resolve(false); };
      overlay.querySelector('[data-act=ok]').onclick = () => { closeModal(overlay); resolve(true); };
      wireModalDismiss(overlay);
    });
  }

  function closeModal(overlay) {
    if (overlay) overlay.remove();
    if (!document.getElementById('modal-root').children.length) {
      document.body.classList.remove('modal-open');
      App.UI.activeModal = null;
    }
  }

  /** 给弹窗统一加交互：遮罩点击关闭 + Escape 关闭（自动清理，防叠加） */
  function wireModalDismiss(overlay) {
    // 遮罩点击关闭（仅当点击的是遮罩本身，不是弹窗内容）
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(overlay); });
    // Escape 关闭（只处理当前最上层弹窗）
    const escHandler = e => {
      if (e.key === 'Escape' && overlay.isConnected) closeModal(overlay);
    };
    document.addEventListener('keydown', escHandler);
    // 弹窗关闭时移除监听，防止泄漏/叠加
    const origRemove = overlay.remove.bind(overlay);
    overlay.remove = function () {
      document.removeEventListener('keydown', escHandler);
      return origRemove();
    };
  }

  /* ---------- 状态徽章 ---------- */

  function statusBadge(item) {
    const cls = {
      unlearned: 'badge badge-gray', learning: 'badge badge-blue',
      learned: 'badge badge-indigo', reviewDone: 'badge badge-green',
      unwatched: 'badge badge-gray', watched: 'badge badge-indigo'
    };
    return `<span class="${cls[item.status] || 'badge badge-gray'}">${D().STATUS_LABEL[item.status] || item.status}</span>`;
  }

  /** 下一次复习日期文案（今天/明天/逾期N天） */
  function nextReviewText(item) {
    if (!item.review || item.review.completedAt) return '<span class="dim">—</span>';
    const next = item.review.nextReviewAt;
    if (R().isDueToday(item)) {
      const od = R().overdueDays(item);
      return `<span class="text-danger">${od > 0 ? '已逾期 ' + od + ' 天' : '今天'}</span>`;
    }
    return `<span class="text-ok">${D().relativeDay(next)}</span>`;
  }

  /* ---------- 列表视图 ---------- */

  function renderList(lib) {
    const data = App.state.data;
    const videos = data.videos.filter(v => v.library === lib);
    const today = new Date();
    const pad = n => String(n).padStart(2, '0');

    const filterState = App.state.filter[lib] || {};
    const catSel = filterState.category || '';
    const kw = (filterState.keyword || '').trim().toLowerCase();
    const dueDay = filterState.dueDay ? parseInt(filterState.dueDay) : null;
    const shown = videos.filter(v =>
      (!catSel || v.category === catSel) &&
      (!kw || (v.title || '').toLowerCase().includes(kw)) &&
      (!dueDay || (v.review && v.review.nextReviewAt && D().dateToStartOfDay(v.review.nextReviewAt) === dueDay))
    );

    const categories = ['', ...data.settings.categories].filter(c => c !== '' || true);

    let html = '';
    if (lib === 'daily') html += renderDuePanel(videos) + renderReviewOverview(videos);
    html += `
      <div class="list-toolbar">
        <select class="sel sel-cat" data-act="filter-cat">
          <option value="">全部分区</option>
          ${data.settings.categories.map(c => `<option value="${esc(c)}" ${c === catSel ? 'selected' : ''}>${esc(c)}</option>`).join('')}
        </select>
        ${lib === 'daily' ? renderCalendarToggle(videos) : ''}
        <input class="inp list-search" data-act="filter-kw" placeholder="搜索标题…" value="${esc(filterState.keyword || '')}">
        ${dueDay ? `<span class="due-day-chip" data-act="clear-day">📅 ${D().formatDate(dueDay)} 待复习 <b>×</b></span>` : ''}
        <span class="dim count">${shown.length} / ${videos.length} 条</span>
      </div>
      ${lib === 'daily' ? renderCalendarBody(videos, filterState) : ''}
    `;

    if (!shown.length) {
      html += emptyState(videos.length === 0
        ? (lib === 'daily' ? '每日学习库还没有视频' : '感兴趣视频库还没有视频')
        : '没有符合条件的视频');
    } else {
      html += `<ul class="vlist">`;
      shown.forEach(v => {
        const cat = v.category ? `<span class="tag">${esc(v.category)}</span>` : '';
        const cover = v.cover
          ? `<img class="thumb" src="${esc(v.cover)}" alt="" loading="lazy" onerror="this.style.display='none'">`
          : `<div class="thumb thumb-ph" title="无封面">${v.platform === 'bilibili' ? 'B站' : '抖音'}</div>`;
        html += `
          <li class="vrow" data-id="${v.id}">
            ${cover}
            <div class="vrow-main">
              <div class="vrow-title">${esc(v.title)} ${cat}</div>
              <div class="vrow-sub dim">${v.platform === 'bilibili' ? 'B站' : '抖音'} · 导入于 ${D().formatDateTime(v.importedAt)}</div>
            </div>
            ${lib === 'daily' ? `
              <div class="vrow-cell">${statusBadge(v)}</div>
              <div class="vrow-cell">${nextReviewText(v)}</div>` : `
              <div class="vrow-cell">${D().formatTime(v.duration)}</div>`}
            <div class="vrow-actions">
              <button class="btn btn-sm btn-primary" data-act="play" title="打开播放">播放</button>
              <button class="btn btn-sm btn-ghost" data-act="rename" title="修改标题">改名</button>
              <button class="btn btn-sm btn-ghost" data-act="recat" title="修改分区">分区</button>
              <button class="btn btn-sm btn-ghost" data-act="transfer" title="移到另一库">转移</button>
              <button class="btn btn-sm btn-ghost-danger" data-act="delete" title="删除">删除</button>
            </div>
          </li>`;
      });
      html += '</ul>';
    }

    document.getElementById('view-root').innerHTML = html;
    document.getElementById('view-root').dataset.lib = lib;

    const root = document.getElementById('view-root');

    // 点击行（非按钮）→ 进详情
    delegate(root, 'click', '.vrow', e => {
      if (e.target.closest('.vrow-actions')) return;
      const id = e.target.closest('.vrow').dataset.id;
      location.hash = '#/video/' + id;
    });

    // 行内按钮
    delegate(root, 'click', '[data-act=play]', (e, el) => {
      location.hash = '#/video/' + el.closest('.vrow').dataset.id;
    });
    delegate(root, 'click', '[data-act=transfer]', async (e, el) => {
      const id = el.closest('.vrow').dataset.id;
      const item = App.state.data.videos.find(v => v.id === id);
      if (item) await openTransferModal(item, () => renderList(lib));
    });
    delegate(root, 'click', '[data-act=rename]', (e, el) => {
      const id = el.closest('.vrow').dataset.id;
      const item = App.state.data.videos.find(v => v.id === id);
      if (!item) return;
      const name = prompt('修改标题：', item.title || '');
      if (name && name.trim()) {
        item.title = name.trim();
        App.Storage.save(App.state.data);
        toast('标题已更新');
        renderList(lib);
      }
    });
    delegate(root, 'click', '[data-act=recat]', (e, el) => {
      const id = el.closest('.vrow').dataset.id;
      const item = App.state.data.videos.find(v => v.id === id);
      if (!item) return;
      openRecatModal(item, () => renderList(lib));
    });
    delegate(root, 'click', '[data-act=delete]', async (e, el) => {
      const id = el.closest('.vrow').dataset.id;
      const item = App.state.data.videos.find(v => v.id === id);
      if (!item) return;
      const ok = await confirmModal({
        title: '删除视频',
        message: `确定删除「${esc(item.title)}」吗？<br>笔记、节点、复习记录将一并删除，不可恢复。`,
        confirmText: '删除', danger: true
      });
      if (ok) {
        App.state.data.videos = App.state.data.videos.filter(v => v.id !== id);
        App.Storage.save(App.state.data);
        toast('已删除');
        renderList(lib);
      }
    });

    // 筛选
    delegate(root, 'change', '[data-act=filter-cat]', e => {
      App.state.filter[lib] = App.state.filter[lib] || {};
      App.state.filter[lib].category = e.target.value;
      renderList(lib);
    });
    let kwTimer = null;
    delegate(root, 'input', '[data-act=filter-kw]', e => {
      clearTimeout(kwTimer);
      kwTimer = setTimeout(() => {
        App.state.filter[lib] = App.state.filter[lib] || {};
        App.state.filter[lib].keyword = e.target.value;
        renderList(lib);
      }, 250);
    });

    // 日历交互：展开/收起、翻月、回到本月、点击日期筛选
    delegate(root, 'click', '[data-act=cal-toggle]', () => {
      App.state.calOpen = !App.state.calOpen;
      renderList(lib);
    });
    delegate(root, 'click', '[data-act=cal-prev]', () => {
      const d = App.state.calMonth || new Date();
      App.state.calMonth = new Date(d.getFullYear(), d.getMonth() - 1, 1);
      App.state.calOpen = true;
      renderList(lib);
    });
    delegate(root, 'click', '[data-act=cal-next]', () => {
      const d = App.state.calMonth || new Date();
      App.state.calMonth = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      App.state.calOpen = true;
      renderList(lib);
    });
    delegate(root, 'click', '[data-act=cal-today-btn]', () => {
      App.state.calMonth = new Date();
      App.state.calOpen = true;
      renderList(lib);
    });
    delegate(root, 'click', '[data-cal-day]', (e, el) => {
      const day = el.dataset.calDay;
      const f = App.state.filter[lib] = App.state.filter[lib] || {};
      // 再点同一日期 → 取消筛选
      if (f.dueDay === day) { delete f.dueDay; }
      else { f.dueDay = day; }
      renderList(lib);
    });
    delegate(root, 'click', '[data-act=clear-day]', () => {
      const f = App.state.filter[lib] = App.state.filter[lib] || {};
      delete f.dueDay;
      renderList(lib);
    });
  }

  /** 每日库顶部「今日待复习」面板 */
  function renderDuePanel(videos) {
    const due = R().getDueList(videos);
    if (!due.length) {
      return `
        <div class="due-panel due-empty">
          <span class="due-icon">✅</span> 今天没有待复习的视频
        </div>`;
    }
    const rows = due.map(v => {
      const od = R().overdueDays(v);
      return `
        <li class="due-row" data-id="${v.id}">
          <span class="due-title">${esc(v.title)}</span>
          <span class="due-date ${od > 0 ? 'text-danger' : ''}">${od > 0 ? '逾期 ' + od + ' 天' : '今天到期'}</span>
          <span class="due-round dim">第${v.review.round + 1}/${R().INTERVALS_DAYS.length}轮</span>
          <button class="btn btn-sm btn-primary" data-act="due-review">已复习</button>
        </li>`;
    }).join('');
    return `
      <div class="due-panel">
        <div class="due-header">
          <span class="due-title-lg">📌 今日待复习</span>
          <span class="due-count-badge">${due.length}</span>
        </div>
        <ul class="due-list">${rows}</ul>
      </div>`;
  }

  /** 复习日期总览：按日期分组展示所有进行中的复习计划 */
  function renderReviewOverview(videos) {
    // 收集进行中的复习计划（daily 库 + 有 review + 未完成）
    const plans = videos.filter(v => v.library === 'daily' && v.review && !v.review.completedAt && v.review.nextReviewAt);
    if (!plans.length) return '';

    // 按日期分组（本地时区零点）
    const groups = new Map();
    plans.forEach(v => {
      const day = D().dateToStartOfDay(v.review.nextReviewAt);
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day).push(v);
    });
    const sortedDays = [...groups.keys()].sort((a, b) => a - b);

    const rows = sortedDays.map(day => {
      const items = groups.get(day);
      const isToday = day === D().startOfToday();
      const overdue = day < D().startOfToday();
      const dateLabel = isToday ? '今天' : (overdue ? `已逾期 ${D().relativeDay(day)}` : D().relativeDay(day));
      return `
        <li class="ov-row ${isToday ? 'ov-today' : ''} ${overdue ? 'ov-overdue' : ''}">
          <span class="ov-date ${overdue ? 'text-danger' : ''}">${esc(dateLabel)} <span class="ov-count">${items.length}</span></span>
          <span class="ov-titles">${items.map(v => esc(v.title)).join('、')}</span>
        </li>`;
    }).join('');

    return `
      <div class="ov-panel">
        <div class="due-header">
          <span class="due-title-lg">🗓 复习日期总览</span>
          <span class="dim">未来 ${sortedDays.length} 个复习日 · ${plans.length} 条进行中</span>
        </div>
        <ul class="ov-list">${rows}</ul>
      </div>`;
  }

  /** 日历下拉按钮（与搜索框同排） */
  function renderCalendarToggle(videos) {
    // 统计本月有复习任务的日期数（供按钮摘要）
    const counts = calCounts(videos);
    const todayStart = D().startOfToday();
    const todayCnt = counts.get(todayStart) || 0;
    return `
      <span class="cal-toggle-inline" data-act="cal-toggle" title="展开/收起复习日历">
        🗓 复习日历
        ${todayCnt ? `<span class="cal-today-cnt" title="今日 ${todayCnt} 个待复习">${todayCnt}</span>` : ''}
        <span class="cal-arrow">${App.state.calOpen ? '▲' : '▼'}</span>
      </span>`;
  }

  /** 日历主体（下拉展开时显示） */
  function renderCalendarBody(videos, filterState) {
    if (!App.state.calOpen) return '';
    const counts = calCounts(videos);

    // 当前显示月份（默认今天所在月）
    const curMonth = App.state.calMonth || new Date();
    const selDay = filterState.dueDay ? parseInt(filterState.dueDay) : null;

    const y = curMonth.getFullYear(), m = curMonth.getMonth();
    const firstDay = new Date(y, m, 1);
    const startWeekday = (firstDay.getDay() + 6) % 7;   // 周一=0
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const todayStart = D().startOfToday();
    const prev = new Date(y, m - 1, 1), next = new Date(y, m + 1, 1);

    let cells = '';
    for (let i = 0; i < startWeekday; i++) cells += `<span class="cal-cell cal-empty"></span>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const ts = new Date(y, m, d).getTime();
      const cnt = counts.get(ts) || 0;
      const isToday = ts === todayStart;
      const isSel = selDay === ts;
      cells += `
        <span class="cal-cell ${isToday ? 'cal-today' : ''} ${cnt ? 'cal-has' : ''} ${isSel ? 'cal-selected' : ''}"
              ${cnt ? `data-cal-day="${ts}" title="${d}日 ${cnt} 个复习"` : ''}>
          ${d}
          ${cnt ? `<span class="cal-badge">${cnt}</span>` : ''}
        </span>`;
    }

    return `
      <div class="cal-wrap" data-act="cal-body">
        <div class="cal-nav">
          <button class="btn btn-sm btn-ghost" data-act="cal-prev" title="上一月">‹</button>
          <span class="cal-month">${y}年${m + 1}月</span>
          <button class="btn btn-sm btn-ghost" data-act="cal-next" title="下一月">›</button>
          <button class="btn btn-sm btn-ghost" data-act="cal-today-btn" title="回到本月">今天</button>
        </div>
        <div class="cal-weekdays">
          <span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span>
        </div>
        <div class="cal-grid">${cells}</div>
      </div>`;
  }

  /** 统计各日期复习数量（daily + review + 未完成） */
  function calCounts(videos) {
    const counts = new Map();
    videos.forEach(v => {
      if (v.library === 'daily' && v.review && !v.review.completedAt && v.review.nextReviewAt) {
        const day = D().dateToStartOfDay(v.review.nextReviewAt);
        counts.set(day, (counts.get(day) || 0) + 1);
      }
    });
    return counts;
  }

  function emptyState(msg) {
    return `
      <div class="empty">
        <div class="empty-icon">🎬</div>
        <div class="empty-msg">${esc(msg)}</div>
        <button class="btn btn-primary btn-lg" data-act="open-import">＋ 导入视频</button>
      </div>`;
  }

  /* ---------- 详情视图 ---------- */

  function renderDetail(id) {
    const item = App.state.data.videos.find(v => v.id === id);
    if (!item) { location.hash = '#/daily'; return; }
    App.state.detailId = id;
    App.state.view = 'detail';
    App.Player.destroy && App.Player.destroy();

    const isBili = item.platform === 'bilibili';
    const prog = R().getProgress(item);

    let html = `
      <div class="detail-wrap">
        <a class="back-link" href="#" data-act="back">← 返回</a>
        <div class="detail-grid" id="detail-grid">
          <div class="detail-main">
            <div class="player-box" id="detail-player"></div>
            ${isBili ? `
            <div class="player-controls">
              <button class="btn btn-ghost btn-step" data-act="seek-back" title="快退 15 秒 (←)">⏪ 15s</button>
              <button class="btn btn-ghost btn-step" data-act="seek-fwd" title="快进 15 秒 (→)">15s ⏩</button>
              <span class="dim">快捷键：空格播放 · ←/→ 15秒 · ↑/↓ 音量 · n 加节点 · [ ] 跳节点 · f 全屏 · m 静音</span>
            </div>` : ''}
          </div>
          <div class="splitter" id="splitter" title="拖动调节左右宽度" aria-label="拖动分隔条"></div>
          <div class="detail-side">
            <input class="inp title-edit" data-act="edit-title" value="${esc(item.title)}" title="点击修改标题">
            <div class="meta dim">
              ${isBili ? '哔哩哔哩' : '抖音'} · ${D().formatTime(item.duration)} · 导入于 ${D().formatDateTime(item.importedAt)}
              ${item.category ? ` · <span class="tag">${esc(item.category)}</span>` : ''}
            </div>

            <div class="side-block status-block">
              ${statusBadge(item)}
              ${item.library === 'daily' ? dailyStatusActions(item, prog) : interestStatusActions(item)}
            </div>

            ${prog ? `
              <div class="side-block">
                <div class="block-title">复习进度</div>
                <div class="review-dots">${reviewDots(prog)}</div>
                <div class="dim">
                  第 ${Math.min(prog.round, prog.total)} / ${prog.total} 轮
                  ${prog.completed ? '· ✅ 已全部完成' : (prog.nextDate ? ` · 下次 ${D().formatDate(prog.nextDate)}` : '')}
                </div>
              </div>` : ''}

            ${renderMarkersBlock(item)}
            ${!isBili ? `
              <div class="side-block">
                <div class="block-title">播放方式</div>
                <div class="dim">抖音视频在站内不做播放，点击下方按钮到原平台观看。</div>
                <button class="btn btn-primary btn-block" data-act="open-origin">在原平台播放 ↗</button>
              </div>` : ''}

            <div class="side-block">
              <div class="block-title">笔记</div>
              <textarea class="note-editor" data-act="note-editor" placeholder="记录生词、重点句子、观后总结…（Ctrl+S 保存，自动保存）">${esc(item.notes)}</textarea>
            </div>

            <div class="side-block side-actions">
              <button class="btn btn-ghost" data-act="transfer">转移库</button>
              <button class="btn btn-ghost-danger" data-act="delete">删除视频</button>
            </div>
          </div>
        </div>
      </div>`;

    document.getElementById('view-root').innerHTML = html;
    const root = document.getElementById('view-root');
    initSplitter(root);

    // 笔记绑定
    const ta = root.querySelector('[data-act=note-editor]');
    if (ta) App.Notes.bindNoteEditor(ta, item);

    // 标题编辑
    delegate(root, 'change', '[data-act=edit-title]', (e, el) => {
      const t = e.target.value.trim();
      if (t) { item.title = t; App.Storage.save(App.state.data); toast('标题已更新'); }
      else { e.target.value = item.title; }
    });

    // 返回按钮：走全局历史栈（最近 2 步，超限回首页）
    delegate(root, 'click', '[data-act=back]', e => {
      e.preventDefault();
      if (App.goBack) App.goBack();
      else location.replace('#/' + (App.state.fromList || 'daily'));
    });

    // 播放器初始化
    if (isBili) {
      const playerBox = document.getElementById('detail-player');
      // 嵌入失败提示：渲染到播放器框下方（独立行）
      playerBox.addEventListener('player-fallback', e => {
        const main = playerBox.parentElement;
        let hint = main.querySelector('.embed-fallback-hint');
        if (!hint) {
          hint = document.createElement('div');
          hint.className = 'embed-fallback-hint';
          main.appendChild(hint);
        }
        const d = e.detail || {};
        hint.innerHTML = `${d.reason ? esc(d.reason) + ' · ' : ''}<a href="${esc(d.url)}" target="_blank" rel="noopener">若页面未加载，点此在新标签打开 ↗</a>`;
      });
      App.Player.initBiliPlayer(playerBox, item, state => {
        const box = document.getElementById('detail-player');
        if (!box) return;
        box.classList.toggle('player-loading', state === 'loading');
        if (state === 'iframe' || state === 'error') {
          // 控件条里的 15s 按钮对 iframe 无效，降级时隐藏
          const ctrl = box.parentElement.querySelector('.player-controls');
          if (ctrl) ctrl.classList.add('controls-hidden');
        }
      });
    } else {
      // 抖音：平台禁止站内嵌入（拒绝连接），显示观看入口
      const box = document.getElementById('detail-player');
      box.innerHTML = `
        <div class="player-external">
          <div class="ext-icon">🎵</div>
          <div class="ext-msg">抖音不支持站内嵌入播放</div>
          <a class="btn btn-primary" href="${esc(item.sourceUrl)}" target="_blank" rel="noopener">去抖音观看 ↗</a>
        </div>`;
    }

    // 控制按钮（15秒 等）
    delegate(root, 'click', '[data-act=seek-back]', () => App.Player.seekBy(-App.Player.STEP_SEC));
    delegate(root, 'click', '[data-act=seek-fwd]', () => App.Player.seekBy(App.Player.STEP_SEC));
    delegate(root, 'click', '[data-act=open-origin]', () => App.Player.openExternal(item));
    delegate(root, 'click', '[data-act=add-marker]', () => addMarkerAtCurrentTime());
    delegate(root, 'click', '[data-act=del-marker]', async (e, el) => {
      const mid = el.dataset.mid;
      item.markers = item.markers.filter(m => m.id !== mid);
      App.Storage.save(App.state.data);
      renderDetail(id);   // 重渲染整页保持简单（页面小）
    });
    delegate(root, 'click', '[data-act=marker-jump]', (e, el) => {
      const mid = el.dataset.mid;
      const m = item.markers.find(x => x.id === mid);
      if (m) App.Player.jumpTo(m.time);
    });
    delegate(root, 'click', '[data-act=rename-marker]', async (e, el) => {
      const mid = el.dataset.mid;
      const m = item.markers.find(x => x.id === mid);
      if (!m) return;
      const name = prompt('节点名称（如：核心语法、生词段落、跟读片段）', m.label);
      if (name && name.trim()) {
        m.label = name.trim();
        App.Storage.save(App.state.data);
        renderDetail(id);
      }
    });
    delegate(root, 'click', '[data-act=status-learned]', async () => {
      if (item.status === S().daily.LEARNED || item.status === S().daily.DONE) return;
      const ok = await confirmModal({
        title: '标记已学习',
        message: '标记后将启动艾宾浩斯复习计划（第1/3/7/14/21天提醒复习）。确定？',
        confirmText: '已学习'
      });
      if (ok) { R().startReview(item); App.Storage.save(App.state.data); renderDetail(id); toast('复习计划已启动'); }
    });
    delegate(root, 'click', '[data-act=status-review]', () => {
      if (!item.review) return;
      const { finished } = R().markReviewed(item);
      App.Storage.save(App.state.data);
      renderDetail(id);
      toast(finished ? '🎉 全部复习完成！' : '已记录复习，进入下一轮');
    });
    delegate(root, 'click', '[data-act=status-watched]', () => {
      item.status = S().interest.WATCHED;
      App.Storage.save(App.state.data); renderDetail(id); toast('已标记为已观看');
    });
    delegate(root, 'click', '[data-act=transfer]', () => openTransferModal(item, () => renderDetail(id)));
    delegate(root, 'click', '[data-act=delete]', async () => {
      const ok = await confirmModal({
        title: '删除视频',
        message: `确定删除「${esc(item.title)}」吗？<br>笔记、节点、复习记录将一并删除，不可恢复。`,
        confirmText: '删除', danger: true
      });
      if (ok) {
        App.state.data.videos = App.state.data.videos.filter(v => v.id !== id);
        App.Storage.save(App.state.data);
        toast('已删除');
        location.hash = item.library === 'daily' ? '#/daily' : '#/interest';
      }
    });
  }

  function dailyStatusActions(item, prog) {
    const s = item.status;
    let actions = '';
    if (s === S().daily.UNLEARNED || s === S().daily.LEARNING) {
      actions += `<button class="btn btn-primary" data-act="status-learned">标记已学习</button>`;
    }
    if (s === S().daily.LEARNED && prog && !prog.completed) {
      actions += `<button class="btn btn-primary" data-act="status-review">已复习（第${prog.round + 1}轮）</button>`;
    }
    if (s === S().daily.DONE) {
      actions += `<span class="dim">已完成全部复习 ✅</span>`;
    }
    return actions || '<span class="dim">—</span>';
  }

  function interestStatusActions(item) {
    if (item.status === S().interest.UNWATCHED) {
      return `<button class="btn btn-primary" data-act="status-watched">标记已观看</button>`;
    }
    return '<span class="dim">已观看 ✅</span>';
  }

  function reviewDots(prog) {
    let s = '';
    for (let i = 0; i < prog.total; i++) {
      s += `<span class="dot ${i < prog.round ? 'dot-done' : ''}">●</span>`;
    }
    return s;
  }

  function renderMarkersBlock(item) {
    const rows = item.markers.map(m => `
      <li class="marker-row">
        <span class="marker-tag tag tag-${esc(m.cat || 'other')}">${esc(m.cat || '其他')}</span>
        <span class="marker-time">${fmtMarkerTime(m.time)}</span>
        <button class="marker-label" data-act="marker-jump" data-mid="${m.id}" title="跳转到该节点">${esc(m.label)}</button>
        <button class="btn btn-xs btn-ghost" data-act="rename-marker" data-mid="${m.id}">改名</button>
        <button class="btn btn-xs btn-ghost-danger" data-act="del-marker" data-mid="${m.id}">删</button>
      </li>`).join('');
    return `
      <div class="side-block">
        <div class="block-title">
          关键节点 <span class="dim">(${item.markers.length})</span>
          <button class="btn btn-sm btn-primary btn-inline" data-act="add-marker">＋ 添加</button>
        </div>
        ${item.markers.length
          ? `<ul class="marker-list">${rows}</ul>
             <div class="dim marker-hint">手动记录时间点 · 点击节点可跳转播放</div>`
          : `<div class="dim">点「＋ 添加」手动记录重点时间点（如跟读、无字幕片段）</div>`}
      </div>`;
  }

  /** 时间显示格式：X分X秒 */
  function fmtMarkerTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(sec / 60), s = sec % 60;
    return m > 0 ? `${m}分${s}秒` : `${s}秒`;
  }

  /** 刷新详情页状态区（播放器自动状态流转后调用） */
  function refreshDetailState() {
    if (App.state.view !== 'detail' || !App.state.detailId) return;
    const item = App.state.data.videos.find(v => v.id === App.state.detailId);
    if (item && !document.hidden) {
      // 状态已变时整体重渲染（页面小，成本可接受）
      renderDetail(App.state.detailId);
    }
  }

  /* ---------- 节点动作 ---------- */

  const MARKER_CATS = ['跟读', '无字幕', '双语字幕', '生词', '其他'];

  /** 手动添加节点弹窗：分/秒输入 + 分类选择（不依赖播放器） */
  function addMarkerAtCurrentTime() {
    const item = App.state.data.videos.find(x => x.id === App.state.detailId);
    if (!item) return;
    // 若播放器存在，预填当前时间
    const v = App.Player.getVideo();
    const curSec = v && !isNaN(v.currentTime) ? Math.floor(v.currentTime) : 0;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    App.UI.activeModal = overlay;
    document.body.classList.add('modal-open');
    overlay.innerHTML = `
      <div class="modal">
        <h3 class="modal-title">添加关键节点</h3>
        <div class="modal-body">
          <div class="form-row">
            <span class="form-label">时间</span>
            <input class="inp mk-min" type="number" min="0" max="999" value="${Math.floor(curSec / 60)}" style="width:70px"> 分
            <input class="inp mk-sec" type="number" min="0" max="59" value="${curSec % 60}" style="width:70px"> 秒
          </div>
          <div class="form-row">
            <span class="form-label">分类</span>
            <select class="sel mk-cat">
              ${MARKER_CATS.map(c => `<option value="${c}">${c}</option>`).join('')}
            </select>
          </div>
          <div class="form-row">
            <span class="form-label">备注</span>
            <input class="inp mk-label" placeholder="可选，如：核心语法（留空用分类名）" style="flex:1">
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-act="cancel">取消</button>
          <button class="btn btn-primary" data-act="ok">添加</button>
        </div>
      </div>`;
    document.getElementById('modal-root').appendChild(overlay);
    wireModalDismiss(overlay);
    const $ = sel => overlay.querySelector(sel);
    const minInp = $('.mk-min'), secInp = $('.mk-sec');
    // 秒数超过 59 自动进位到分
    secInp.addEventListener('input', () => {
      const s = parseInt(secInp.value) || 0;
      if (s >= 60) { minInp.value = (parseInt(minInp.value) || 0) + Math.floor(s / 60); secInp.value = s % 60; }
    });
    $('[data-act=cancel]').onclick = () => closeModal(overlay);
    $('[data-act=ok]').onclick = () => {
      const min = parseInt(minInp.value) || 0;
      const sec = parseInt(secInp.value) || 0;
      if (min < 0 || sec < 0 || sec > 59) { toast('时间无效', true); return; }
      const time = min * 60 + sec;
      const cat = $('.mk-cat').value;
      const label = ($('.mk-label').value || '').trim() || cat;
      item.markers.push({ id: App.Data.uid('m'), time, label, cat, createdAt: Date.now() });
      App.Storage.save(App.state.data);
      closeModal(overlay);
      renderDetail(item.id);
      toast(`已添加「${cat}：${fmtMarkerTime(time)}」`);
    };
  }

  function jumpPrevMarker() { jumpMarker(-1); }
  function jumpNextMarker() { jumpMarker(1); }

  function jumpMarker(dir) {
    const v = App.Player.getVideo();
    if (!v || App.state.view !== 'detail') return;
    const item = App.state.data.videos.find(x => x.id === App.state.detailId);
    if (!item || !item.markers.length) { toast('暂无节点', true); return; }
    const marks = [...item.markers].sort((a, b) => a.time - b.time);
    const cur = v.currentTime;
    let target = null;
    if (dir > 0) target = marks.find(m => m.time > cur + 1);
    else { const prev = marks.filter(m => m.time < cur - 1); target = prev.length ? prev[prev.length - 1] : null; }
    if (!target) { toast(dir > 0 ? '后面没有节点了' : '前面没有节点了', true); return; }
    App.Player.jumpTo(target.time);
  }

  /* ---------- 分屏拖动（宽屏左右分屏调节） ---------- */

  /**
   * 详情页左右分屏分隔条：
   *  - 宽屏（≥900px）：按住分隔条**拖动**调节左/右比例（点击不触发）
   *  - 窄屏（<900px）：隐藏分隔条，保持上下堆叠
   *  - 任意自由比例（仅保留 5% 最小宽度防完全压没）
   *  - 比例存 localStorage，下次进详情页恢复
   */
  function initSplitter(root) {
    const grid = root.querySelector('#detail-grid');
    const splitter = root.querySelector('#splitter');
    if (!grid || !splitter) return;

    const main = grid.querySelector('.detail-main');
    const side = grid.querySelector('.detail-side');

    // 恢复上次比例
    let pct = null;
    try { pct = parseFloat(localStorage.getItem('detailSplitPct')); } catch (e) { /* ignore */ }
    if (pct && pct > 3 && pct < 97) applySplit(pct);

    // 仅按住拖动才调整（移动超 5px 视为拖动；点击不触发）
    splitter.addEventListener('mousedown', e => {
      e.preventDefault();
      beginDrag(e.clientX);
    });
    splitter.addEventListener('touchstart', e => {
      e.preventDefault();
      beginDrag(e.touches[0].clientX);
    }, { passive: false });

    function beginDrag(startX) {
      const gridRect = grid.getBoundingClientRect();
      const startPct = getCurrentPct();
      let dragging = false;      // 是否真正进入拖动
      let lastPct = startPct;

      const onMove = e => {
        const x = e.touches ? e.touches[0].clientX : e.clientX;
        const dx = x - startX;
        // 移动超过 5px 才算拖动，避免点击误触
        if (!dragging && Math.abs(dx) < 5) return;
        if (!dragging) {
          dragging = true;
          document.body.classList.add('split-dragging');
          document.body.style.cursor = 'col-resize';
          document.body.style.userSelect = 'none';
        }
        // 自由比例：仅保证最小宽度（5%）
        let next = startPct + (dx / gridRect.width) * 100;
        next = Math.max(5, Math.min(95, next));
        lastPct = next;
        applySplit(next);
      };
      const onUp = () => {
        document.body.classList.remove('split-dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onUp);
        // 只有实际拖动过才保存比例
        if (dragging) {
          try { localStorage.setItem('detailSplitPct', String(lastPct)); } catch (e2) { /* ignore */ }
        }
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onUp);
    }

    function getCurrentPct() {
      const rect = grid.getBoundingClientRect();
      const mRect = main.getBoundingClientRect();
      return rect.width ? ((mRect.left - rect.left) / rect.width) * 100 : 66;
    }

    function applySplit(p) {
      main.style.flex = `0 0 calc(${p}% - 6px)`;
      side.style.flex = `1 1 auto`;
    }
  }

  /* ---------- 改分区弹窗 ---------- */

  function openRecatModal(item, after) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    App.UI.activeModal = overlay;
    document.body.classList.add('modal-open');

    const cats = App.state.data.settings.categories;
    overlay.innerHTML = `
      <div class="modal">
        <h3 class="modal-title">修改分区</h3>
        <div class="modal-body">
          <p class="dim">${esc(item.title)}</p>
          <div class="recat-grid">
            ${cats.map(c => `
              <button class="btn btn-ghost recat-btn ${item.category === c ? 'recat-active' : ''}" data-rec="${esc(c)}">${esc(c)}</button>
            `).join('')}
            <button class="btn btn-ghost recat-btn ${!item.category ? 'recat-active' : ''}" data-rec="">不分区</button>
          </div>
          <div class="form-row">
            <span class="form-label">或新建</span>
            <input class="inp recat-input" placeholder="输入新分区名…" data-act="recat-input">
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-act="cancel">取消</button>
          <button class="btn btn-primary" data-act="ok">确定</button>
        </div>
      </div>`;

    document.getElementById('modal-root').appendChild(overlay);
    wireModalDismiss(overlay);

    let selected = item.category || '';
    const btns = overlay.querySelectorAll('.recat-btn');
    const input = overlay.querySelector('.recat-input');
    const highlight = () => {
      btns.forEach(b => b.classList.toggle('recat-active', b.dataset.rec === selected));
    };
    btns.forEach(b => b.addEventListener('click', () => { selected = b.dataset.rec; input.value = ''; highlight(); }));
    input.addEventListener('input', () => { if (input.value.trim()) { selected = ''; highlight(); } });

    overlay.querySelector('[data-act=cancel]').onclick = () => { closeModal(overlay); };
    overlay.querySelector('[data-act=ok]').onclick = () => {
      const custom = input.value.trim();
      const finalCat = custom || selected;
      item.category = finalCat;
      if (finalCat && !App.state.data.settings.categories.includes(finalCat)) {
        App.state.data.settings.categories.push(finalCat);
      }
      App.Storage.save(App.state.data);
      toast(finalCat ? `已改到「${finalCat}」` : '已取消分区');
      closeModal(overlay);
      after && after();
    };
  }

  /* ---------- 转移弹窗 ---------- */

  function openTransferModal(item, after) {
    const toLib = item.library === 'daily' ? 'interest' : 'daily';
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    App.UI.activeModal = overlay;
    document.body.classList.add('modal-open');

    const isToInterest = toLib === 'interest';
    overlay.innerHTML = `
      <div class="modal">
        <h3 class="modal-title">转移视频</h3>
        <div class="modal-body">
          <p class="dim">${esc(item.title)}</p>
          <p>将视频从「${D().LIB_LABEL[item.library]}」移到「${D().LIB_LABEL[toLib]}」</p>
          ${isToInterest
            ? `<p class="text-warn">⚠ 复习计时将暂停，不再触发提醒。笔记、节点、学习记录将保留，恢复时可选择继续。</p>`
            : `<p class="dim">复习记录将保留，可选择如何计算复习周期：</p>
               <label class="radio"><input type="radio" name="keepRec" value="keep" checked> 保留原有学习记录</label>
               <label class="radio"><input type="radio" name="keepRec" value="reset"> 从头开始计算复习周期</label>`}
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-act="cancel">取消</button>
          <button class="btn btn-primary" data-act="ok">确定转移</button>
        </div>
      </div>`;

    document.getElementById('modal-root').appendChild(overlay);
    wireModalDismiss(overlay);
    overlay.querySelector('[data-act=cancel]').onclick = () => { closeModal(overlay); };
    overlay.querySelector('[data-act=ok]').onclick = () => {
      if (isToInterest) {
        R().transferToInterest(item);
        toast('已移到感兴趣视频库，复习计时已暂停');
      } else {
        const keep = overlay.querySelector('input[name=keepRec]:checked').value === 'keep';
        R().transferToDaily(item, keep);
        toast(keep ? '已移回每日学习库，复习记录已恢复' : '已移回每日学习库，复习周期从头计算');
      }
      App.Storage.save(App.state.data);
      closeModal(overlay);
      after && after();
    };
  }

  /* ---------- 导入弹窗 ---------- */

  function openImportModal(defaultLib) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    App.UI.activeModal = overlay;
    document.body.classList.add('modal-open');

    const cats = App.state.data.settings.categories;
    overlay.innerHTML = `
      <div class="modal modal-wide">
        <h3 class="modal-title">导入视频</h3>
        <div class="modal-body">
          <textarea class="inp share-input" data-act="share-text" rows="3"
            placeholder="粘贴 B站 / 抖音 视频分享链接或分享文本…&#10;例：https://www.bilibili.com/video/BV1GJ411x7h7&#10;例：8.88 复制打开抖音 https://v.douyin.com/xxxx/"></textarea>
          <div class="preview" data-act="preview"></div>
          <div class="form-row">
            <span class="form-label">存入</span>
            <label class="radio"><input type="radio" name="lib" value="daily" ${defaultLib !== 'interest' ? 'checked' : ''}> 每日学习库</label>
            <label class="radio"><input type="radio" name="lib" value="interest" ${defaultLib === 'interest' ? 'checked' : ''}> 感兴趣视频库</label>
          </div>
          <div class="form-row">
            <span class="form-label">分区</span>
            <select class="sel cat-select" data-act="cat-select">
              <option value="">不分区</option>
              ${cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
            </select>
          </div>
          <div class="form-row" data-act="title-row" hidden>
            <span class="form-label">标题</span>
            <input class="inp title-input" data-act="title-input" placeholder="视频标题">
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-act="cancel">取消</button>
          <button class="btn btn-primary" data-act="confirm" disabled>导入</button>
        </div>
      </div>`;

    document.getElementById('modal-root').appendChild(overlay);

    const $ = sel => overlay.querySelector(sel);
    const preview = $('[data-act=preview]');
    const confirmBtn = $('[data-act=confirm]');
    let detected = null;        // { platform, bvid, canonical, ... }
    let fetchedInfo = null;    // B站元信息或 null（手动模式）
    let pendingDup = null;     // 查重提示时的重复条目

    // —— 分享文本识别 ——
    let detectTimer = null;
    $('[data-act=share-text]').addEventListener('input', () => {
      clearTimeout(detectTimer);
      detectTimer = setTimeout(() => analyze(), 300);
    });

    async function analyze() {
      const text = $('[data-act=share-text]').value;
      detected = App.Parse.detect(text);
      pendingDup = null;
      confirmBtn.disabled = !detected;
      preview.innerHTML = '';
      // 从分享文本提取标题（无需网络，B站【】/ 抖音文案都支持）
      const extractedTitle = App.Parse.extractTitle(text);

      if (!detected) {
        if (text.trim()) preview.innerHTML = `<div class="preview-err">未识别到 B站 / 抖音 链接</div>`;
        return;
      }
      // 标题输入框始终显示，默认填提取的标题（可编辑）
      $('[data-act=title-row]').hidden = false;
      $('[data-act=title-input]').value = extractedTitle || '';

      if (detected.platform === 'bilibili') {
        preview.innerHTML = `<div class="preview-loading">正在解析 B站 视频…</div>`;
        try {
          const info = await App.Bili.fetchVideoInfo(detected);
          fetchedInfo = info;
          preview.innerHTML = `
            <div class="preview-card">
              ${info.cover ? `<img class="preview-cover" src="${esc(info.cover)}" onerror="this.style.display='none'">` : ''}
              <div>
                <div class="preview-title">${esc(info.title)}</div>
                <div class="dim">哔哩哔哩 · ${D().formatTime(info.duration)}</div>
              </div>
            </div>`;
          // 网络解析成功 → 标题用官方标题
          $('[data-act=title-input]').value = info.title || extractedTitle || '';
        } catch (e) {
          fetchedInfo = null;   // 手动模式
          preview.innerHTML = `
            <div class="preview-warn">⚠ 元信息解析失败（${esc((e && e.msg) || '网络错误')}），请确认或编辑标题。</div>`;
          // 标题已由提取标题填充（无需网络）
        }
      } else {
        fetchedInfo = null;
        preview.innerHTML = `
          <div class="preview-card">
            <div class="preview-cover preview-cover-ph">抖音</div>
            <div>
              <div class="preview-title">${esc(extractedTitle || '抖音视频')}</div>
              <div class="dim">将在原平台播放 · 站内不做节点标记</div>
            </div>
          </div>`;
      }
    }

    $('[data-act=cancel]').onclick = () => closeModal(overlay);
    wireModalDismiss(overlay);

    confirmBtn.addEventListener('click', () => {
      if (!detected) return;
      const lib = overlay.querySelector('input[name=lib]:checked').value;
      const category = $('[data-act=cat-select]').value;
      const title = ($('[data-act=title-input]').value || '').trim() || App.Parse.extractTitle($('[data-act=share-text]').value) || '未命名视频';

      // 分区去重
      if (category && !App.state.data.settings.categories.includes(category)) {
        App.state.data.settings.categories.push(category);
      }

      let item;
      if (detected.platform === 'bilibili') {
        // 查重
        const dup = App.state.data.videos.find(v => v.platform === 'bilibili' && v.bvid === detected.bvid);
        if (dup && !pendingDup) {
          pendingDup = dup;
          confirmModal({
            title: '已导入过',
            message: `「${esc(dup.title)}」已在 ${D().LIB_LABEL[dup.library]}库 中。仍要重复导入吗？`,
            confirmText: '仍要导入'
          }).then(ok => { if (ok) doImport(); pendingDup = null; });
          return;
        }
        const info = fetchedInfo || {};
        item = D().createItem({
          platform: 'bilibili',
          sourceUrl: detected.canonical,
          shareText: $('[data-act=share-text]').value,
          bvid: detected.bvid,
          cid: info.cid || null,
          title: title || info.title || 'B站视频',
          cover: info.cover || null,
          duration: info.duration || null,
          category,
          library: lib
        });
      } else {
        // 抖音查重
        const dup = App.state.data.videos.find(v => v.platform === 'douyin' && v.sourceUrl === detected.canonical);
        if (dup && !pendingDup) {
          pendingDup = dup;
          confirmModal({
            title: '已导入过',
            message: `「${esc(dup.title)}」已在 ${D().LIB_LABEL[dup.library]}库 中。仍要重复导入吗？`,
            confirmText: '仍要导入'
          }).then(ok => { if (ok) doImport(); pendingDup = null; });
          return;
        }
        item = D().createItem({
          platform: 'douyin',
          sourceUrl: detected.canonical,
          shareText: $('[data-act=share-text]').value,
          title: title || '抖音视频',
          category,
          library: lib
        });
      }
      doImport(item);

      function doImport() {
        App.state.data.videos.push(item);
        App.Storage.save(App.state.data);
        closeModal(overlay);
        toast(`已导入「${item.title}」到${D().LIB_LABEL[lib]}`);
        location.hash = lib === 'daily' ? '#/daily' : '#/interest';
      }
    });
  }

  /* ---------- 云代理设置弹窗（Cloudflare Worker） ---------- */

  function openProxyModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    App.UI.activeModal = overlay;
    document.body.classList.add('modal-open');

    const current = App.Bili.getCloudProxy();
    overlay.innerHTML = `
      <div class="modal">
        <h3 class="modal-title">云代理设置</h3>
        <div class="modal-body">
          <p class="dim">配置 Cloudflare Worker 后，在线版/手机端的 B站视频可<strong>站内直接播放</strong>（15秒快进、节点跳转全支持）。不配置时使用官方嵌入播放（能看但控制受限）。</p>
          <div class="form-row">
            <span class="form-label">地址</span>
            <input class="inp proxy-input" type="url" placeholder="https://your-name.workers.dev" value="${esc(current)}">
          </div>
          <p class="dim">部署教程见仓库 README（cloudflare-worker.js 已随仓库提供）。</p>
          <div class="proxy-status" data-act="proxy-status"></div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-act="cancel">关闭</button>
          <button class="btn btn-ghost" data-act="test" title="测试代理可用性">测试连接</button>
          <button class="btn btn-ghost" data-act="clear" title="清除配置，恢复官方嵌入播放">清除</button>
          <button class="btn btn-primary" data-act="save">保存</button>
        </div>
      </div>`;

    document.getElementById('modal-root').appendChild(overlay);
    const $ = sel => overlay.querySelector(sel);
    const status = $('[data-act=proxy-status]');
    const setStatus = (msg, ok) => {
      status.innerHTML = `<span class="${ok === false ? 'text-danger' : ok === true ? 'text-ok' : 'dim'}">${esc(msg)}</span>`;
    };

    $('[data-act=cancel]').onclick = () => App.UI.closeModal(overlay);
    wireModalDismiss(overlay);

    $('[data-act=save]').onclick = () => {
      const v = $('.proxy-input').value.trim();
      if (v && !/^https?:\/\//.test(v)) { setStatus('地址需以 http(s):// 开头', false); return; }
      App.Bili.setCloudProxy(v);
      setStatus(v ? '已保存' : '已清除，将使用官方嵌入播放', true);
    };

    $('[data-act=clear]').onclick = () => {
      $('.proxy-input').value = '';
      App.Bili.setCloudProxy('');
      setStatus('已清除配置', true);
    };

    $('[data-act=test]').onclick = async () => {
      const v = $('.proxy-input').value.trim();
      if (!v) { setStatus('请先填写地址', false); return; }
      if (!/^https?:\/\//.test(v)) { setStatus('地址需以 http(s):// 开头', false); return; }
      const btn = $('[data-act=test]');
      btn.disabled = true;
      setStatus('正在测试…');
      try {
        const r = await fetch(`${v.replace(/\/+$/, '')}/api/bili/view?bvid=BV1GJ411x7h7`);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        if (j.code === 0 && j.data && j.data.title) {
          setStatus(`✓ 连接成功：「${j.data.title}」`, true);
        } else {
          setStatus('代理返回异常，请确认已部署 cloudflare-worker.js', false);
        }
      } catch (e) {
        setStatus('测试失败：' + e.message + '（检查地址是否正确、Worker 是否部署）', false);
      }
      btn.disabled = false;
    };
  }

  /* ---------- 导出/导入备份 ---------- */

  function bindFooter() {
    document.getElementById('link-export').addEventListener('click', e => {
      e.preventDefault();
      App.Storage.exportBackup(App.state.data);
      toast('备份已导出');
    });
    document.getElementById('link-import').addEventListener('click', e => {
      e.preventDefault();
      document.getElementById('file-import').click();
    });
    document.getElementById('file-import').addEventListener('change', e => {
      const f = e.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        const r = App.Storage.importBackup(reader.result);
        toast(r.msg, !r.ok);
        if (r.ok) { App.state.data = App.Storage.load(); App.state.filter = { daily: {}, interest: {} }; router(); }
      };
      reader.readAsText(f, 'utf-8');
      e.target.value = '';
    });
  }

  /* ---------- 对外接口 ---------- */

  App.UI = {
    activeModal: null,
    renderList, renderDetail, refreshDetailState,
    openImportModal, openTransferModal, openRecatModal, openProxyModal, confirmModal, closeModal, toast,
    addMarkerAtCurrentTime, jumpPrevMarker, jumpNextMarker,
    bindFooter, delegate, esc, wireModalDismiss
  };
})();
