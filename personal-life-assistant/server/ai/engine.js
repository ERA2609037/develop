'use strict';

/**
 * AI Briefing Engine
 *
 * 两部分能力：
 *   A. 本地分析引擎（无 AI Key 时使用）：完全基于真实数据计算统计与文案，
 *      生成日报/周报/月报、AI 建议、以及追问回答。不做医疗诊断、不做财务保证、
 *      数据缺失时如实说明，绝不编造记录。
 *   B. LLM 叙事层（配置了 OpenAI 兼容服务时使用）：把本地算好的结构化上下文交给模型，
 *      让模型只负责「自然语言表达」，数值仍以本地统计为准，避免模型编造数字。
 */

const MOOD_LABELS = {
  very_happy: '非常开心', happy: '开心', neutral: '平静',
  sad: '难过', stressed: '压力大', tired: '疲惫',
};
const QUALITY_LABELS = { Excellent: '优秀', Good: '良好', Average: '一般', Poor: '较差' };
const EX_LABELS = {
  Walking: '步行', Running: '跑步', Cycling: '骑行', Gym: '健身',
  Swimming: '游泳', Yoga: '瑜伽', Sports: '球类运动', Other: '其他',
};

/* ---------------- 通用格式化 ---------------- */
function pad2(n) { return String(n).padStart(2, '0'); }

