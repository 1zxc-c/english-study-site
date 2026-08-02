/**
 * review.js —— 艾宾浩斯复习引擎 + 双库转移逻辑
 * 纯逻辑层，不碰 DOM。
 *
 * 时间锚点策略：以「标记已学习」时刻为锚点，按固定日历间隔生成复习日期，
 * 第1/3/7/14/21天各一次；固定锚点不随补签滚动（保持字面语义）。
 */
(function () {
  'use strict';
  window.App = window.App || {};

  const INTERVALS_DAYS = [1, 3, 7, 14, 21];
  const S = () => App.Data.STATUS;
  const D = App.Data;

  /* ---------- 复习动作 ---------- */

  /** 标记「已学习」：启动复习计时（未学习/学习中 → 已学习） */
  function startReview(item) {
    if (item.library !== 'daily') return;
    const now = Date.now();
    item.status = S().daily.LEARNED;
    item.review = {
      startedAt: now,
      round: 0,                                  // 已完成轮次
      nextReviewAt: D.addDays(now, INTERVALS_DAYS[0]),  // 第1天
      markedAt: null,
      completedAt: null
    };
  }

  /**
   * 标记「已复习」：推进轮次，更新下一次复习日期
   * 返回 { finished: bool }（第5轮完成 → true）
   */
  function markReviewed(item) {
    if (!item.review) return { finished: false };
    const r = item.review;
    r.round += 1;
    r.markedAt = Date.now();
    if (r.round >= INTERVALS_DAYS.length) {
      r.completedAt = Date.now();
      r.nextReviewAt = null;
      item.status = S().daily.DONE;              // 复习完成
      return { finished: true };
    }
    r.nextReviewAt = D.addDays(r.startedAt, INTERVALS_DAYS[r.round]);
    item.status = S().daily.LEARNED;
    return { finished: false };
  }

  /* ---------- 查询 ---------- */

  /** 今日待复习（含逾期）：daily 库 + 有复习计划 + 未完成 + 到期日 <= 今天结束 */
  function isDueToday(item) {
    if (item.library !== 'daily' || !item.review || item.review.completedAt) return false;
    return item.review.nextReviewAt !== null && item.review.nextReviewAt <= D.endOfToday();
  }

  function isOverdue(item) {
    return isDueToday(item) && item.review.nextReviewAt < D.startOfToday();
  }

  /** 逾期天数（今天到期=0，昨天到期=1…） */
  function overdueDays(item) {
    if (!item.review) return 0;
    return Math.floor((D.startOfToday() - item.review.nextReviewAt) / 86400000);
  }

  /** 今日待复习清单（逾期的排前面） */
  function getDueList(videos) {
    return videos.filter(isDueToday)
      .sort((a, b) => (a.review.nextReviewAt - b.review.nextReviewAt) ||
                       (overdueDays(b) - overdueDays(a)));
  }

  /** 复习进度信息：{ round, total, nextDate, completed } 或 null */
  function getProgress(item) {
    if (!item.review) return null;
    return {
      round: item.review.round,
      total: INTERVALS_DAYS.length,
      nextDate: item.review.nextReviewAt,
      completed: !!item.review.completedAt
    };
  }

  /* ---------- 双库转移 ---------- */

  /**
   * 每日 → 感兴趣：暂停复习计时
   * 所有记录（笔记/节点/进度/复习对象）原样保留，只改库与状态；
   * 引擎只在 daily 库时读取 review，天然实现"暂停"。
   */
  function transferToInterest(item) {
    item.library = 'interest';
    item.status = (item.status === S().daily.UNLEARNED)
      ? S().interest.UNWATCHED : S().interest.WATCHED;
    // review 保留但不生效
  }

  /**
   * 感兴趣 → 每日：
   * keepRecord=true  → 保留记录：有暂停中的复习计划则恢复；无历史则按观看状态初始化
   * keepRecord=false → 从头开始计算：清空复习计划重建
   */
  function transferToDaily(item, keepRecord) {
    const wasWatched = item.status === S().interest.WATCHED;
    item.library = 'daily';

    if (keepRecord) {
      if (item.review) {
        // 有暂停中的复习计划 → 恢复
        item.status = item.review.completedAt ? S().daily.DONE : S().daily.LEARNED;
        // nextReviewAt 原样保留；若已逾期，立即出现在「今日待复习」
      } else {
        // 从未开始过复习 → 按观看状态初始化
        item.status = wasWatched ? S().daily.LEARNED : S().daily.UNLEARNED;
        if (item.status === S().daily.LEARNED) startReview(item);
      }
    } else {
      item.review = null;                       // 从头开始
      item.status = wasWatched ? S().daily.LEARNED : S().daily.UNLEARNED;
      if (item.status === S().daily.LEARNED) startReview(item);
    }
    // notes / markers / progress 两种模式都保留
  }

  /* ---------- 状态联动（由播放器触发） ---------- */

  /** 播放时：每日库 未学习 → 学习中 */
  function ensureLearning(item) {
    if (item.library === 'daily' && item.status === S().daily.UNLEARNED) {
      item.status = S().daily.LEARNING;
    }
  }

  /** 播完时：感兴趣库 未观看 → 已观看 */
  function markAutoWatched(item) {
    if (item.library === 'interest' && item.status === S().interest.UNWATCHED) {
      item.status = S().interest.WATCHED;
    }
  }

  App.Review = {
    INTERVALS_DAYS,
    startReview, markReviewed,
    isDueToday, isOverdue, overdueDays, getDueList, getProgress,
    transferToInterest, transferToDaily,
    ensureLearning, markAutoWatched
  };
})();
