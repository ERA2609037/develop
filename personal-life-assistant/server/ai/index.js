'use strict';

/**
 * AI Daily Briefing —— 路由与服务装配
 *
 * 安全边界：
 *   - API Key 只从服务端环境变量读取，绝不下发到前端。
 *   - 所有数据读取都经由 Provider（只读），AI 不直接访问数据库。
 *   - 日记分析默认关闭；关闭时完全不读取日记。
 */

const { createProviders } = require('./providers');
const { createAggregator } = require('./aggregator');
const {
  buildLocalReport, answerLocally, enrichWithLLM, answerWithLLM, llmConfig,
} = require('./engine');

const DEFAULT_SETTINGS = {
  diary_enabled: '0',
  currency: '¥',
  auto_generate: '1',
  sources: JSON.stringify({ todos: true, calendar: true, finance: true, lifestyle: true }),
};

const TYPE_LABEL = { daily: '日报', weekly: '周报', monthly: '月报' };
const VALID_TYPES = ['daily', 'weekly', 'monthly'];

function register(app, ctx) {
  const { db, all, get, run, nowStr, localDateStr, addDaysStr, isValidDateStr } = ctx;

  const providers = createProviders(ctx);
  const aggregator = createAggregator(providers, ctx);

  /* ---------------- 设置读写 ---------------- */
  function aiGet(key, fallback) {
    const row = get(db, 'SELECT value FROM ai_settings WHERE skey = ?', [key]);
    return row ? row.value : fallback;
  }
  function aiSet(key, value) {
    const exist = get(db, 'SELECT skey FROM ai_settings WHERE skey = ?', [key]);
    if (exist) run(db, 'UPDATE ai_settings SET value = ? WHERE skey = ?', [String(value), key]);
    else run(db, 'INSERT INTO ai_settings (skey, value) VALUES (?, ?)', [key, String(value)]);
  }

  function readSettings() {
    let sources;
    try { sources = JSON.parse(aiGet('sources', DEFAULT_SETTINGS.sources)); } catch (e) { sources = JSON.parse(DEFAULT_SETTINGS.sources); }
    return {
      diaryEnabled: aiGet('diary_enabled', DEFAULT_SETTINGS.diary_enabled) === '1',
      currency: aiGet('currency', DEFAULT_SETTINGS.currency) || '¥',
      autoGenerate: aiGet('auto_generate', DEFAULT_SETTINGS.auto_generate) === '1',
      sources: {
        todos: sources.todos !== false,
        calendar: sources.calendar !== false,
        finance: sources.finance !== false,
        lifestyle: sources.lifestyle !== false,
      },
    };
  }

  function settingsPayload() {
    const s = readSettings();
    const cfg = llmConfig();
    return {
      diaryEnabled: s.diaryEnabled,
      currency: s.currency,
      autoGenerate: s.autoGenerate,
      sources: s.sources,
      provider: { configured: cfg.configured, model: cfg.configured ? cfg.model : null },
    };
  }

  /* ---------------- 周期计算 ---------------- */
  function computePeriod(type, date, from, to) {
    const base = isValidDateStr(date) ? date : localDateStr();
    if (type === 'daily') return { from: base, to: base };
    if (type === 'weekly') {
      if (isValidDateStr(from) && isValidDateStr(to)) return { from, to };
      const [y, m, d] = base.split('-').map(Number);
      const dow = (new Date(y, m - 1, d).getDay() + 6) % 7; // 0=周一
      return { from: addDaysStr(base, -dow), to: base };
    }
    // monthly
    if (isValidDateStr(from) && isValidDateStr(to)) return { from, to };
    return { from: base.slice(0, 8) + '01', to: base };
  }

  /* ---------------- 生成报告 ---------------- */
  async function generate(type, opts) {
    const o = opts || {};
    const settings = readSettings();
    const period = computePeriod(type, o.date, o.from, o.to);
    const today = localDateStr();

    const context = aggregator.build({
      type,
      from: period.from,
      to: period.to,
      today,
      options: { sources: settings.sources, diaryEnabled: settings.diaryEnabled, currency: settings.currency },
    });

    let report = buildLocalReport(context);
    const cfg = llmConfig();

    if (cfg.configured) {
      try {
        report = await enrichWithLLM(report, context);
      } catch (e) {
        report.source = 'local-fallback';
        report.aiGenerated = false;
        report.provider = { configured: true, model: cfg.model, error: true };
        report.notes = [
          'AI 模型本次未能返回有效结果，已回退到本地分析引擎。',
          '以上内容基于你已记录的数据生成，数值来自应用内的真实统计。',
        ];
      }
    }

    // 持久化（每次都新建，不覆盖历史）
    const title = period.from + (period.to !== period.from ? ' ~ ' + period.to : '') + ' ' + (TYPE_LABEL[type] || '报告');
    run(db,
      `INSERT INTO ai_reports (type, period_from, period_to, generated_at, source, title, headline, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [type, period.from, period.to, report.generatedAt, report.source, title,
        report.headline || '', JSON.stringify(report), nowStr()]);
    const id = get(db, 'SELECT last_insert_rowid() AS id').id;
    report.id = id;
    report.title = title;
    return report;
  }

  /* ---------------- 路由 ---------------- */

  app.get('/api/ai/status', (req, res) => {
    const cfg = llmConfig();
    res.json({
      configured: cfg.configured,
      provider: cfg.configured ? 'openai' : 'local',
      model: cfg.configured ? cfg.model : null,
      settings: settingsPayload(),
    });
  });

  app.get('/api/ai/settings', (req, res) => res.json(settingsPayload()));

  app.put('/api/ai/settings', (req, res) => {
    const b = req.body || {};
    if (b.diaryEnabled !== undefined) aiSet('diary_enabled', b.diaryEnabled ? '1' : '0');
    if (b.autoGenerate !== undefined) aiSet('auto_generate', b.autoGenerate ? '1' : '0');
    if (b.currency !== undefined) {
      const c = String(b.currency).trim().slice(0, 4);
      if (!c) return res.status(400).json({ error: '货币符号不能为空' });
      aiSet('currency', c);
    }
    if (b.sources && typeof b.sources === 'object') {
      const cur = readSettings().sources;
      const next = {
        todos: b.sources.todos !== undefined ? !!b.sources.todos : cur.todos,
        calendar: b.sources.calendar !== undefined ? !!b.sources.calendar : cur.calendar,
        finance: b.sources.finance !== undefined ? !!b.sources.finance : cur.finance,
        lifestyle: b.sources.lifestyle !== undefined ? !!b.sources.lifestyle : cur.lifestyle,
      };
      aiSet('sources', JSON.stringify(next));
    }
    res.json(settingsPayload());
  });

  app.post('/api/ai/briefing', async (req, res) => {
    try {
      const b = req.body || {};
      const type = VALID_TYPES.includes(b.type) ? b.type : 'daily';
      const report = await generate(type, { date: b.date, from: b.from, to: b.to });
      res.json(report);
    } catch (e) {
      console.error('[AI] 生成报告失败:', e);
      res.status(500).json({ error: '生成报告失败：' + (e.message || '未知错误') });
    }
  });

  app.get('/api/ai/reports', (req, res) => {
    const where = [];
    const params = [];
    if (VALID_TYPES.includes(req.query.type)) { where.push('type = ?'); params.push(req.query.type); }
    if (isValidDateStr(req.query.from)) { where.push('period_to >= ?'); params.push(req.query.from); }
    if (isValidDateStr(req.query.to)) { where.push('period_from <= ?'); params.push(req.query.to); }
    let sql = 'SELECT id, type, period_from, period_to, generated_at, source, title, headline FROM ai_reports';
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY generated_at DESC, id DESC';
    const limit = Number(req.query.limit);
    if (Number.isFinite(limit) && limit > 0) sql += ' LIMIT ' + Math.min(limit, 200);
    else sql += ' LIMIT 50';
    res.json(all(db, sql, params));
  });

  app.get('/api/ai/reports/:id', (req, res) => {
    const row = get(db, 'SELECT * FROM ai_reports WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: '报告不存在' });
    let payload = null;
    try { payload = JSON.parse(row.payload); } catch (e) { payload = null; }
    if (!payload) return res.status(500).json({ error: '报告内容损坏' });
    res.json(Object.assign({}, payload, { id: row.id, title: row.title, savedAt: row.generated_at }));
  });

  app.post('/api/ai/ask', async (req, res) => {
    try {
      const question = String((req.body && req.body.question) || '').trim().slice(0, 500);
      if (!question) return res.status(400).json({ error: '请输入问题' });

      const settings = readSettings();
      const today = localDateStr();
      const from = addDaysStr(today, -6);
      const context = aggregator.build({
        type: 'daily', from, to: today, today,
        options: { sources: settings.sources, diaryEnabled: settings.diaryEnabled, currency: settings.currency },
      });

      const cfg = llmConfig();
      let ans;
      let source = 'local';
      if (cfg.configured) {
        try {
          ans = await answerWithLLM(question, context);
          source = 'ai';
        } catch (e) {
          ans = answerLocally(question, context);
          source = 'local-fallback';
        }
      } else {
        ans = answerLocally(question, context);
      }
      res.json({ answer: ans.answer, citations: ans.citations || [], source });
    } catch (e) {
      console.error('[AI] 问答失败:', e);
      res.status(500).json({ error: '回答失败：' + (e.message || '未知错误') });
    }
  });

  // 首页卡片用的轻量预览（不调用 LLM、不落库）
  app.get('/api/ai/home', (req, res) => {
    try {
      const settings = readSettings();
      const today = localDateStr();
      const context = aggregator.build({
        type: 'daily', from: today, to: today, today,
        options: { sources: settings.sources, diaryEnabled: false, currency: settings.currency },
      });
      const report = buildLocalReport(context);
      const cfg = llmConfig();
      res.json({
        configured: cfg.configured,
        greeting: report.greeting,
        greetingEn: report.greetingEn,
        date: today,
        headline: report.headline,
        pendingTasks: context.data.todos ? context.data.todos.pending : 0,
        overdueTasks: context.data.todos ? context.data.todos.overdue : 0,
        todayEvents: context.data.calendar ? context.data.calendar.todayCount : 0,
        upcomingEvents: context.data.calendar ? context.data.calendar.upcomingCount : 0,
        recommendation: report.recommendations[0] || null,
        hasData: report.hasData,
      });
    } catch (e) {
      console.error('[AI] 首页预览失败:', e);
      res.status(500).json({ error: '预览失败' });
    }
  });

  // 透明度：返回聚合后的上下文（不含日记正文）
  app.get('/api/ai/context', (req, res) => {
    const type = VALID_TYPES.includes(req.query.type) ? req.query.type : 'daily';
    const settings = readSettings();
    const period = computePeriod(type, req.query.date, req.query.from, req.query.to);
    const context = aggregator.build({
      type, from: period.from, to: period.to, today: localDateStr(),
      options: { sources: settings.sources, diaryEnabled: settings.diaryEnabled, currency: settings.currency },
    });
    res.json(context);
  });
}

module.exports = { register };