function fmtDuration(min) {
  const n = Math.round(Number(min) || 0);
  if (n <= 0) return '0 分钟';
  const h = Math.floor(n / 60), m = n % 60;
  if (h && m) return h + ' 小时 ' + m + ' 分钟';
  if (h) return h + ' 小时';
  return m + ' 分钟';
}
function fmtDurationShort(min) {
  const n = Math.round(Number(min) || 0);
  if (n <= 0) return '—';
  const h = Math.floor(n / 60), m = n % 60;
  return h ? (m ? h + 'h' + m + 'm' : h + 'h') : m + 'm';
}
function fmtMoney(n, cur) {
  const v = Number(n) || 0;
  return (cur || '¥') + v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function shortDate(d) { return String(d || '').slice(5); }
function weekdayCN(d) {
  const [y, m, dd] = String(d).split('-').map(Number);
  const w = new Date(y, m - 1, dd).getDay();
  return '日一二三四五六'[w] ? '周' + '日一二三四五六'[w] : '';
}
function greetingFor(dateObj) {
  const h = (dateObj || new Date()).getHours();
  if (h >= 5 && h < 11) return { text: '早上好', en: 'GOOD MORNING' };
  if (h >= 11 && h < 13) return { text: '中午好', en: 'GOOD NOON' };
  if (h >= 13 && h < 18) return { text: '下午好', en: 'GOOD AFTERNOON' };
  if (h >= 18 && h < 23) return { text: '晚上好', en: 'GOOD EVENING' };
  return { text: '夜深了', en: 'GOOD NIGHT' };
}

/* ---------------- 报告周期 ---------------- */
function periodLabel(type, from, to) {
  if (type === 'daily') return from === to ? from + ' ' + weekdayCN(from) : from + ' ~ ' + to;
  return from + ' ~ ' + to;
}
function bucketWeekly(series, from) {
  // 把逐日序列聚合成「第 N 周」桶，用于月报图表
  const buckets = [];
  let cur = null;
  for (const p of series) {
    const idx = Math.floor((new Date(p.date) - new Date(from)) / 86400000 / 7);
    const key = Math.max(0, idx);
    if (!cur || cur.idx !== key) {
      cur = { idx: key, label: '第' + (key + 1) + '周', sum: 0, n: 0 };
      buckets.push(cur);
    }
    cur.sum += Number(p.value) || 0;
    cur.n += 1;
  }
  return buckets.map((b) => ({ label: b.label, value: Math.round(b.sum / Math.max(1, b.n) * 10) / 10 }));
}

/* ---------------- 概览 KPI ---------------- */
function buildOverview(ctx) {
  const d = ctx.data;
  const cur = ctx.currency;
  if (ctx.type === 'daily') {
    const l = d.lifestyle || {};
    const t = d.todos || {};
    const cal = d.calendar || {};
    const fin = d.finance || {};
    return [
      { label: '待办', value: String(t.pending ?? 0), hint: t.overdue ? t.overdue + ' 项逾期' : '全部在计划内', tone: t.overdue ? 'warn' : 'normal' },
      { label: '今日日程', value: String(cal.todayCount ?? 0), hint: cal.conflicts && cal.conflicts.length ? cal.conflicts.length + ' 处时间冲突' : '无冲突', tone: cal.conflicts && cal.conflicts.length ? 'warn' : 'normal' },
      { label: '今日支出', value: fmtMoney(fin.todayExpense, cur), hint: '本月 ' + fmtMoney(fin.monthExpense, cur), tone: 'normal' },
      { label: '昨夜睡眠', value: l.sleep ? fmtDurationShort(l.sleep.todayMin) : '—', hint: l.sleep && l.sleep.todayQuality ? QUALITY_LABELS[l.sleep.todayQuality] || '' : '暂无记录', tone: 'normal' },
      { label: '今日饮水', value: (l.water ? l.water.todayMl : 0) + ' ml', hint: l.water ? '目标 ' + l.waterGoal + ' ml' : '', tone: l.water && l.water.todayMl >= l.waterGoal ? 'good' : 'normal' },
    ];
  }
  const t = d.todos || {};
  const fin = d.finance || {};
  const l = d.lifestyle || {};
  return [
    { label: '任务完成率', value: t.completionRate == null ? '—' : t.completionRate + '%', hint: (t.inPeriodDone || 0) + '/' + (t.inPeriod || 0) + ' 项', tone: (t.completionRate || 0) >= 60 ? 'good' : 'normal' },
    { label: '周期支出', value: fmtMoney(fin.periodExpense, cur), hint: fin.trendPct == null ? '无对比数据' : (fin.trendPct >= 0 ? '较上期 +' : '较上期 ') + fin.trendPct + '%', tone: fin.trendPct > 20 ? 'warn' : 'normal' },
    { label: '运动总时长', value: fmtDurationShort(l.exercise ? l.exercise.totalMin : 0), hint: (l.exercise ? l.exercise.activeDays : 0) + ' 个活跃日', tone: 'normal' },
    { label: '平均睡眠', value: l.sleep && l.sleep.avgMin ? fmtDurationShort(l.sleep.avgMin) : '—', hint: (l.sleep ? l.sleep.count : 0) + ' 天有记录', tone: 'normal' },
    { label: '平均精力', value: l.energy && l.energy.avg ? l.energy.avg + ' /5' : '—', hint: (l.energy ? l.energy.count : 0) + ' 天有记录', tone: 'normal' },
  ];
}

/* ---------------- 每日分区 ---------------- */
function dailySections(ctx) {
  const d = ctx.data;
  const cur = ctx.currency;
  const secs = [];

  /* 任务 */
  if (d.todos) {
    const t = d.todos;
    const bullets = [];
    if (t.overdue) {
      bullets.push({ kind: 'warn', text: '有 ' + t.overdue + ' 项任务已逾期，建议优先处理：' + t.overdueList.map((x) => '「' + x.title + '」').join('、') });
    }
    if (t.highPending) {
      bullets.push({ kind: 'tip', text: '高优先级待办 ' + t.highPending + ' 项' + (t.highList.length ? '：' + t.highList.map((x) => '「' + x.title + '」').join('、') : '') });
    }
    if (t.noDuePending) bullets.push({ kind: 'info', text: '有 ' + t.noDuePending + ' 项待办没有截止日期，可考虑设定时间以便排期。' });
    if (t.top.length) bullets.push({ kind: 'tip', text: '建议先完成「' + t.top[0].title + '」' + (t.top[0].overdue ? '（已逾期）' : t.top[0].due_date ? '（截止 ' + t.top[0].due_date + '）' : '') + '。' });
    if (!t.pending) bullets.push({ kind: 'good', text: '当前没有未完成的待办，节奏不错。' });

    secs.push({
      key: 'tasks', title: '任务分析', icon: '✅',
      summary: t.total
        ? '你有 ' + t.total + ' 项待办，其中 ' + t.pending + ' 项未完成' + (t.overdue ? '、' + t.overdue + ' 项已逾期' : '') + (t.highPending ? '，含 ' + t.highPending + ' 项高优先级' : '') + '。'
        : '还没有创建任何待办。',
      stats: [
        { label: '总数', value: String(t.total) },
        { label: '已完成', value: String(t.done) },
        { label: '未完成', value: String(t.pending) },
        { label: '逾期', value: String(t.overdue) },
        { label: '高优先级', value: String(t.highPending) },
        { label: '无截止日', value: String(t.noDuePending) },
      ],
      bullets,
      items: t.top.map((x) => ({ title: x.title, meta: (x.priority ? x.priority + '优先级' : '') + (x.due_date ? ' · 截止 ' + x.due_date : '') + (x.overdue ? ' · 已逾期' : ''), bad: x.overdue })),
    });
  }

  /* 日程 */
  if (d.calendar) {
    const c = d.calendar;
    const bullets = [];
    if (c.conflicts.length) {
      for (const cf of c.conflicts.slice(0, 3)) {
        bullets.push({ kind: 'warn', text: cf.date + ' ' + cf.at + ' 前后「' + cf.a + '」与「' + cf.b + '」时间重叠，建议调整其一。' });
      }
    }
    if (c.freeBlocks.length) {
      const big = [...c.freeBlocks].sort((a, b) => b.min - a.min)[0];
      bullets.push({ kind: 'tip', text: '今天 ' + big.from + '–' + big.to + ' 有一段约 ' + fmtDuration(big.min) + ' 的空闲，可用于专注处理重要任务。' });
    }
    if (!c.todayCount) bullets.push({ kind: 'info', text: '今天没有安排日程，时间比较自由。' });

    secs.push({
      key: 'schedule', title: '日程安排', icon: '📅',
      summary: c.todayCount
        ? '今天有 ' + c.todayCount + ' 个日程' + (c.conflicts.length ? '，其中 ' + c.conflicts.length + ' 处存在时间冲突' : '，暂未发现时间冲突') + '。'
        : '今天暂无日程安排。',
      stats: [
        { label: '今日日程', value: String(c.todayCount) },
        { label: '待开始', value: String(c.upcomingCount) },
        { label: '冲突', value: String(c.conflicts.length) },
      ],
      bullets,
      items: c.todayEvents.map((e) => ({ title: e.title, meta: e.startHM + (e.endHM ? '–' + e.endHM : '') + (e.location ? ' · ' + e.location : ''), bad: false })),
    });
  }

  /* 财务 */
  if (d.finance) {
    const f = d.finance;
    const bullets = [];
    if (f.topCategory) bullets.push({ kind: 'info', text: '本月支出最多的分类是「' + f.topCategory.category + '」，共 ' + fmtMoney(f.topCategory.amount, cur) + '。' });
    if (f.trendPct != null && Math.abs(f.trendPct) >= 20) {
      bullets.push({ kind: f.trendPct > 0 ? 'warn' : 'good', text: '与上一周期相比，支出' + (f.trendPct > 0 ? '增加' : '减少') + '了 ' + Math.abs(f.trendPct) + '%。' });
    }
    if (f.monthBalance < 0) bullets.push({ kind: 'warn', text: '本月支出已超过收入 ' + fmtMoney(Math.abs(f.monthBalance), cur) + '。' });
    else if (f.monthIncome > 0) bullets.push({ kind: 'good', text: '本月结余 ' + fmtMoney(f.monthBalance, cur) + '。' });
    if (!f.recordCount) bullets.push({ kind: 'info', text: '当前周期没有记账记录。' });

    secs.push({
      key: 'finance', title: '财务概览', icon: '💰',
      summary: f.recordCount
        ? '本月已记录支出 ' + fmtMoney(f.monthExpense, cur) + '，收入 ' + fmtMoney(f.monthIncome, cur) + '，结余 ' + fmtMoney(f.monthBalance, cur) + '。'
        : '本月暂无记账记录。',
      stats: [
        { label: '今日支出', value: fmtMoney(f.todayExpense, cur) },
        { label: '本月支出', value: fmtMoney(f.monthExpense, cur) },
        { label: '本月收入', value: fmtMoney(f.monthIncome, cur) },
        { label: '本月结余', value: fmtMoney(f.monthBalance, cur) },
      ],
      bullets,
      items: f.byCategory.slice(0, 5).map((x) => ({ title: x.category, meta: fmtMoney(x.amount, cur), bad: false })),
    });
  }

  /* 生活 */
  if (d.lifestyle) {
    const l = d.lifestyle;
    const bullets = [];
    if (l.sleep.todayMin != null) bullets.push({ kind: 'info', text: '昨夜睡眠 ' + fmtDuration(l.sleep.todayMin) + (l.sleep.todayQuality ? '（' + (QUALITY_LABELS[l.sleep.todayQuality] || l.sleep.todayQuality) + '）' : '') + '。' });
    else bullets.push({ kind: 'tip', text: '昨晚还没有睡眠记录，记得补录以便观察作息。' });
    if (l.water.todayMl < l.waterGoal) bullets.push({ kind: 'tip', text: '今日饮水 ' + l.water.todayMl + ' ml，距离目标还差 ' + (l.waterGoal - l.water.todayMl) + ' ml。' });
    else bullets.push({ kind: 'good', text: '今日饮水已达标（' + l.water.todayMl + ' / ' + l.waterGoal + ' ml）。' });
    if (l.exercise.todayMin > 0) bullets.push({ kind: 'good', text: '今天已运动 ' + fmtDuration(l.exercise.todayMin) + '。' });
    else bullets.push({ kind: 'info', text: '今天还没有运动记录。' });
    if (l.mood.today) bullets.push({ kind: 'info', text: '最近一次心情：' + (MOOD_LABELS[l.mood.today] || l.mood.today) + '。' });
    if (l.energy.today != null) bullets.push({ kind: 'info', text: '今日精力：' + l.energy.today + ' /5。' });

    secs.push({
      key: 'lifestyle', title: '生活方式', icon: '🧬',
      summary: '昨夜睡眠 ' + (l.sleep.todayMin != null ? fmtDuration(l.sleep.todayMin) : '未记录')
        + '，今日饮水 ' + l.water.todayMl + ' ml，今日运动 ' + fmtDuration(l.exercise.todayMin) + '。',
      stats: [
        { label: '睡眠', value: l.sleep.todayMin != null ? fmtDurationShort(l.sleep.todayMin) : '—' },
        { label: '饮水', value: l.water.todayMl + ' ml' },
        { label: '运动', value: fmtDurationShort(l.exercise.todayMin) },
        { label: '精力', value: l.energy.today != null ? l.energy.today + '/5' : '—' },
        { label: '心情', value: l.mood.today ? (MOOD_LABELS[l.mood.today] || l.mood.today) : '—' },
      ],
      bullets,
    });
  }

  /* 日记 */
  if (d.diary && d.diary.enabled) {
    const j = d.diary;
    const bullets = [];
    if (j.themes.length) bullets.push({ kind: 'info', text: '近期日记中反复出现的主题：' + j.themes.map((t) => '「' + t.word + '」').join('、') + '。' });
    bullets.push({ kind: 'tip', text: '可以试着用一两句话记录今天的一个小收获，帮助梳理情绪。' });
    secs.push({
      key: 'diary', title: '个人反思', icon: '📓',
      summary: j.count ? '本周期你写下了 ' + j.count + ' 篇日记。' : '本周期还没有日记记录。',
      stats: [{ label: '日记数', value: String(j.count) }],
      bullets,
      items: j.recentTitles.map((t) => ({ title: t, meta: '', bad: false })),
    });
  }

  return secs;
}

/* ---------------- 周报分区 ---------------- */
function weeklySections(ctx) {
  const d = ctx.data;
  const cur = ctx.currency;
  const secs = [];
  const l = d.lifestyle || {};
  const t = d.todos || {};
  const f = d.finance || {};
  const c = d.calendar || {};

  secs.push({
    key: 'tasks', title: '任务完成率', icon: '✅',
    summary: t.inPeriod
      ? '本周共 ' + t.inPeriod + ' 项到期任务，完成 ' + t.inPeriodDone + ' 项，完成率 ' + t.completionRate + '%。'
      : '本周没有设定截止日期的任务。',
    stats: [
      { label: '到期任务', value: String(t.inPeriod || 0) },
      { label: '已完成', value: String(t.inPeriodDone || 0) },
      { label: '完成率', value: t.completionRate == null ? '—' : t.completionRate + '%' },
      { label: '当前逾期', value: String(t.overdue || 0) },
    ],
    bullets: t.overdue ? [{ kind: 'warn', text: '当前仍有 ' + t.overdue + ' 项逾期任务，建议尽快处理。' }] : [{ kind: 'good', text: '目前没有逾期任务。' }],
  });

  secs.push({
    key: 'finance', title: '财务概览', icon: '💰',
    summary: f.recordCount
      ? '本周支出 ' + fmtMoney(f.periodExpense, cur) + '，收入 ' + fmtMoney(f.periodIncome, cur) + '，结余 ' + fmtMoney(f.periodBalance, cur) + '。'
      : '本周暂无记账记录。',
    stats: [
      { label: '本周支出', value: fmtMoney(f.periodExpense, cur) },
      { label: '本周收入', value: fmtMoney(f.periodIncome, cur) },
      { label: '本周结余', value: fmtMoney(f.periodBalance, cur) },
      { label: '较上期', value: f.trendPct == null ? '—' : (f.trendPct >= 0 ? '+' : '') + f.trendPct + '%' },
    ],
    bullets: f.topCategory ? [{ kind: 'info', text: '支出最多的分类是「' + f.topCategory.category + '」，共 ' + fmtMoney(f.topCategory.amount, cur) + '。' }] : [],
  });

  secs.push({
    key: 'schedule', title: '日程概览', icon: '📅',
    summary: '本周共有 ' + (c.inPeriod || 0) + ' 个日程' + (c.busiest ? '，最忙的是 ' + c.busiest.date + '（' + c.busiest.count + ' 个）' : '') + '。',
    stats: [
      { label: '本周日程', value: String(c.inPeriod || 0) },
      { label: '时间冲突', value: String((c.conflicts || []).length) },
    ],
    bullets: [],
  });

  secs.push({
    key: 'lifestyle', title: '睡眠与运动趋势', icon: '🧬',
    summary: l.sleep && l.sleep.count
      ? '本周平均睡眠 ' + fmtDuration(l.sleep.avgMin) + '，运动共 ' + fmtDuration(l.exercise.totalMin) + '（' + l.exercise.activeDays + ' 个活跃日）。'
      : '本周缺少睡眠或运动记录。',
    stats: [
      { label: '平均睡眠', value: l.sleep && l.sleep.avgMin ? fmtDurationShort(l.sleep.avgMin) : '—' },
      { label: '睡眠记录', value: (l.sleep ? l.sleep.count : 0) + ' 天' },
      { label: '运动总时长', value: fmtDurationShort(l.exercise ? l.exercise.totalMin : 0) },
      { label: '活跃日', value: (l.exercise ? l.exercise.activeDays : 0) + ' 天' },
    ],
    bullets: l.sleep && l.sleep.count && l.sleep.avgMin < 360 ? [{ kind: 'tip', text: '本周平均睡眠不足 6 小时，注意适当休息。' }] : [],
    charts: [
      { kind: 'bar', title: '睡眠（分钟）', unit: ' 分钟', color: 'var(--accent-2)', data: (l.series ? l.series.sleep : []).map((p) => ({ label: shortDate(p.date), value: p.value })) },
      { kind: 'bar', title: '运动（分钟）', unit: ' 分钟', color: 'var(--accent-1)', data: (l.series ? l.series.exercise : []).map((p) => ({ label: shortDate(p.date), value: p.value })) },
    ],
  });

  secs.push({
    key: 'mood-energy', title: '心情与精力趋势', icon: '🙂',
    summary: l.mood && l.mood.total
      ? '本周记录了 ' + l.mood.total + ' 条心情，平均心情分 ' + l.mood.avgScore + ' /5；平均精力 ' + (l.energy.avg || '—') + ' /5。'
      : '本周缺少心情或精力记录。',
    stats: [
      { label: '心情记录', value: (l.mood ? l.mood.total : 0) + ' 条' },
      { label: '平均心情分', value: l.mood && l.mood.avgScore ? String(l.mood.avgScore) : '—' },
      { label: '平均精力', value: l.energy && l.energy.avg ? l.energy.avg + ' /5' : '—' },
    ],
    bullets: [],
    charts: [
      { kind: 'line', title: '心情分数', unit: '', color: 'var(--accent-1)', data: (l.series ? l.series.mood : []).map((p) => ({ label: shortDate(p.date), value: p.value })) },
      { kind: 'line', title: '精力等级', unit: '', color: 'var(--accent-2)', data: (l.series ? l.series.energy : []).map((p) => ({ label: shortDate(p.date), value: p.value })) },
    ],
  });

  const achievements = [];
  if (t.inPeriodDone) achievements.push('完成了 ' + t.inPeriodDone + ' 项任务');
  if (l.exercise && l.exercise.activeDays) achievements.push('运动了 ' + l.exercise.activeDays + ' 天，共 ' + fmtDuration(l.exercise.totalMin));
  if (l.water && l.water.goalDays) achievements.push('饮水达标 ' + l.water.goalDays + ' 天');
  if (l.mood && l.mood.total) achievements.push('记录了 ' + l.mood.total + ' 条心情');
  secs.push({
    key: 'achievements', title: '本周成就', icon: '🏆',
    summary: achievements.length ? '本周你' + achievements.join('，') + '。' : '本周还没有足够的数据来总结成就。',
    stats: [], bullets: achievements.map((a) => ({ kind: 'good', text: a })),
  });

  return secs;
}

/* ---------------- 月报分区 ---------------- */
function monthlySections(ctx) {
  const d = ctx.data;
  const cur = ctx.currency;
  const secs = [];
  const l = d.lifestyle || {};
  const t = d.todos || {};
  const f = d.finance || {};

  secs.push({
    key: 'productivity', title: '本月生产力', icon: '⚡',
    summary: t.inPeriod
      ? '本月到期任务 ' + t.inPeriod + ' 项，完成 ' + t.inPeriodDone + ' 项，完成率 ' + t.completionRate + '%。'
      : '本月没有设定截止日期的任务。',
    stats: [
      { label: '到期任务', value: String(t.inPeriod || 0) },
      { label: '完成', value: String(t.inPeriodDone || 0) },
      { label: '完成率', value: t.completionRate == null ? '—' : t.completionRate + '%' },
    ],
    bullets: [],
  });

  secs.push({
    key: 'finance', title: '财务概览', icon: '💰',
    summary: '本月支出 ' + fmtMoney(f.monthExpense, cur) + '，收入 ' + fmtMoney(f.monthIncome, cur) + '，结余 ' + fmtMoney(f.monthBalance, cur) + '。',
    stats: [
      { label: '本月支出', value: fmtMoney(f.monthExpense, cur) },
      { label: '本月收入', value: fmtMoney(f.monthIncome, cur) },
      { label: '本月结余', value: fmtMoney(f.monthBalance, cur) },
      { label: '较上期', value: f.trendPct == null ? '—' : (f.trendPct >= 0 ? '+' : '') + f.trendPct + '%' },
    ],
    bullets: f.byCategory.length ? [{ kind: 'info', text: '支出分类前 3：' + f.byCategory.slice(0, 3).map((x) => x.category + ' ' + fmtMoney(x.amount, cur)).join('、') + '。' }] : [],
  });

  secs.push({
    key: 'lifestyle', title: '生活统计', icon: '🧬',
    summary: l.sleep && l.sleep.count
      ? '本月平均睡眠 ' + fmtDuration(l.sleep.avgMin) + '，运动共 ' + fmtDuration(l.exercise.totalMin) + '，饮水达标率 ' + l.water.goalRate + '%。'
      : '本月生活记录不足。',
    stats: [
      { label: '平均睡眠', value: l.sleep && l.sleep.avgMin ? fmtDurationShort(l.sleep.avgMin) : '—' },
      { label: '运动总时长', value: fmtDurationShort(l.exercise ? l.exercise.totalMin : 0) },
      { label: '活跃日', value: (l.exercise ? l.exercise.activeDays : 0) + ' 天' },
      { label: '饮水达标率', value: (l.water ? l.water.goalRate : 0) + '%' },
      { label: '平均心情', value: l.mood && l.mood.avgScore ? String(l.mood.avgScore) : '—' },
      { label: '平均精力', value: l.energy && l.energy.avg ? String(l.energy.avg) : '—' },
    ],
    bullets: [],
    charts: [
      { kind: 'bar', title: '睡眠（周均，分钟）', unit: ' 分钟', color: 'var(--accent-2)', data: bucketWeekly(l.series ? l.series.sleep : [], ctx.period.from) },
      { kind: 'bar', title: '运动（周均，分钟）', unit: ' 分钟', color: 'var(--accent-1)', data: bucketWeekly(l.series ? l.series.exercise : [], ctx.period.from) },
    ],
  });

  // 习惯目标进度（无独立目标模块，用可量化的习惯目标如实呈现）
  secs.push({
    key: 'goals', title: '习惯目标进度', icon: '🎯',
    summary: '以饮水达标、运动活跃、睡眠记录作为可量化的习惯目标参考。',
    stats: [
      { label: '饮水达标', value: (l.water ? l.water.goalDays : 0) + ' 天' },
      { label: '运动活跃', value: (l.exercise ? l.exercise.activeDays : 0) + ' 天' },
      { label: '睡眠记录', value: (l.sleep ? l.sleep.count : 0) + ' 天' },
    ],
    bullets: [],
  });

  const achievements = [];
  if (t.inPeriodDone) achievements.push('完成 ' + t.inPeriodDone + ' 项任务');
  if (l.exercise && l.exercise.activeDays) achievements.push('运动 ' + l.exercise.activeDays + ' 天');
  if (l.water && l.water.goalDays) achievements.push('饮水达标 ' + l.water.goalDays + ' 天');
  secs.push({
    key: 'achievements', title: '本月成就', icon: '🏆',
    summary: achievements.length ? '本月你' + achievements.join('，') + '。' : '本月数据不足，暂不总结成就。',
    stats: [], bullets: achievements.map((a) => ({ kind: 'good', text: a })),
  });

  if (d.diary && d.diary.enabled) {
    const j = d.diary;
    secs.push({
      key: 'diary', title: '日记反思', icon: '📓',
      summary: j.count ? '本月写下了 ' + j.count + ' 篇日记' + (j.themes.length ? '，常出现的主题是' + j.themes.slice(0, 3).map((t) => '「' + t.word + '」').join('、') : '') + '。' : '本月没有日记记录。',
      stats: [{ label: '日记数', value: String(j.count) }],
      bullets: j.themes.slice(0, 3).map((t) => ({ kind: 'info', text: '「' + t.word + '」出现 ' + t.count + ' 次。' })),
    });
  }

  return secs;
}

/* ---------------- 建议 ---------------- */
function hasAnyData(ctx) {
  const d = (ctx && ctx.data) || {};
  const t = d.todos || {};
  const c = d.calendar || {};
  const f = d.finance || {};
  const l = d.lifestyle || {};
  return !!(
    t.total ||
    c.total ||
    f.recordCount || f.monthExpense || f.monthIncome ||
    (l.sleep && l.sleep.count) ||
    (l.exercise && l.exercise.count) ||
    (l.water && l.water.daysWithWater) ||
    (l.mood && l.mood.total) ||
    (l.energy && l.energy.count) ||
    (d.diary && d.diary.enabled && d.diary.count)
  );
}

function buildRecommendations(ctx, sections) {
  const d = ctx.data;
  const cur = ctx.currency;
  const out = [];
  const push = (tag, title, detail) => out.push({ tag, title, detail });

  // 数据不足时不产出建议
  if (!hasAnyData(ctx)) return [];

  const t = d.todos || {};
  const c = d.calendar || {};
  const f = d.finance || {};
  const l = d.lifestyle || {};

  if (t.overdue > 0) {
    push('优先级', '先处理逾期任务', '「' + (t.overdueList[0] ? t.overdueList[0].title : '逾期任务') + '」已逾期' + (t.overdueList[0] ? '（截止 ' + t.overdueList[0].due_date + '）' : '') + '，建议今天优先完成。');
  } else if (t.highPending > 0) {
    push('优先级', '优先完成高优先级任务', '有 ' + t.highPending + ' 项高优先级待办' + (t.highList[0] ? '，例如「' + t.highList[0].title + '」' : '') + '，可先集中处理。');
  }

  if (c.freeBlocks && c.freeBlocks.length) {
    const big = [...c.freeBlocks].sort((a, b) => b.min - a.min)[0];
    push('时间管理', '预留专注时间块', '今天 ' + big.from + '–' + big.to + ' 有约 ' + fmtDuration(big.min) + ' 的空闲，可安排一段不被打扰的专注时间。');
  }
  if (c.conflicts && c.conflicts.length) {
    push('时间管理', '处理日程冲突', c.conflicts[0].date + ' 的「' + c.conflicts[0].a + '」与「' + c.conflicts[0].b + '」时间重叠，建议调整其中一个。');
  }

  if (f.topCategory && f.monthExpense > 0) {
    push('财务意识', '关注支出最高分类', '本月「' + f.topCategory.category + '」支出最多，共 ' + fmtMoney(f.topCategory.amount, cur) + '，可回顾是否有可优化的部分。');
  } else if (f.monthBalance < 0) {
    push('财务意识', '留意收支平衡', '本月支出已超过收入 ' + fmtMoney(Math.abs(f.monthBalance), cur) + '，建议检查大额支出。');
  }

  if (l.water && l.water.todayMl < l.waterGoal) {
    push('生活方式', '记得补充饮水', '今日饮水 ' + l.water.todayMl + ' ml，距离目标还差 ' + (l.waterGoal - l.water.todayMl) + ' ml。');
  }
  if (l.sleep && l.sleep.todayMin == null) {
    push('生活方式', '补录昨晚睡眠', '昨晚还没有睡眠记录，补录后能更准确地观察作息趋势。');
  } else if (l.sleep && l.sleep.todayMin != null && l.sleep.todayMin < 360) {
    push('生活方式', '注意休息', '昨夜睡眠约 ' + fmtDuration(l.sleep.todayMin) + '，今天可以适当安排休息。');
  }
  if (l.exercise && l.exercise.activeDays === 0) {
    push('生活方式', '安排一点运动', '本周期还没有运动记录，哪怕散步 20 分钟也有帮助。');
  }

  if (d.diary && d.diary.enabled && d.diary.themes.length) {
    push('个人成长', '延续最近关注的主题', '近期日记常写到「' + d.diary.themes[0].word + '」，可以围绕它做一个小计划或写一段反思。');
  } else if (t.completionRate != null && t.completionRate >= 60) {
    push('个人成长', '保持当前节奏', '本周期任务完成率 ' + t.completionRate + '%，继续保持这个节奏。');
  }

  // —— 补充建议（仍严格基于真实数据，不空泛） ——
  if (!out.some((r) => r.tag === '优先级') && t.pending > 0) {
    push('优先级', '安排今日待办', '还有 ' + t.pending + ' 项待办未完成，建议挑出 1–2 项今天推进。');
  }
  if (l.sleep && l.sleep.todayQuality && (l.sleep.todayQuality === 'Poor' || l.sleep.todayQuality === 'Average')) {
    push('生活方式', '关注睡眠质量', '昨夜睡眠质量记为「' + (QUALITY_LABELS[l.sleep.todayQuality] || l.sleep.todayQuality) + '」，今晚可以试着稍微提前休息。');
  }
  if (l.energy && l.energy.today == null) {
    push('生活方式', '记录今日精力', '今天还没有精力记录，补录后能更好地观察状态变化。');
  }
  if (l.mood && l.mood.today && ['sad', 'stressed', 'tired'].indexOf(l.mood.today) !== -1) {
    push('生活方式', '关照自己的情绪', '最近一次心情是「' + (MOOD_LABELS[l.mood.today] || l.mood.today) + '」，给自己留一点放松的时间。');
  }
  if (l.water && l.water.todayMl === 0) {
    push('生活方式', '开始记录饮水', '今天还没有饮水记录，先从一杯水开始。');
  }
  if (ctx.type !== 'daily' && t.inPeriod > 0 && t.completionRate != null && t.completionRate < 60) {
    push('优先级', '提升任务完成率', '本周期完成率 ' + t.completionRate + '%，可以适当减少同时进行的任务数量，先专注少数几项。');
  }
  if (ctx.type === 'monthly' && l.water && l.water.daysWithWater > 0 && l.water.goalDays < l.water.daysWithWater) {
    push('生活方式', '提高饮水达标天数', '本月 ' + l.water.daysWithWater + ' 天有饮水记录，其中 ' + l.water.goalDays + ' 天达标，可以设个日常提醒。');
  }

  // 去重（按 title）并限制 3–5 条
  const seen = new Set();
  const uniq = out.filter((r) => { if (seen.has(r.title)) return false; seen.add(r.title); return true; });
  return uniq.slice(0, 5);
}

/* ---------------- 生成报告（本地） ---------------- */
function buildLocalReport(ctx) {
  const sections = ctx.type === 'daily'
    ? dailySections(ctx)
    : ctx.type === 'weekly'
      ? weeklySections(ctx)
      : monthlySections(ctx);

  const overview = buildOverview(ctx);
  const recommendations = buildRecommendations(ctx, sections);
  const g = greetingFor(new Date());

  // 空数据检测
  const d = ctx.data;
  const hasAny = hasAnyData(ctx);

  let headline;
  if (!hasAny) {
    headline = '还没有足够的数据来生成分析。先记录一些待办、日程、账单或生活数据，我就能为你总结。';
  } else if (ctx.type === 'daily') {
    const t = d.todos || {};
    const c = d.calendar || {};
    const parts = [];
    if (t.pending || t.overdue) parts.push('今天有 ' + (t.pending || 0) + ' 项待办' + (t.overdue ? '（' + t.overdue + ' 项逾期）' : ''));
    else parts.push('今天没有未完成的待办');
    if (c.todayCount) parts.push(c.todayCount + ' 个日程');
    if (d.finance && d.finance.todayExpense) parts.push('今日支出 ' + fmtMoney(d.finance.todayExpense, ctx.currency));
    if (d.lifestyle && d.lifestyle.sleep.todayMin != null) parts.push('昨夜睡眠 ' + fmtDuration(d.lifestyle.sleep.todayMin));
    headline = parts.join('，') + '。';
  } else if (ctx.type === 'weekly') {
    const t = d.todos || {};
    const l = d.lifestyle || {};
    headline = '本周' + (t.inPeriod ? '任务完成率 ' + t.completionRate + '%' : '任务数据较少')
      + (l.exercise && l.exercise.activeDays ? '，运动 ' + l.exercise.activeDays + ' 天' : '')
      + (d.finance ? '，支出 ' + fmtMoney(d.finance.periodExpense, ctx.currency) : '') + '。';
  } else {
    const t = d.todos || {};
    const l = d.lifestyle || {};
    headline = '本月' + (t.inPeriod ? '任务完成率 ' + t.completionRate + '%' : '任务数据较少')
      + (d.finance ? '，支出 ' + fmtMoney(d.finance.monthExpense, ctx.currency) : '')
      + (l.sleep && l.sleep.avgMin ? '，平均睡眠 ' + fmtDurationShort(l.sleep.avgMin) : '') + '。';
  }

  return {
    type: ctx.type,
    period: { from: ctx.period.from, to: ctx.period.to, label: periodLabel(ctx.type, ctx.period.from, ctx.period.to) },
    generatedAt: ctx.generatedAt,
    source: 'local',
    aiGenerated: false,
    provider: { configured: false, model: null },
    greeting: g.text,
    greetingEn: g.en,
    headline,
    overview,
    sections,
    recommendations,
    notes: buildNotes(ctx),
    hasData: hasAny,
  };
}

function buildNotes(ctx) {
  const notes = [];
  notes.push('以上内容由本地分析引擎根据你已记录的数据生成，未记录的信息不会被推测。');
  notes.push('建议仅作参考，不构成医疗、心理或财务建议。');
  if (ctx.data.diary && ctx.data.diary.enabled) notes.push('日记分析已开启，仅统计主题词与心情分布，不回传日记正文。');
  return notes;
}

/* ---------------- 追问（本地意图问答） ---------------- */
function answerLocally(question, ctx) {
  const q = String(question || '').toLowerCase();
  const d = ctx.data;
  const cur = ctx.currency;
  const t = d.todos || {};
  const c = d.calendar || {};
  const f = d.finance || {};
  const l = d.lifestyle || {};
  const cite = (module, detail) => ({ module, detail });

  const has = (re) => re.test(q);

  if (has(/逾期|过期|超期|overdue/)) {
    if (!t.overdue) return { answer: '目前没有逾期任务，所有待办都在计划内。', citations: [cite('待办', '逾期 0 项')] };
    return {
      answer: '当前有 ' + t.overdue + ' 项逾期任务：' + t.overdueList.map((x) => '「' + x.title + '」（截止 ' + x.due_date + '）').join('、') + '。建议优先处理。',
      citations: [cite('待办', '逾期 ' + t.overdue + ' 项')],
    };
  }

  if (has(/优先|先做|先完成|最重要|priority|first/)) {
    if (!t.top.length) return { answer: '目前没有未完成的待办，可以规划新的目标。', citations: [cite('待办', '未完成 0 项')] };
    const x = t.top[0];
    return {
      answer: '建议优先处理「' + x.title + '」' + (x.overdue ? '（已逾期）' : x.due_date ? '（截止 ' + x.due_date + '）' : '') + '，它是当前' + (x.priority === '高' ? '高优先级' : '排序最靠前') + '的任务。',
      citations: [cite('待办', '未完成 ' + t.pending + ' 项，高优先级 ' + t.highPending + ' 项')],
    };
  }

  if (has(/花|支出|消费|spend|expense|多少钱/)) {
    return {
      answer: '本月已记录支出 ' + fmtMoney(f.monthExpense, cur) + (f.topCategory ? '，其中「' + f.topCategory.category + '」最多，约 ' + fmtMoney(f.topCategory.amount, cur) : '') + '。',
      citations: [cite('记账', '本月支出 ' + fmtMoney(f.monthExpense, cur))],
    };
  }

  if (has(/收入|赚|income/)) {
    return { answer: '本月已记录收入 ' + fmtMoney(f.monthIncome, cur) + '，结余 ' + fmtMoney(f.monthBalance, cur) + '。', citations: [cite('记账', '本月收入 ' + fmtMoney(f.monthIncome, cur))] };
  }

  if (has(/睡眠|睡了|睡|sleep/)) {
    if (!l.sleep || l.sleep.count === 0) return { answer: '最近还没有睡眠记录，补录后我可以帮你分析作息。', citations: [cite('生活', '睡眠记录 0 天')] };
    return {
      answer: '最近 ' + l.sleep.count + ' 天有睡眠记录，平均 ' + fmtDuration(l.sleep.avgMin) + '。' + (l.sleep.todayMin != null ? '昨晚睡了 ' + fmtDuration(l.sleep.todayMin) + '。' : ''),
      citations: [cite('生活', '平均睡眠 ' + fmtDuration(l.sleep.avgMin))],
    };
  }

  if (has(/运动|锻炼|exercise|workout/)) {
    if (!l.exercise || l.exercise.count === 0) return { answer: '最近还没有运动记录。', citations: [cite('生活', '运动 0 次')] };
    return {
      answer: '最近运动了 ' + l.exercise.activeDays + ' 天，共 ' + fmtDuration(l.exercise.totalMin) + (l.exercise.todayMin ? '，今天已运动 ' + fmtDuration(l.exercise.todayMin) : '') + '。',
      citations: [cite('生活', '运动 ' + l.exercise.activeDays + ' 天')],
    };
  }

  if (has(/饮水|喝水|水|water/)) {
    return {
      answer: '今日饮水 ' + l.water.todayMl + ' ml，目标是 ' + l.waterGoal + ' ml' + (l.water.todayMl >= l.waterGoal ? '，已达标。' : '，还差 ' + (l.waterGoal - l.water.todayMl) + ' ml。'),
      citations: [cite('生活', '今日饮水 ' + l.water.todayMl + ' ml')],
    };
  }

  if (has(/心情|情绪|mood/)) {
    if (!l.mood || l.mood.total === 0) return { answer: '最近还没有心情记录。', citations: [cite('生活', '心情 0 条')] };
    return { answer: '最近记录了 ' + l.mood.total + ' 条心情，平均心情分 ' + l.mood.avgScore + ' /5。', citations: [cite('生活', '平均心情分 ' + l.mood.avgScore)] };
  }

  if (has(/精力|energy/)) {
    if (!l.energy || l.energy.count === 0) return { answer: '最近还没有精力记录。', citations: [cite('生活', '精力 0 天')] };
    return { answer: '最近 ' + l.energy.count + ' 天有精力记录，平均 ' + l.energy.avg + ' /5。', citations: [cite('生活', '平均精力 ' + l.energy.avg)] };
  }

  if (has(/日程|安排|会议|schedule|calendar/)) {
    if (!c.todayCount) return { answer: '今天没有安排日程。', citations: [cite('日程', '今日 0 个')] };
    return {
      answer: '今天有 ' + c.todayCount + ' 个日程：' + c.todayEvents.map((e) => e.startHM + ' ' + e.title).join('；') + '。',
      citations: [cite('日程', '今日 ' + c.todayCount + ' 个')],
    };
  }

  if (has(/效率|生产力|完成率|productivity|本周|这周|week|总结|summar/)) {
    return {
      answer: '本周期任务完成率 ' + (t.completionRate == null ? '暂无数据' : t.completionRate + '%') + '，到期任务 ' + (t.inPeriod || 0) + ' 项、完成 ' + (t.inPeriodDone || 0) + ' 项；运动 ' + (l.exercise ? l.exercise.activeDays : 0) + ' 天，支出 ' + fmtMoney(f.periodExpense, cur) + '。',
      citations: [cite('综合', '本周期概览')],
    };
  }

  if (has(/明天|改进|建议|improve|suggest|tomorrow/)) {
    const recs = buildRecommendations(ctx, []);
    if (!recs.length) return { answer: '目前数据还不足以给出具体建议，先多记录一些日常数据吧。', citations: [] };
    return { answer: '可以从这几件事入手：' + recs.slice(0, 3).map((r, i) => (i + 1) + '. ' + r.title + '——' + r.detail).join(' '), citations: [cite('建议', recs.length + ' 条')] };
  }

  // 兜底
  return {
    answer: '我可以回答关于待办、日程、记账、睡眠、运动、饮水、心情、精力的具体问题。例如：「哪些任务逾期了？」「这个月花了多少钱？」「我最近睡眠怎么样？」',
    citations: [],
  };
}

/* ---------------- LLM 接入（OpenAI 兼容） ---------------- */
function llmConfig() {
  const key = process.env.AI_API_KEY || process.env.OPENAI_API_KEY || '';
  const base = (process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = process.env.AI_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';
  return { key, base, model, configured: !!key };
}

async function callLLM(messages, opts) {
  const o = opts || {};
  const cfg = llmConfig();
  if (!cfg.configured) throw new Error('NO_PROVIDER');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), o.timeout || 25000);
  try {
    const body = {
      model: cfg.model,
      messages,
      temperature: o.temperature == null ? 0.4 : o.temperature,
    };
    if (o.json) body.response_format = { type: 'json_object' };
    let res = await fetch(cfg.base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.key },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    // 部分兼容服务不支持 response_format，去掉后重试一次
    if (!res.ok && o.json) {
      delete body.response_format;
      res = await fetch(cfg.base + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.key },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    }
    if (!res.ok) {
      const txt = await res.text();
      throw new Error('LLM_HTTP_' + res.status + ': ' + String(txt).slice(0, 200));
    }
    const j = await res.json();
    return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
  } finally {
    clearTimeout(timer);
  }
}

