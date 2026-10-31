'use strict';

/**
 * AI Daily Briefing —— 数据提供层
 *
 * 五个 DataProvider 各自只负责一件事：从既有模块读取「某个报告周期」的原始数据，
 * 归一化成统一结构，并计算基础统计。它们不做任何自然语言生成，也不访问 AI。
 *
 * 所有 Provider 都通过 ctx 注入的 db 帮助函数访问 SQLite，
 * 保证不绕过应用层直接改库（只读）。
 */

const PRIORITY_RANK = { '高': 0, '中': 1, '低': 2 };

function hhmmToMin(s) {
  if (typeof s !== 'string' || !/^\d{2}:\d{2}$/.test(s)) return null;
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

function daysBetween(a, b) {
  const [ay, am, ad] = String(a).split('-').map(Number);
  const [by, bm, bd] = String(b).split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

// 常见生活主题词典（用于日记关键词统计，非 NLP 分词）
const THEME_WORDS = [
  '学习', '工作', '项目', '编程', '阅读', '写作', '考试', '成长', '目标', '计划',
  '朋友', '家人', '同事', '社交', '旅行', '运动', '健身', '跑步', '健康', '睡眠',
  '焦虑', '压力', '开心', '低落', '疲惫', '音乐', '电影', '游戏', '美食', '咖啡',
  '理财', '消费', '存钱', '时间管理', '反思', '感恩', '习惯',
];

function extractThemes(text) {
  if (!text) return [];
  const out = [];
  for (const w of THEME_WORDS) {
    let count = 0;
    let idx = 0;
    while ((idx = text.indexOf(w, idx)) !== -1) { count++; idx += w.length; }
    if (count > 0) out.push({ word: w, count });
  }
  out.sort((a, b) => b.count - a.count);
  return out.slice(0, 6);
}

function createProviders(ctx) {
  const { db, all, get, addDaysStr, MOOD_SCORE } = ctx;

  /* ---------------- Todo ---------------- */
  function todos({ today, from, to }) {
    const rows = all(db, 'SELECT * FROM todos');
    const pending = rows.filter((t) => !t.done);
    const overdue = pending.filter((t) => t.due_date && t.due_date < today);
    const dueToday = pending.filter((t) => t.due_date === today);
    const highPending = pending.filter((t) => t.priority === '高');
    const noDuePending = pending.filter((t) => !t.due_date);
    const inPeriod = rows.filter((t) => t.due_date && t.due_date >= from && t.due_date <= to);
    const inPeriodDone = inPeriod.filter((t) => t.done);

    const ranked = [...pending].sort((a, b) => {
      const ao = a.due_date && a.due_date < today ? 0 : 1;
      const bo = b.due_date && b.due_date < today ? 0 : 1;
      if (ao !== bo) return ao - bo;
      const ap = PRIORITY_RANK[a.priority] ?? 1;
      const bp = PRIORITY_RANK[b.priority] ?? 1;
      if (ap !== bp) return ap - bp;
      const ad = a.due_date || '9999-99-99';
      const bd = b.due_date || '9999-99-99';
      return ad < bd ? -1 : ad > bd ? 1 : 0;
    });

    return {
      total: rows.length,
      done: rows.length - pending.length,
      pending: pending.length,
      overdue: overdue.length,
      dueToday: dueToday.length,
      highPending: highPending.length,
      noDuePending: noDuePending.length,
      inPeriod: inPeriod.length,
      inPeriodDone: inPeriodDone.length,
      completionRate: inPeriod.length ? Math.round((inPeriodDone.length / inPeriod.length) * 100) : null,
      top: ranked.slice(0, 5).map((t) => ({
        id: t.id, title: t.title, priority: t.priority, due_date: t.due_date || null,
        overdue: !!(t.due_date && t.due_date < today),
      })),
      overdueList: overdue.slice(0, 5).map((t) => ({ title: t.title, due_date: t.due_date })),
      highList: highPending.slice(0, 5).map((t) => ({ title: t.title, due_date: t.due_date || null })),
    };
  }

  /* ---------------- Calendar ---------------- */
  function calendar({ today, from, to }) {
    const rows = all(db, 'SELECT * FROM schedules ORDER BY start_time ASC');
    const events = rows.map((r) => {
      const start = r.start_time || '';
      return {
        id: r.id,
        title: r.title,
        location: r.location || '',
        start: r.start_time,
        end: r.end_time || '',
        date: start.slice(0, 10),
        startHM: start.slice(11, 16),
        endHM: (r.end_time || '').slice(11, 16),
      };
    });

    const inPeriod = events.filter((e) => e.date >= from && e.date <= to);
    const todayEvents = events.filter((e) => e.date === today);
    const upcoming = events.filter((e) => e.date > today).slice(0, 5);

    // 同一天时间重叠冲突
    const conflicts = [];
    const byDate = {};
    for (const e of events) (byDate[e.date] = byDate[e.date] || []).push(e);
    for (const d of Object.keys(byDate)) {
      const list = byDate[d].filter((e) => e.startHM).sort((a, b) => a.startHM.localeCompare(b.startHM));
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i], b = list[j];
          const aEnd = a.endHM || a.startHM;
          if (aEnd > b.startHM) conflicts.push({ date: d, a: a.title, b: b.title, at: b.startHM });
        }
      }
    }

    // 今日空闲时段（08:00 - 22:00）
    const DAY_START = '08:00', DAY_END = '22:00';
    const busy = todayEvents
      .filter((e) => e.startHM)
      .map((e) => ({ s: e.startHM, e: e.endHM || e.startHM }))
      .sort((a, b) => a.s.localeCompare(b.s));
    const freeBlocks = [];
    let cur = DAY_START;
    for (const b of busy) {
      if (b.s > cur) {
        const m = hhmmToMin(b.s) - hhmmToMin(cur);
        if (m >= 30) freeBlocks.push({ from: cur, to: b.s, min: m });
      }
      if (b.e > cur) cur = b.e;
    }
    if (cur < DAY_END) {
      const m = hhmmToMin(DAY_END) - hhmmToMin(cur);
      if (m >= 30) freeBlocks.push({ from: cur, to: DAY_END, min: m });
    }

    // 期间最忙的一天
    const perDay = {};
    for (const e of inPeriod) perDay[e.date] = (perDay[e.date] || 0) + 1;
    let busiest = null;
    for (const d of Object.keys(perDay)) {
      if (!busiest || perDay[d] > busiest.count) busiest = { date: d, count: perDay[d] };
    }

    return {
      total: events.length,
      inPeriod: inPeriod.length,
      todayCount: todayEvents.length,
      upcomingCount: events.filter((e) => e.date > today).length,
      todayEvents: todayEvents.map((e) => ({
        title: e.title, startHM: e.startHM, endHM: e.endHM, location: e.location,
      })),
      upcoming: upcoming.map((e) => ({ title: e.title, date: e.date, startHM: e.startHM })),
      conflicts,
      freeBlocks,
      busiest,
    };
  }

  /* ---------------- Finance ---------------- */
  function finance({ today, from, to, currency }) {
    const rows = all(db, 'SELECT * FROM expenses');
    const inRange = (r, a, b) => r.date >= a && r.date <= b;
    const sum = (list, type) => list
      .filter((r) => r.type === type)
      .reduce((s, r) => s + Number(r.amount || 0), 0);

    const monthFrom = today.slice(0, 8) + '01';
    const monthRows = rows.filter((r) => inRange(r, monthFrom, today));
    const periodRows = rows.filter((r) => inRange(r, from, to));

    const monthExpense = sum(monthRows, '支出');
    const monthIncome = sum(monthRows, '收入');
    const todayExpense = sum(rows.filter((r) => r.date === today), '支出');
    const periodExpense = sum(periodRows, '支出');
    const periodIncome = sum(periodRows, '收入');

    const catMap = {};
    for (const r of monthRows) {
      if (r.type === '支出') catMap[r.category] = (catMap[r.category] || 0) + Number(r.amount || 0);
    }
    const byCategory = Object.keys(catMap)
      .map((c) => ({ category: c, amount: Math.round(catMap[c] * 100) / 100 }))
      .sort((a, b) => b.amount - a.amount);

    // 与上一个等长周期对比
    const len = daysBetween(from, to) + 1;
    const prevTo = addDaysStr(from, -1);
    const prevFrom = addDaysStr(prevTo, -(len - 1));
    const prevRows = rows.filter((r) => inRange(r, prevFrom, prevTo));
    const prevExpense = sum(prevRows, '支出');
    const trendPct = prevExpense > 0
      ? Math.round(((periodExpense - prevExpense) / prevExpense) * 100)
      : null;

    return {
      currency: currency || '¥',
      todayExpense: Math.round(todayExpense * 100) / 100,
      monthExpense: Math.round(monthExpense * 100) / 100,
      monthIncome: Math.round(monthIncome * 100) / 100,
      monthBalance: Math.round((monthIncome - monthExpense) * 100) / 100,
      periodExpense: Math.round(periodExpense * 100) / 100,
      periodIncome: Math.round(periodIncome * 100) / 100,
      periodBalance: Math.round((periodIncome - periodExpense) * 100) / 100,
      recordCount: periodRows.length,
      byCategory,
      topCategory: byCategory[0] || null,
      trendPct,
      prevExpense: Math.round(prevExpense * 100) / 100,
    };
  }

  /* ---------------- Lifestyle ---------------- */
  function lifestyle({ today, from, to }) {
    const dates = [];
    let cur = from, guard = 0;
    while (cur <= to && guard++ < 400) { dates.push(cur); cur = addDaysStr(cur, 1); }

    const sleeps = all(db, 'SELECT date, duration_min, quality FROM sleep_records WHERE date >= ? AND date <= ?', [from, to]);
    const exercises = all(db, 'SELECT date, duration_min, type FROM exercise_records WHERE date >= ? AND date <= ?', [from, to]);
    const waters = all(db, 'SELECT date, amount_ml FROM water_records WHERE date >= ? AND date <= ?', [from, to]);
    const moods = all(db, 'SELECT date, mood FROM mood_records WHERE date >= ? AND date <= ?', [from, to]);
    const energies = all(db, 'SELECT date, level FROM energy_records WHERE date >= ? AND date <= ?', [from, to]);

    const sleepByDate = {};
    for (const r of sleeps) sleepByDate[r.date] = Number(r.duration_min || 0);
    const exByDate = {};
    for (const r of exercises) exByDate[r.date] = (exByDate[r.date] || 0) + Number(r.duration_min || 0);
    const waterByDate = {};
    for (const r of waters) waterByDate[r.date] = (waterByDate[r.date] || 0) + Number(r.amount_ml || 0);
    const energyByDate = {};
    for (const r of energies) energyByDate[r.date] = Number(r.level || 0);
    const moodByDate = {};
    const moodCounts = {};
    let moodScoreSum = 0;
    for (const r of moods) {
      moodCounts[r.mood] = (moodCounts[r.mood] || 0) + 1;
      moodScoreSum += MOOD_SCORE[r.mood] || 3;
      (moodByDate[r.date] = moodByDate[r.date] || []).push(MOOD_SCORE[r.mood] || 3);
    }

    const sleepCount = sleeps.length;
    const sleepAvg = sleepCount
      ? Math.round(sleeps.reduce((s, r) => s + Number(r.duration_min || 0), 0) / sleepCount)
      : 0;
    const exTotal = exercises.reduce((s, r) => s + Number(r.duration_min || 0), 0);
    const activeDays = Object.keys(exByDate).length;
    const waterTotal = waters.reduce((s, r) => s + Number(r.amount_ml || 0), 0);
    const daysWithWater = Object.keys(waterByDate).length;
    const goal = ctx.clampInt(ctx.getSetting('water_goal', 2000), 100, 10000, 2000);
    const goalDays = Object.keys(waterByDate).filter((d) => waterByDate[d] >= goal).length;
    const energyCount = energies.length;
    const energyAvg = energyCount
      ? Math.round((energies.reduce((s, r) => s + Number(r.level || 0), 0) / energyCount) * 10) / 10
      : 0;

    // 今日快照
    const todaySleep = get(db, 'SELECT duration_min, quality FROM sleep_records WHERE date = ?', [today]);
    const todayWater = get(db, 'SELECT COALESCE(SUM(amount_ml),0) AS s FROM water_records WHERE date = ?', [today]).s;
    const todayEx = get(db, 'SELECT COALESCE(SUM(duration_min),0) AS s FROM exercise_records WHERE date = ?', [today]).s;
    const todayEnergy = get(db, 'SELECT level FROM energy_records WHERE date = ?', [today]);
    const todayMood = get(db, 'SELECT mood FROM mood_records WHERE date = ? ORDER BY id DESC LIMIT 1', [today]);

    const series = {
      sleep: dates.map((d) => ({ date: d, value: sleepByDate[d] || 0 })),
      exercise: dates.map((d) => ({ date: d, value: exByDate[d] || 0 })),
      water: dates.map((d) => ({ date: d, value: waterByDate[d] || 0 })),
      energy: dates.map((d) => ({ date: d, value: energyByDate[d] || 0 })),
      mood: dates.map((d) => {
        const arr = moodByDate[d] || [];
        return { date: d, value: arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : 0 };
      }),
    };

    return {
      waterGoal: goal,
      sleep: { count: sleepCount, avgMin: sleepAvg, todayMin: todaySleep ? Number(todaySleep.duration_min || 0) : null, todayQuality: todaySleep ? todaySleep.quality : null },
      exercise: { count: exercises.length, totalMin: exTotal, activeDays, todayMin: Number(todayEx || 0) },
      water: { totalMl: waterTotal, todayMl: Number(todayWater || 0), daysWithWater, goalDays, goalRate: daysWithWater ? Math.round((goalDays / daysWithWater) * 100) : 0 },
      mood: { total: moods.length, counts: moodCounts, avgScore: moods.length ? Math.round((moodScoreSum / moods.length) * 10) / 10 : 0, today: todayMood ? todayMood.mood : null },
      energy: { count: energyCount, avg: energyAvg, today: todayEnergy ? Number(todayEnergy.level) : null },
      series,
      missing: {
        sleep: sleepCount === 0,
        exercise: exercises.length === 0,
        water: waters.length === 0,
        mood: moods.length === 0,
        energy: energyCount === 0,
      },
    };
  }

  /* ---------------- Diary ---------------- */
  function diary({ from, to, enabled }) {
    if (!enabled) return { enabled: false };
    const rows = all(db, 'SELECT * FROM journals WHERE date >= ? AND date <= ? ORDER BY date DESC, id DESC', [from, to]);
    const text = rows.map((r) => (r.title || '') + ' ' + (r.content || '')).join(' ');
    const moods = {};
    for (const r of rows) moods[r.mood] = (moods[r.mood] || 0) + 1;
    return {
      enabled: true,
      count: rows.length,
      moods,
      themes: extractThemes(text),
      // 只回传标题，不回传正文（隐私：正文仅在生成时短暂使用，不入库到报告）
      recentTitles: rows.slice(0, 3).map((r) => r.title),
    };
  }

  return { todos, calendar, finance, lifestyle, diary };
}

module.exports = { createProviders, extractThemes, daysBetween, hhmmToMin };
