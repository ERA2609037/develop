/**
 * 个人生活助手 —— 后端服务
 * 技术栈：Express + SQLite(sql.js, WASM 版，零原生编译)
 *
 * 按 PPT 要求：先写后端，再按后端数据模型设计数据库 Schema。
 * 四大功能：Todo List / 记账 / 日程 / 日记
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const aiBriefing = require('./ai');

// ---------------------------------------------------------------------------
// 1. 数据库初始化（含 Schema 设计）
// ---------------------------------------------------------------------------
const DB_PATH = process.env.DB_PATH
  || path.join(__dirname, '..', 'data', 'life-assistant.db');

function ensureDir(p) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function setupDatabase() {
  const SQL = await initSqlJs();
  ensureDir(DB_PATH);

  let db;
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }
  // 每次都执行一次（全部是 IF NOT EXISTS），保证老库也能平滑升级出新表
  createSchema(db);
  persist(db);
  return db;
}

function createSchema(db) {
  db.run(`
    -- Todo List
    CREATE TABLE IF NOT EXISTS todos (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT    NOT NULL,
      done        INTEGER NOT NULL DEFAULT 0,   -- 0 未完成 / 1 已完成
      priority    TEXT    NOT NULL DEFAULT '中', -- 高 / 中 / 低
      due_date    TEXT,                          -- 截止日期 YYYY-MM-DD
      created_at  TEXT    NOT NULL,
      updated_at  TEXT    NOT NULL
    );

    -- 记账：支持支出与收入
    CREATE TABLE IF NOT EXISTS expenses (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      amount      REAL    NOT NULL,
      type        TEXT    NOT NULL DEFAULT '支出', -- 支出 / 收入
      category    TEXT    NOT NULL DEFAULT '其他',
      note        TEXT,
      date        TEXT    NOT NULL,               -- 发生日期 YYYY-MM-DD
      created_at  TEXT    NOT NULL
    );

    -- 日程
    CREATE TABLE IF NOT EXISTS schedules (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT    NOT NULL,
      location    TEXT,
      start_time  TEXT    NOT NULL,               -- YYYY-MM-DD HH:mm
      end_time    TEXT,
      note        TEXT,
      created_at  TEXT    NOT NULL
    );

    -- 日记
    CREATE TABLE IF NOT EXISTS journals (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT    NOT NULL,
      content     TEXT,
      mood        TEXT    NOT NULL DEFAULT '平静', -- 开心 / 平静 / 低落 / 愤怒 ...
      date        TEXT    NOT NULL,               -- YYYY-MM-DD
      created_at  TEXT    NOT NULL
    );

    /* ===================== Life Dashboard ===================== */

    -- 睡眠记录（每天一条，date 为起床当天）
    CREATE TABLE IF NOT EXISTS sleep_records (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      date          TEXT    NOT NULL,                 -- YYYY-MM-DD（起床日）
      bedtime       TEXT    NOT NULL,                 -- HH:mm
      wake_time     TEXT    NOT NULL,                 -- HH:mm
      duration_min  INTEGER NOT NULL DEFAULT 0,       -- 自动计算，跨午夜按 +24h 处理
      quality       TEXT    NOT NULL DEFAULT 'Good',  -- Excellent / Good / Average / Poor
      note          TEXT,
      created_at    TEXT    NOT NULL,
      updated_at    TEXT    NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sleep_date ON sleep_records(date);

    -- 运动记录（一天可多条）
    CREATE TABLE IF NOT EXISTS exercise_records (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      date          TEXT    NOT NULL,
      type          TEXT    NOT NULL DEFAULT 'Other',
      duration_min  INTEGER NOT NULL DEFAULT 0,
      intensity     TEXT    NOT NULL DEFAULT 'Medium', -- Low / Medium / High
      note          TEXT,
      created_at    TEXT    NOT NULL,
      updated_at    TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_exercise_date ON exercise_records(date);

    -- 饮水记录（一天可多条，每条一次摄入事件）
    CREATE TABLE IF NOT EXISTS water_records (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      date        TEXT    NOT NULL,
      amount_ml   INTEGER NOT NULL DEFAULT 0,
      time        TEXT,                               -- HH:mm
      created_at  TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_water_date ON water_records(date);

    -- 心情记录（一天可多条）
    CREATE TABLE IF NOT EXISTS mood_records (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      date        TEXT    NOT NULL,
      time        TEXT,
      mood        TEXT    NOT NULL DEFAULT 'neutral', -- very_happy / happy / neutral / sad / stressed / tired
      note        TEXT,
      tags        TEXT,                               -- 逗号分隔
      created_at  TEXT    NOT NULL,
      updated_at  TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mood_date ON mood_records(date);

    -- 精力等级（每天一条，1-5）
    CREATE TABLE IF NOT EXISTS energy_records (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      date        TEXT    NOT NULL,
      level       INTEGER NOT NULL DEFAULT 3,
      note        TEXT,
      created_at  TEXT    NOT NULL,
      updated_at  TEXT    NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_energy_date ON energy_records(date);

    -- 生活模块设置（饮水目标等）
    CREATE TABLE IF NOT EXISTS lifestyle_settings (
      skey   TEXT PRIMARY KEY,
      value  TEXT NOT NULL
    );

    /* ===================== AI Daily Briefing ===================== */

    -- AI 报告（每次生成都新增一行，绝不覆盖历史）
    CREATE TABLE IF NOT EXISTS ai_reports (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      type          TEXT    NOT NULL,              -- daily / weekly / monthly
      period_from   TEXT    NOT NULL,
      period_to     TEXT    NOT NULL,
      generated_at  TEXT    NOT NULL,
      source        TEXT    NOT NULL DEFAULT 'local', -- ai / local / local-fallback
      title         TEXT,
      headline      TEXT,
      payload       TEXT    NOT NULL,              -- 结构化报告 JSON
      created_at    TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ai_reports_type ON ai_reports(type, period_from, period_to);
    CREATE INDEX IF NOT EXISTS idx_ai_reports_generated ON ai_reports(generated_at);

    -- AI 设置（数据源开关 / 日记分析 / 货币 / 自动生成）
    CREATE TABLE IF NOT EXISTS ai_settings (
      skey   TEXT PRIMARY KEY,
      value  TEXT NOT NULL
    );
  `);
}

// 将内存中的 SQLite 落盘（sql.js 是内存库，需手动导出）
function persist(db) {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// 通用查询助手
function run(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.run(params);
  stmt.free();
  persist(db);
}

function all(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function get(db, sql, params = []) {
  const rows = all(db, sql, params);
  return rows[0] || null;
}

function nowStr() {
  return new Date().toISOString();
}

/* ---------- 日期 / 时间助手（一律按本地日历，避免时区漂移） ---------- */
function pad2(n) { return String(n).padStart(2, '0'); }

function localDateStr(d) {
  const x = d || new Date();
  return x.getFullYear() + '-' + pad2(x.getMonth() + 1) + '-' + pad2(x.getDate());
}

function localTimeStr(d) {
  const x = d || new Date();
  return pad2(x.getHours()) + ':' + pad2(x.getMinutes());
}

function addDaysStr(dateStr, n) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return localDateStr(dt);
}

function isValidDateStr(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function isValidTimeStr(s) {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

/** 睡眠时长（分钟）：起床时间 <= 入睡时间时视为跨午夜，+24h */
function sleepMinutes(bedtime, wakeTime) {
  if (!isValidTimeStr(bedtime) || !isValidTimeStr(wakeTime)) return 0;
  const [bh, bm] = bedtime.split(':').map(Number);
  const [wh, wm] = wakeTime.split(':').map(Number);
  const bed = bh * 60 + bm;
  const wake = wh * 60 + wm;
  if (wake === bed) return 0;
  return wake > bed ? wake - bed : wake + 1440 - bed;
}

function clampInt(v, min, max, fallback) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const SLEEP_QUALITIES = ['Excellent', 'Good', 'Average', 'Poor'];
const EXERCISE_TYPES = ['Walking', 'Running', 'Cycling', 'Gym', 'Swimming', 'Yoga', 'Sports', 'Other'];
const EXERCISE_INTENSITY = ['Low', 'Medium', 'High'];
const MOOD_KEYS = ['very_happy', 'happy', 'neutral', 'sad', 'stressed', 'tired'];
const MOOD_SCORE = { very_happy: 5, happy: 4, neutral: 3, sad: 2, stressed: 2, tired: 1 };

// ---------------------------------------------------------------------------
// 2. 启动服务
// ---------------------------------------------------------------------------
async function startServer() {
  const db = await setupDatabase();
  const app = express();
  app.use(express.json());

  // 托管前端静态资源（Vue 构建产物）
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // 直接从 node_modules 提供 Vue 全局构建（免复制、免构建步骤）
  app.use('/vendor', express.static(
    path.join(__dirname, '..', 'node_modules', 'vue', 'dist')));

  // 提供 Three.js 构建产物（3D 机器人伴侣）
  app.use('/vendor/three', express.static(
    path.join(__dirname, '..', 'node_modules', 'three', 'build')));

  // 字段默认值（未传时兜底，避免 undefined 绑定报错）
  function defaultFor(field) {
    if (field === 'done') return 0;
    if (field === 'priority') return '中';
    if (field === 'type') return '支出';
    if (field === 'mood') return '平静';
    if (field === 'category') return '其他';
    return '';
  }

  // 生活模块设置
  function getSetting(key, fallback) {
    const row = get(db, 'SELECT value FROM lifestyle_settings WHERE skey = ?', [key]);
    return row ? row.value : fallback;
  }
  function setSetting(key, value) {
    const exist = get(db, 'SELECT skey FROM lifestyle_settings WHERE skey = ?', [key]);
    if (exist) run(db, 'UPDATE lifestyle_settings SET value = ? WHERE skey = ?', [String(value), key]);
    else run(db, 'INSERT INTO lifestyle_settings (skey, value) VALUES (?, ?)', [key, String(value)]);
  }

  // 简单的 CRUD 工厂，避免重复代码
  // opts: { dateField, orderBy, upsertOn, beforeWrite, afterRead }
  function registerCrud(resource, table, writableFields, requiredFields, opts) {
    const o = opts || {};
    const hasUpdated = writableFields.includes('updated_at');
    const hasCreated = writableFields.includes('created_at');

    // 列表（支持 ?date= / ?from= / ?to= / ?limit=）
    app.get(`/api/${resource}`, (req, res) => {
      const where = [];
      const params = [];
      if (o.dateField) {
        if (req.query.date) { where.push(`${o.dateField} = ?`); params.push(req.query.date); }
        if (req.query.from) { where.push(`${o.dateField} >= ?`); params.push(req.query.from); }
        if (req.query.to) { where.push(`${o.dateField} <= ?`); params.push(req.query.to); }
      }
      let sql = `SELECT * FROM ${table}`;
      if (where.length) sql += ' WHERE ' + where.join(' AND ');
      sql += ' ORDER BY ' + (o.orderBy || 'id DESC');
      const limit = Number(req.query.limit);
      if (Number.isFinite(limit) && limit > 0) sql += ` LIMIT ${Math.min(limit, 500)}`;
      res.json(all(db, sql, params));
    });

    // 单条
    app.get(`/api/${resource}/:id`, (req, res) => {
      const row = get(db, `SELECT * FROM ${table} WHERE id = ?`, [req.params.id]);
      if (!row) return res.status(404).json({ error: 'not found' });
      res.json(row);
    });

    function validate(body) {
      for (const f of requiredFields) {
        if (body[f] === undefined || body[f] === '') return `字段 ${f} 必填`;
      }
      if (o.beforeWrite) return o.beforeWrite(body);
      return null;
    }

    // 新增（upsertOn 命中已存在记录时转为更新，避免同日重复）
    app.post(`/api/${resource}`, (req, res) => {
      const body = Object.assign({}, req.body || {});
      const err = validate(body);
      if (err) return res.status(400).json({ error: err });

      const ts = nowStr();
      if (o.upsertOn && body[o.upsertOn] !== undefined && body[o.upsertOn] !== '') {
        const exist = get(db, `SELECT * FROM ${table} WHERE ${o.upsertOn} = ?`, [body[o.upsertOn]]);
        if (exist) {
          const cols = writableFields.filter((c) => body[c] !== undefined && c !== 'updated_at');
          if (hasUpdated) cols.push('updated_at');
          if (cols.length) {
            const sets = cols.map((c) => `${c} = ?`).join(', ');
            const values = cols.map((c) => (c === 'updated_at' ? ts : body[c]));
            values.push(exist.id);
            run(db, `UPDATE ${table} SET ${sets} WHERE id = ?`, values);
          }
          return res.json(get(db, `SELECT * FROM ${table} WHERE id = ?`, [exist.id]));
        }
      }

      const cols = [...writableFields];
      const values = cols.map((c) => (body[c] === undefined ? defaultFor(c) : body[c]));
      if (!hasCreated) { cols.push('created_at'); values.push(ts); }
      if (hasUpdated) {
        const i = cols.indexOf('updated_at');
        if (i === -1) { cols.push('updated_at'); values.push(ts); }
        else values[i] = ts;
      }
      const placeholders = cols.map(() => '?').join(', ');
      run(db,
        `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`,
        values);
      const id = get(db, 'SELECT last_insert_rowid() AS id').id;
      res.status(201).json(get(db, `SELECT * FROM ${table} WHERE id = ?`, [id]));
    });

    // 更新
    app.put(`/api/${resource}/:id`, (req, res) => {
      const body = Object.assign({}, req.body || {});
      if (o.beforeWrite) {
        const err = o.beforeWrite(body);
        if (err) return res.status(400).json({ error: err });
      }
      const cols = writableFields.filter((c) => body[c] !== undefined && c !== 'updated_at');
      const ts = nowStr();
      if (hasUpdated) cols.push('updated_at');
      if (cols.length === 0) return res.status(400).json({ error: '无更新字段' });
      const sets = cols.map((c) => `${c} = ?`).join(', ');
      const values = cols.map((c) => (c === 'updated_at' ? ts : body[c]));
      values.push(req.params.id);
      run(db, `UPDATE ${table} SET ${sets} WHERE id = ?`, values);
      res.json(get(db, `SELECT * FROM ${table} WHERE id = ?`, [req.params.id]));
    });

    // 删除
    app.delete(`/api/${resource}/:id`, (req, res) => {
      run(db, `DELETE FROM ${table} WHERE id = ?`, [req.params.id]);
      res.json({ ok: true });
    });
  }

  // 注册四个功能的 CRUD
  registerCrud('todos', 'todos',
    ['title', 'done', 'priority', 'due_date', 'updated_at'],
    ['title']);
  registerCrud('expenses', 'expenses',
    ['amount', 'type', 'category', 'note', 'date'],
    ['amount', 'date']);
  registerCrud('schedules', 'schedules',
    ['title', 'location', 'start_time', 'end_time', 'note'],
    ['title', 'start_time']);
  registerCrud('journals', 'journals',
    ['title', 'content', 'mood', 'date'],
    ['title', 'date']);

  /* ---------------- Life Dashboard 聚合接口 ---------------- */

  function dateRange(from, to) {
    const out = [];
    let cur = from;
    let guard = 0;
    while (cur <= to && guard++ < 400) { out.push(cur); cur = addDaysStr(cur, 1); }
    return out;
  }

  // 某一天的完整生活数据
  app.get('/api/life/daily', (req, res) => {
    const date = isValidDateStr(req.query.date) ? req.query.date : localDateStr();
    const sleep = get(db, 'SELECT * FROM sleep_records WHERE date = ?', [date]);
    const energy = get(db, 'SELECT * FROM energy_records WHERE date = ?', [date]);
    const exercise = all(db, 'SELECT * FROM exercise_records WHERE date = ? ORDER BY id DESC', [date]);
    const water = all(db, 'SELECT * FROM water_records WHERE date = ? ORDER BY id ASC', [date]);
    const moods = all(db, 'SELECT * FROM mood_records WHERE date = ? ORDER BY id DESC', [date]);
    const goal = clampInt(getSetting('water_goal', 2000), 100, 10000, 2000);
    res.json({
      date,
      sleep: sleep || null,
      energy: energy || null,
      exercise,
      water,
      moods,
      waterTotal: water.reduce((s, r) => s + Number(r.amount_ml || 0), 0),
      exerciseTotal: exercise.reduce((s, r) => s + Number(r.duration_min || 0), 0),
      waterGoal: goal,
    });
  });

  // 区间统计（周 / 月 / 自定义）
  app.get('/api/life/summary', (req, res) => {
    const days = clampInt(req.query.days || 7, 1, 366, 7);
    const to = isValidDateStr(req.query.to) ? req.query.to : localDateStr();
    const from = isValidDateStr(req.query.from) ? req.query.from : addDaysStr(to, -(days - 1));
    const dates = dateRange(from, to);
    const goal = clampInt(getSetting('water_goal', 2000), 100, 10000, 2000);

    const sleeps = all(db,
      'SELECT date, duration_min, quality FROM sleep_records WHERE date >= ? AND date <= ?', [from, to]);
    const exercises = all(db,
      'SELECT date, duration_min, type FROM exercise_records WHERE date >= ? AND date <= ?', [from, to]);
    const waters = all(db,
      'SELECT date, amount_ml FROM water_records WHERE date >= ? AND date <= ?', [from, to]);
    const moods = all(db,
      'SELECT date, mood FROM mood_records WHERE date >= ? AND date <= ?', [from, to]);
    const energies = all(db,
      'SELECT date, level FROM energy_records WHERE date >= ? AND date <= ?', [from, to]);

    const sleepByDate = {};
    for (const r of sleeps) sleepByDate[r.date] = r;
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

    const sleepSeries = dates.map((d) => ({
      date: d,
      minutes: sleepByDate[d] ? Number(sleepByDate[d].duration_min || 0) : 0,
      quality: sleepByDate[d] ? sleepByDate[d].quality : null,
    }));
    const exerciseSeries = dates.map((d) => ({ date: d, minutes: exByDate[d] || 0 }));
    const waterSeries = dates.map((d) => ({ date: d, ml: waterByDate[d] || 0 }));
    const energySeries = dates.map((d) => ({ date: d, level: energyByDate[d] || 0 }));
    const moodSeries = dates.map((d) => {
      const arr = moodByDate[d] || [];
      return { date: d, score: arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : 0 };
    });

    const sleepCount = sleeps.length;
    const sleepAvg = sleepCount ? Math.round(sleeps.reduce((s, r) => s + Number(r.duration_min || 0), 0) / sleepCount) : 0;
    const sleepDist = { Excellent: 0, Good: 0, Average: 0, Poor: 0 };
    for (const r of sleeps) if (sleepDist[r.quality] !== undefined) sleepDist[r.quality] += 1;

    const exTotal = exercises.reduce((s, r) => s + Number(r.duration_min || 0), 0);
    const activeDays = Object.keys(exByDate).length;
    const byTypeMap = {};
    for (const r of exercises) byTypeMap[r.type] = (byTypeMap[r.type] || 0) + Number(r.duration_min || 0);
    const byType = Object.keys(byTypeMap)
      .map((t) => ({ type: t, minutes: byTypeMap[t] }))
      .sort((a, b) => b.minutes - a.minutes);

    const waterTotal = waters.reduce((s, r) => s + Number(r.amount_ml || 0), 0);
    const daysWithWater = Object.keys(waterByDate).length;
    const goalDays = Object.keys(waterByDate).filter((d) => waterByDate[d] >= goal).length;

    const energyCount = energies.length;
    const energyAvg = energyCount
      ? Math.round((energies.reduce((s, r) => s + Number(r.level || 0), 0) / energyCount) * 10) / 10 : 0;

    res.json({
      range: { from, to, days: dates.length },
      waterGoal: goal,
      sleep: {
        count: sleepCount,
        avgMin: sleepAvg,
        series: sleepSeries,
        distribution: sleepDist,
      },
      exercise: {
        count: exercises.length,
        totalMin: exTotal,
        activeDays,
        avgMinPerActiveDay: activeDays ? Math.round(exTotal / activeDays) : 0,
        series: exerciseSeries,
        byType,
      },
      water: {
        totalMl: waterTotal,
        avgMl: daysWithWater ? Math.round(waterTotal / daysWithWater) : 0,
        daysWithWater,
        goalDays,
        goalRate: daysWithWater ? Math.round((goalDays / daysWithWater) * 100) : 0,
        series: waterSeries,
      },
      mood: {
        total: moods.length,
        counts: moodCounts,
        avgScore: moods.length ? Math.round((moodScoreSum / moods.length) * 10) / 10 : 0,
        series: moodSeries,
      },
      energy: {
        count: energyCount,
        avg: energyAvg,
        series: energySeries,
      },
    });
  });

  // 生活模块设置
  function settingsPayload() {
    return {
      waterGoal: clampInt(getSetting('water_goal', 2000), 100, 10000, 2000),
    };
  }

  app.get('/api/life/settings', (req, res) => res.json(settingsPayload()));

  app.put('/api/life/settings', (req, res) => {
    const b = req.body || {};
    if (b.waterGoal !== undefined) {
      const g = Number(b.waterGoal);
      if (!Number.isFinite(g) || g < 100 || g > 10000) {
        return res.status(400).json({ error: '饮水目标需在 100-10000 ml 之间' });
      }
      setSetting('water_goal', Math.round(g));
    }
    res.json(settingsPayload());
  });

  // 撤销最近一次饮水记录（可指定日期）
  app.post('/api/water/undo', (req, res) => {
    const date = req.body && req.body.date;
    const row = isValidDateStr(date)
      ? get(db, 'SELECT * FROM water_records WHERE date = ? ORDER BY id DESC LIMIT 1', [date])
      : get(db, 'SELECT * FROM water_records ORDER BY id DESC LIMIT 1');
    if (!row) return res.status(404).json({ error: '没有可撤销的饮水记录' });
    run(db, 'DELETE FROM water_records WHERE id = ?', [row.id]);
    res.json({ ok: true, removed: row });
  });

  // 睡眠：每天一条（upsertOn=date），时长由后端按跨午夜规则计算
  registerCrud('sleep', 'sleep_records',
    ['date', 'bedtime', 'wake_time', 'duration_min', 'quality', 'note', 'updated_at'],
    ['date', 'bedtime', 'wake_time'],
    {
      dateField: 'date', orderBy: 'date DESC', upsertOn: 'date',
      beforeWrite(body) {
        if (body.date !== undefined && !isValidDateStr(body.date)) return '日期格式应为 YYYY-MM-DD';
        if (body.bedtime !== undefined && !isValidTimeStr(body.bedtime)) return '入睡时间格式应为 HH:mm';
        if (body.wake_time !== undefined && !isValidTimeStr(body.wake_time)) return '起床时间格式应为 HH:mm';
        if (body.quality !== undefined && !SLEEP_QUALITIES.includes(body.quality)) return '睡眠质量取值非法';
        if (body.bedtime !== undefined && body.wake_time !== undefined) {
          body.duration_min = sleepMinutes(body.bedtime, body.wake_time);
        }
        return null;
      },
    });

  // 运动
  registerCrud('exercise', 'exercise_records',
    ['date', 'type', 'duration_min', 'intensity', 'note', 'updated_at'],
    ['date', 'type', 'duration_min'],
    {
      dateField: 'date', orderBy: 'date DESC, id DESC',
      beforeWrite(body) {
        if (body.date !== undefined && !isValidDateStr(body.date)) return '日期格式应为 YYYY-MM-DD';
        if (body.type !== undefined && !EXERCISE_TYPES.includes(body.type)) return '运动类型取值非法';
        if (body.intensity !== undefined && !EXERCISE_INTENSITY.includes(body.intensity)) return '运动强度取值非法';
        if (body.duration_min !== undefined) {
          const d = Number(body.duration_min);
          if (!Number.isFinite(d) || d <= 0 || d > 1440) return '时长需在 1-1440 分钟之间';
          body.duration_min = Math.round(d);
        }
        return null;
      },
    });

  // 饮水
  registerCrud('water', 'water_records',
    ['date', 'amount_ml', 'time'],
    ['date', 'amount_ml'],
    {
      dateField: 'date', orderBy: 'date DESC, id DESC',
      beforeWrite(body) {
        if (body.date !== undefined && !isValidDateStr(body.date)) return '日期格式应为 YYYY-MM-DD';
        if (body.time !== undefined && body.time !== '' && !isValidTimeStr(body.time)) return '时间格式应为 HH:mm';
        if (body.amount_ml !== undefined) {
          const a = Number(body.amount_ml);
          if (!Number.isFinite(a) || a <= 0 || a > 5000) return '水量需在 1-5000 ml 之间';
          body.amount_ml = Math.round(a);
        }
        return null;
      },
    });

  // 心情（一天可多条）
  registerCrud('mood', 'mood_records',
    ['date', 'time', 'mood', 'note', 'tags', 'updated_at'],
    ['date', 'mood'],
    {
      dateField: 'date', orderBy: 'date DESC, id DESC',
      beforeWrite(body) {
        if (body.date !== undefined && !isValidDateStr(body.date)) return '日期格式应为 YYYY-MM-DD';
        if (body.time !== undefined && body.time !== '' && !isValidTimeStr(body.time)) return '时间格式应为 HH:mm';
        if (body.mood !== undefined && !MOOD_KEYS.includes(body.mood)) return '心情取值非法';
        return null;
      },
    });

  // 精力：每天一条（upsertOn=date）
  registerCrud('energy', 'energy_records',
    ['date', 'level', 'note', 'updated_at'],
    ['date', 'level'],
    {
      dateField: 'date', orderBy: 'date DESC', upsertOn: 'date',
      beforeWrite(body) {
        if (body.date !== undefined && !isValidDateStr(body.date)) return '日期格式应为 YYYY-MM-DD';
        if (body.level !== undefined) {
          const l = Number(body.level);
          if (!Number.isFinite(l) || l < 1 || l > 5) return '精力等级需在 1-5 之间';
          body.level = Math.round(l);
        }
        return null;
      },
    });

  // 额外：Todo 完成状态快捷切换
  app.patch('/api/todos/:id/toggle', (req, res) => {
    const row = get(db, 'SELECT done FROM todos WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'not found' });
    const next = row.done ? 0 : 1;
    run(db, 'UPDATE todos SET done = ?, updated_at = ? WHERE id = ?',
      [next, nowStr(), req.params.id]);
    res.json(get(db, 'SELECT * FROM todos WHERE id = ?', [req.params.id]));
  });

  // 汇总统计（首页仪表盘用）
  app.get('/api/stats', (req, res) => {
    const todoTotal = get(db, 'SELECT COUNT(*) AS c FROM todos').c;
    const todoDone = get(db, 'SELECT COUNT(*) AS c FROM todos WHERE done = 1').c;
    const expense = get(db,
      "SELECT COALESCE(SUM(amount),0) AS s FROM expenses WHERE type='支出'").s;
    const income = get(db,
      "SELECT COALESCE(SUM(amount),0) AS s FROM expenses WHERE type='收入'").s;
    const scheduleToday = get(db,
      "SELECT COUNT(*) AS c FROM schedules WHERE date(start_time) = date('now','localtime')").c;
    const journalTotal = get(db, 'SELECT COUNT(*) AS c FROM journals').c;

    // 生活模块的首页摘要（只放三项，避免首页信息过载）
    const today = localDateStr();
    const yesterday = addDaysStr(today, -1);
    const sleepRow = get(db, 'SELECT duration_min FROM sleep_records WHERE date = ?', [today])
      || get(db, 'SELECT duration_min FROM sleep_records WHERE date = ?', [yesterday]);
    const waterToday = get(db,
      'SELECT COALESCE(SUM(amount_ml),0) AS s FROM water_records WHERE date = ?', [today]).s;
    const exerciseToday = get(db,
      'SELECT COALESCE(SUM(duration_min),0) AS s FROM exercise_records WHERE date = ?', [today]).s;
    const energyToday = get(db, 'SELECT level FROM energy_records WHERE date = ?', [today]);
    const moodToday = get(db,
      'SELECT mood FROM mood_records WHERE date = ? ORDER BY id DESC LIMIT 1', [today]);

    res.json({
      todoTotal, todoDone,
      expense: Math.round(expense * 100) / 100,
      income: Math.round(income * 100) / 100,
      balance: Math.round((income - expense) * 100) / 100,
      scheduleToday, journalTotal,
      life: {
        sleepMin: sleepRow ? Number(sleepRow.duration_min || 0) : null,
        waterMl: Number(waterToday || 0),
        waterGoal: clampInt(getSetting('water_goal', 2000), 100, 10000, 2000),
        exerciseMin: Number(exerciseToday || 0),
        energy: energyToday ? Number(energyToday.level) : null,
        mood: moodToday ? moodToday.mood : null,
      },
    });
  });

  /* ---------------- AI Daily Briefing 路由 ---------------- */
  aiBriefing.register(app, {
    db, all, get, run,
    nowStr,
    localDateStr, localTimeStr, addDaysStr, isValidDateStr, isValidTimeStr,
    clampInt, MOOD_SCORE, getSetting, setSetting,
  });

  // 启动（端口可在环境变量覆盖）
  const PORT = process.env.PORT || 3456;
  const server = app.listen(PORT, () => {
    console.log(`[个人生活助手] 后端已启动: http://localhost:${PORT}`);
  });

  // 暴露给 Electron 主进程复用
  return { app, server, db };
}

// 既可作为独立 Web 服务运行，也可被 Electron 主进程 require
if (require.main === module) {
  startServer().catch((e) => {
    console.error('启动失败:', e);
    process.exit(1);
  });
}

module.exports = { startServer };