function compactContext(ctx) {
  const d = ctx.data;
  return {
    type: ctx.type,
    period: ctx.period,
    today: ctx.today,
    currency: ctx.currency,
    todos: d.todos,
    calendar: d.calendar,
    finance: d.finance,
    lifestyle: d.lifestyle ? {
      sleep: d.lifestyle.sleep, exercise: d.lifestyle.exercise, water: d.lifestyle.water,
      mood: d.lifestyle.mood, energy: d.lifestyle.energy, missing: d.lifestyle.missing,
    } : null,
    diary: d.diary && d.diary.enabled ? { count: d.diary.count, themes: d.diary.themes, moods: d.diary.moods } : { enabled: false },
  };
}

function allowedKeys(type) {
  if (type === 'daily') return ['tasks', 'schedule', 'finance', 'lifestyle', 'diary'];
  if (type === 'weekly') return ['tasks', 'finance', 'schedule', 'lifestyle', 'mood-energy', 'achievements'];
  return ['productivity', 'finance', 'lifestyle', 'goals', 'achievements', 'diary'];
}

async function enrichWithLLM(localReport, ctx) {
  const keys = allowedKeys(ctx.type);
  const sys = [
    '你是一名私人生活助理，负责用简洁、具体、务实的中文总结用户已记录的生活数据。',
    '严格规则：',
    '1) 只能使用用户消息中提供的 JSON 数据，绝不编造任何数字、事件或记录。',
    '2) 数值必须与提供的数据一致，不要自行计算或改写。',
    '3) 不做医疗或心理诊断，不做财务保证或投资建议。',
    '4) 建议要具体、可执行，避免空泛的励志话术。',
    '5) 只输出严格 JSON，不要 markdown 代码块。',
    'JSON 结构：{"headline": string, "sections": [{"key": string, "summary": string, "bullets": [{"kind": "info|tip|warn|good", "text": string}]}], "recommendations": [{"tag": string, "title": string, "detail": string}]}',
    'sections 的 key 只能取这些值之一：' + keys.join(', ') + '。',
  ].join('\n');

  const user = '报告类型：' + ctx.type + '\n用户数据(JSON)：\n' + JSON.stringify(compactContext(ctx)) +
    '\n\n请基于以上数据生成报告叙事。sections 只需覆盖数据中存在的模块，每个 section 的 summary 用 1-2 句，bullets 1-3 条。recommendations 给 3-5 条。';

  const raw = await callLLM([
    { role: 'system', content: sys },
    { role: 'user', content: user },
  ], { json: true, temperature: 0.4 });

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    // 尝试剥离可能的 ```json 包裹
    const m = String(raw).match(/\{[\s\S]*\}/);
    if (!m) throw new Error('LLM_BAD_JSON');
    parsed = JSON.parse(m[0]);
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('LLM_BAD_SHAPE');

  // 合并：只替换叙事文本，保留本地统计（数字永远来自本地）
  const merged = JSON.parse(JSON.stringify(localReport));
  if (typeof parsed.headline === 'string' && parsed.headline.trim()) merged.headline = parsed.headline.trim();

  if (Array.isArray(parsed.sections)) {
    const map = {};
    for (const s of parsed.sections) {
      if (!s || !s.key || keys.indexOf(s.key) === -1) continue;
      map[s.key] = s;
    }
    for (const sec of merged.sections) {
      const ai = map[sec.key];
      if (!ai) continue;
      if (typeof ai.summary === 'string' && ai.summary.trim()) sec.summary = ai.summary.trim();
      if (Array.isArray(ai.bullets)) {
        const bs = ai.bullets
          .filter((b) => b && typeof b.text === 'string' && b.text.trim())
          .map((b) => ({ kind: ['info', 'tip', 'warn', 'good'].includes(b.kind) ? b.kind : 'info', text: b.text.trim() }))
          .slice(0, 4);
        if (bs.length) sec.bullets = bs;
      }
    }
  }

  if (Array.isArray(parsed.recommendations)) {
    const rs = parsed.recommendations
      .filter((r) => r && typeof r.title === 'string' && r.title.trim() && typeof r.detail === 'string' && r.detail.trim())
      .map((r) => ({ tag: typeof r.tag === 'string' ? r.tag.trim() : '建议', title: r.title.trim(), detail: r.detail.trim() }))
      .slice(0, 5);
    if (rs.length >= 1) merged.recommendations = rs;
  }

  merged.source = 'ai';
  merged.aiGenerated = true;
  merged.provider = { configured: true, model: llmConfig().model };
  merged.notes = [
    '以上分析由 AI 模型基于你已记录的数据生成，数值来自应用内的真实统计。',
    'AI 内容仅供参考，不构成医疗、心理或财务建议。',
  ];
  return merged;
}

async function answerWithLLM(question, ctx) {
  const sys = [
    '你是一名私人生活助理。只依据用户提供的数据回答，不编造。',
    '回答简洁（2-4 句），使用中文，给出具体数字。',
    '不做医疗诊断，不做财务保证。',
  ].join('\n');
  const user = '数据(JSON)：\n' + JSON.stringify(compactContext(ctx)) + '\n\n用户问题：' + question;
  const raw = await callLLM([
    { role: 'system', content: sys },
    { role: 'user', content: user },
  ], { json: false, temperature: 0.3 });
  return { answer: String(raw || '').trim(), citations: [] };
}

module.exports = {
  buildLocalReport,
  answerLocally,
  enrichWithLLM,
  answerWithLLM,
  llmConfig,
  callLLM,
  fmtDuration,
  fmtDurationShort,
  fmtMoney,
  greetingFor,
  periodLabel,
  MOOD_LABELS,
};
