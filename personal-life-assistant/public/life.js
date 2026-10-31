/* =========================================================
   Life Dashboard · 生活状态管理模块
   睡眠 / 运动 / 饮水 / 心情 / 精力 / 统计
   依赖：core.js（pad / todayLocal / addDays / api）
   ========================================================= */

/* ---------- 枚举（存英文键，显示中文，避免编码与校验歧义） ---------- */
const LIFE_TABS = [
  { key: 'overview', label: '概览' },
  { key: 'sleep', label: '睡眠' },
  { key: 'exercise', label: '运动' },
  { key: 'water', label: '饮水' },
  { key: 'mood', label: '心情' },
  { key: 'energy', label: '精力' },
  { key: 'stats', label: '统计' },
];

let lifeHashHandler = null;

const MOODS = [
  { key: 'very_happy', emoji: '😄', label: '非常开心', color: '#34d399', score: 5 },
  { key: 'happy', emoji: '🙂', label: '开心', color: '#22d3ee', score: 4 },
  { key: 'neutral', emoji: '😐', label: '平静', color: '#8b98b8', score: 3 },
  { key: 'sad', emoji: '😔', label: '难过', color: '#60a5fa', score: 2 },
  { key: 'stressed', emoji: '😰', label: '压力大', color: '#fbbf24', score: 2 },
  { key: 'tired', emoji: '😴', label: '疲惫', color: '#a78bfa', score: 1 },
];
const MOOD_MAP = {};
MOODS.forEach((m) => { MOOD_MAP[m.key] = m; });

const EX_TYPES = [
  { key: 'Walking', label: '步行', emoji: '🚶' },
  { key: 'Running', label: '跑步', emoji: '🏃' },
  { key: 'Cycling', label: '骑行', emoji: '🚴' },
  { key: 'Gym', label: '健身', emoji: '🏋️' },
  { key: 'Swimming', label: '游泳', emoji: '🏊' },
  { key: 'Yoga', label: '瑜伽', emoji: '🧘' },
  { key: 'Sports', label: '球类运动', emoji: '🏀' },
  { key: 'Other', label: '其他', emoji: '✨' },
];
const EX_MAP = {};
EX_TYPES.forEach((t) => { EX_MAP[t.key] = t; });

const INTENSITIES = [
  { key: 'Low', label: '低强度' },
  { key: 'Medium', label: '中等强度' },
  { key: 'High', label: '高强度' },
];
const INTENSITY_MAP = {};
INTENSITIES.forEach((t) => { INTENSITY_MAP[t.key] = t; });

const QUALITIES = [
  { key: 'Excellent', label: '优秀' },
  { key: 'Good', label: '良好' },
  { key: 'Average', label: '一般' },
  { key: 'Poor', label: '较差' },
];
const QUALITY_MAP = {};
QUALITIES.forEach((t) => { QUALITY_MAP[t.key] = t; });

const ENERGY_LEVELS = [
  { level: 1, label: '极低' },
  { level: 2, label: '偏低' },
  { level: 3, label: '一般' },
  { level: 4, label: '充沛' },
  { level: 5, label: '极高' },
];

const QUICK_WATER = [150, 250, 350, 500];

/* ---------- 格式化 ---------- */
function fmtDuration(min) {
  const m = Math.round(Number(min) || 0);
  if (m <= 0) return '0m';
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return r + 'm';
  return r ? h + 'h ' + r + 'm' : h + 'h';
}

function fmtDateCN(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const wd = ['日', '一', '二', '三', '四', '五', '六'][new Date(y, m - 1, d).getDay()];
  return m + '月' + d + '日 · 周' + wd;
}

function shortMD(dateStr) {
  return dateStr ? dateStr.slice(5) : '';
}

/* =========================================================
   图表组件（纯 SVG / CSS，无第三方依赖）
   ========================================================= */

const LifeBarChart = {
  name: 'LifeBarChart',
  props: {
    data: { type: Array, default: () => [] },
    unit: { type: String, default: '' },
    goal: { type: Number, default: 0 },
    color: { type: String, default: 'var(--accent-1)' },
  },
  computed: {
    max() {
      const vals = this.data.map((d) => Number(d.value) || 0);
      return Math.max.apply(null, vals.concat([this.goal || 0, 1]));
    },
    hasData() { return this.data.some((d) => Number(d.value) > 0); },
  },
  methods: {
    heightPct(v) {
      const n = Number(v) || 0;
      if (n <= 0) return 0;
      return Math.max(6, Math.round((n / this.max) * 100));
    },
    tip(d) { return d.date + '：' + d.value + this.unit; },
  },
  template: `
  <div class="chart-wrap">
    <div class="chart-bars" :class="{empty: !hasData}">
      <div class="chart-col" v-for="(d, i) in data" :key="i" :title="tip(d)">
        <div class="chart-track">
          <i :style="{ height: heightPct(d.value) + '%', background: color }"></i>
        </div>
        <span class="chart-x">{{ d.label }}</span>
      </div>
    </div>
    <p v-if="!hasData" class="chart-empty">该区间暂无记录</p>
  </div>`,
};

const LifeLineChart = {
  name: 'LifeLineChart',
  props: {
    data: { type: Array, default: () => [] },
    unit: { type: String, default: '' },
    color: { type: String, default: 'var(--accent-1)' },
    min: { type: Number, default: 0 },
    max: { type: Number, default: 0 },
  },
  computed: {
    points() { return this.data.filter((d) => Number(d.value) > 0); },
    hasData() { return this.points.length >= 2; },
    bounds() {
      const vals = this.points.map((d) => Number(d.value));
      let lo = this.min || Math.min.apply(null, vals);
      let hi = this.max || Math.max.apply(null, vals);
      if (!Number.isFinite(lo)) lo = 0;
      if (!Number.isFinite(hi) || hi <= lo) hi = lo + 1;
      return { lo, hi };
    },
    coords() {
      const n = this.points.length;
      const { lo, hi } = this.bounds;
      return this.points.map((d, i) => {
        const x = n === 1 ? 50 : (i / (n - 1)) * 100;
        const y = 38 - ((Number(d.value) - lo) / (hi - lo)) * 34;
        return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, d };
      });
    },
    polyline() { return this.coords.map((c) => c.x + ',' + c.y).join(' '); },
    areaPath() {
      if (!this.coords.length) return '';
      const first = this.coords[0];
      const last = this.coords[this.coords.length - 1];
      return 'M' + first.x + ',40 L' + this.polyline.replace(/ /g, ' L') + ' L' + last.x + ',40 Z';
    },
    peak() { return Math.max.apply(null, this.points.map((d) => Number(d.value))); },
    low() { return Math.min.apply(null, this.points.map((d) => Number(d.value))); },
  },
  template: `
  <div class="chart-wrap">
    <svg class="chart-svg" viewBox="0 0 100 40" preserveAspectRatio="none" v-if="hasData">
      <polygon :points="polyline + ' ' + coords[coords.length-1].x + ',40 ' + coords[0].x + ',40'"
               :fill="color" opacity=".12" />
      <polyline :points="polyline" fill="none" :stroke="color" stroke-width="1.6"
                stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
    </svg>
    <p v-else class="chart-empty">至少需要 2 天记录才能绘制趋势</p>
    <div class="chart-foot" v-if="hasData">
      <span>最低 {{ low }}{{ unit }}</span>
      <span>最高 {{ peak }}{{ unit }}</span>
    </div>
  </div>`,
};

const LifeRing = {
  name: 'LifeRing',
  props: {
    value: { type: Number, default: 0 },
    max: { type: Number, default: 1 },
    color: { type: String, default: 'var(--accent-1)' },
  },
  computed: {
    pct() { return this.max > 0 ? Math.min(1, this.value / this.max) : 0; },
    dash() {
      const c = 2 * Math.PI * 46;
      return Math.round(this.pct * c * 100) / 100 + ' ' + Math.round(c * 100) / 100;
    },
    circumference() { return Math.round(2 * Math.PI * 46 * 100) / 100; },
  },
  template: `
  <svg class="ring" viewBox="0 0 110 110">
    <circle cx="55" cy="55" r="46" class="ring-bg" />
    <circle cx="55" cy="55" r="46" class="ring-fg" :stroke="color"
            :stroke-dasharray="dash" :stroke-dashoffset="0" transform="rotate(-90 55 55)" />
    <slot></slot>
  </svg>`,
};

/* =========================================================
   主组件
   ========================================================= */
const LifeDashboard = {
  name: 'life',
  template: '#tpl-life',
  components: {
    LifeBarChart, LifeLineChart, LifeRing,
  },
  data() {
    const t = todayLocal();
    return {
      tabs: LIFE_TABS,
      moods: MOODS,
      moodMap: MOOD_MAP,
      exTypes: EX_TYPES,
      exMap: EX_MAP,
      intensities: INTENSITIES,
      intensityMap: INTENSITY_MAP,
      qualities: QUALITIES,
      qualityMap: QUALITY_MAP,
      energyLevels: ENERGY_LEVELS,
      quickWater: QUICK_WATER,
      today: t,
      date: t,
      tab: 'overview',
      loading: false,
      err: '',

      day: {
        sleep: null, energy: null, exercise: [], water: [], moods: [],
        waterTotal: 0, exerciseTotal: 0, waterGoal: 2000,
      },
      settings: { waterGoal: 2000 },
      goalInput: 2000,

      sums: { 7: null, 30: null, 90: null, month: null },
      range: 7,

      hist: { sleep: [], exercise: [], mood: [], energy: [], water: [] },
      monthMoods: [],

      sleepForm: { bedtime: '23:00', wake_time: '07:00', quality: 'Good', note: '' },
      exForm: { type: 'Walking', duration_min: '', intensity: 'Medium', note: '' },
      waterCustom: '',
      moodForm: { mood: 'neutral', note: '', tags: '' },
      energyForm: { level: 3, note: '' },

      editing: null, // { type, id, form }
    };
  },

  computed: {
    isToday() { return this.date === this.today; },
    dateLabel() { return fmtDateCN(this.date); },

    sleepMin() { return this.day.sleep ? Number(this.day.sleep.duration_min) : 0; },
    waterPct() {
      const g = this.day.waterGoal || this.settings.waterGoal || 2000;
      return g > 0 ? Math.min(100, Math.round((this.day.waterTotal / g) * 100)) : 0;
    },
    waterGoalReached() {
      const g = this.day.waterGoal || 2000;
      return this.day.waterTotal >= g;
    },
    topMood() {
      if (!this.day.moods.length) return null;
      return MOOD_MAP[this.day.moods[0].mood] || null;
    },

    sum7() { return this.sums[7]; },
    sum30() { return this.sums[30]; },
    sumMonth() { return this.sums.month; },
    sumRange() { return this.sums[this.range] || this.sums[7]; },

    sleepBars7() { return this.barsFrom(this.sum7 && this.sum7.sleep.series, 'minutes'); },
    sleepLine30() { return this.lineFrom(this.sum30 && this.sum30.sleep.series, 'minutes'); },
    exBars7() { return this.barsFrom(this.sum7 && this.sum7.exercise.series, 'minutes'); },
    waterBars7() { return this.barsFrom(this.sum7 && this.sum7.water.series, 'ml'); },
    energyLine30() { return this.lineFrom(this.sum30 && this.sum30.energy.series, 'level'); },
    moodLine30() { return this.lineFrom(this.sum30 && this.sum30.mood.series, 'score'); },

    moodCounts() { return (this.sumRange && this.sumRange.mood.counts) || {}; },
    moodTotal() { return (this.sumRange && this.sumRange.mood.total) || 0; },

    monthBars() {
      const s = this.sumMonth;
      if (!s) return [];
      return s.sleep.series.map((d, i) => ({
        label: d.date.slice(8),
        value: d.minutes,
        date: d.date,
      }));
    },

    // 最近 14 天并列对照（只展示有记录的日期，不做因果推断）
    compareRows() {      const s = this.sums[30];
      if (!s) return [];
      const rows = [];
      for (let i = s.sleep.series.length - 1; i >= 0; i--) {
        const sd = s.sleep.series[i];
        const ed = s.exercise.series[i];
        const wd = s.water.series[i];
        const md = s.mood.series[i];
        const gd = s.energy.series[i];
        if (!sd.minutes && !ed.minutes && !wd.ml && !md.score && !gd.level) continue;
        rows.push({
          date: sd.date,
          sleep: sd.minutes,
          exercise: ed.minutes,
          water: wd.ml,
          mood: md.score,
          energy: gd.level,
        });
        if (rows.length >= 14) break;
      }
      return rows;
    },

    calendar() {
      const [y, m] = this.date.split('-').map(Number);
      const firstDay = new Date(y, m - 1, 1).getDay(); // 0=周日
      const startPad = (firstDay + 6) % 7;             // 周一为一周起点
      const daysInMonth = new Date(y, m, 0).getDate();
      const byDate = {};
      for (const r of this.monthMoods) {
        (byDate[r.date] = byDate[r.date] || []).push(r.mood);
      }
      const cells = [];
      for (let i = 0; i < startPad; i++) cells.push({ empty: true, key: 'p' + i });
      for (let d = 1; d <= daysInMonth; d++) {
        const ds = y + '-' + pad(m) + '-' + pad(d);
        const list = byDate[ds] || [];
        let mood = null;
        if (list.length) {
          const cnt = {};
          list.forEach((k) => { cnt[k] = (cnt[k] || 0) + 1; });
          mood = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0];
        }
        cells.push({ empty: false, key: ds, day: d, date: ds, mood, count: list.length });
      }
      return cells;
    },

    reportText() {
      const s = this.sumMonth;
      if (!s) return '';
      const parts = [];
      if (s.sleep.count) parts.push('本月记录了 ' + s.sleep.count + ' 天睡眠，平均 ' + fmtDuration(s.sleep.avgMin) + '。');
      else parts.push('本月还没有睡眠记录。');

      if (s.exercise.activeDays) {
        parts.push('有 ' + s.exercise.activeDays + ' 天进行运动，累计 ' + fmtDuration(s.exercise.totalMin) + '，共 ' + s.exercise.count + ' 次。');
      } else parts.push('本月还没有运动记录。');

      if (s.water.daysWithWater) {
        parts.push('饮水达标 ' + s.water.goalDays + ' 天，达标率 ' + s.water.goalRate + '%，日均 ' + s.water.avgMl + ' ml。');
      } else parts.push('本月还没有饮水记录。');

      if (s.mood.total) parts.push('心情记录 ' + s.mood.total + ' 条，平均 ' + s.mood.avgScore + ' 分（1-5）。');
      if (s.energy.count) parts.push('精力平均 ' + s.energy.avg + '/5。');
      return parts.join('');
    },
  },

  methods: {
    fmtDuration,
    shortMD,
    fmtDateCN,
    moodOf(k) { return MOOD_MAP[k] || MOOD_MAP.neutral; },
    exOf(k) { return EX_MAP[k] || EX_MAP.Other; },
    intensityOf(k) { return (INTENSITY_MAP[k] || INTENSITY_MAP.Medium).label; },
    qualityOf(k) { return (QUALITY_MAP[k] || QUALITY_MAP.Good).label; },

    pctMood(key) {
      const total = this.moodTotal || 0;
      if (!total) return 0;
      return Math.round(((this.moodCounts[key] || 0) / total) * 100);
    },
    typePct(minutes) {
      const list = (this.sumMonth && this.sumMonth.exercise.byType) || [];
      const max = list.length ? list[0].minutes : 0;
      if (!max) return 0;
      return Math.max(6, Math.round((minutes / max) * 100));
    },

    barsFrom(series, key) {
      if (!series) return [];
      const step = Math.max(1, Math.ceil(series.length / 7));
      return series.map((d, i) => ({
        label: i % step === 0 ? shortMD(d.date) : '',
        value: Number(d[key] || 0),
        date: d.date,
      }));
    },
    lineFrom(series, key) {
      if (!series) return [];
      return series.map((d) => ({ date: d.date, value: Number(d[key] || 0) }));
    },

    async reload() {
      this.loading = true;
      this.err = '';
      try {
        const day = await api.get('/api/life/daily?date=' + this.date);
        this.day = day;
        const st = await api.get('/api/life/settings');
        this.settings = st;
        this.goalInput = st.waterGoal;
        await Promise.all([this.loadSums(), this.loadHistory(), this.loadMonthMoods()]);
        this.syncForms();
      } catch (e) {
        this.err = e.message || '加载失败';
      } finally {
        this.loading = false;
      }
    },

    async loadSums() {
      const q = (days) => api.get('/api/life/summary?days=' + days + '&to=' + this.date);
      const [s7, s30, s90] = await Promise.all([q(7), q(30), q(90)]);
      this.sums = Object.assign({}, this.sums, { 7: s7, 30: s30, 90: s90 });
      const [y, m] = this.date.split('-').map(Number);
      const last = new Date(y, m, 0).getDate();
      const from = y + '-' + pad(m) + '-01';
      const to = y + '-' + pad(m) + '-' + pad(last);
      this.sums.month = await api.get('/api/life/summary?from=' + from + '&to=' + to);
    },

    async loadHistory() {
      const [sleep, exercise, mood, energy, water] = await Promise.all([
        api.get('/api/sleep?limit=14'),
        api.get('/api/exercise?limit=20'),
        api.get('/api/mood?limit=20'),
        api.get('/api/energy?limit=14'),
        api.get('/api/water?date=' + this.date),
      ]);
      this.hist = { sleep, exercise, mood, energy, water };
    },

    async loadMonthMoods() {
      const [y, m] = this.date.split('-').map(Number);
      const last = new Date(y, m, 0).getDate();
      const from = y + '-' + pad(m) + '-01';
      const to = y + '-' + pad(m) + '-' + pad(last);
      this.monthMoods = await api.get('/api/mood?from=' + from + '&to=' + to + '&limit=400');
    },

    syncForms() {
      if (this.day.sleep) {
        this.sleepForm = {
          bedtime: this.day.sleep.bedtime,
          wake_time: this.day.sleep.wake_time,
          quality: this.day.sleep.quality,
          note: this.day.sleep.note || '',
        };
      }
      if (this.day.energy) {
        this.energyForm = { level: this.day.energy.level, note: this.day.energy.note || '' };
      }
    },

    shift(n) {
      const next = addDays(this.date, n);
      if (next > this.today) return;
      this.date = next;
      this.editing = null;
      this.reload();
    },
    setTab(key) {
      this.tab = key;
      try { history.replaceState(null, '', '#/life/' + key); } catch (e) {}
    },
    readHashTab() {
      const m = /^#\/life\/?([a-z]*)/.exec(location.hash || '');
      const key = m && m[1];
      if (key && LIFE_TABS.some((t) => t.key === key)) this.tab = key;
    },
    setToday() { this.date = this.today; this.editing = null; this.reload(); },
    onDateChange() {
      if (this.date > this.today) this.date = this.today;
      this.editing = null;
      this.reload();
    },

    /* ---------- 睡眠 ---------- */
    async saveSleep() {
      if (!this.sleepForm.bedtime || !this.sleepForm.wake_time) return;
      try {
        await api.post('/api/sleep', Object.assign({ date: this.date }, this.sleepForm));
        await this.reload();
        this.$root.toast('睡眠已记录');
        if (window.RobotCompanion) window.RobotCompanion.acknowledge();
      } catch (e) { this.$root.toast(e.message); }
    },
    async delSleep(id) {
      await api.del('/api/sleep/' + id);
      await this.reload();
      this.$root.toast('已删除');
    },
    sleepPreviewMin() {
      const b = this.sleepForm.bedtime, w = this.sleepForm.wake_time;
      if (!b || !w) return 0;
      const [bh, bm] = b.split(':').map(Number);
      const [wh, wm] = w.split(':').map(Number);
      const bed = bh * 60 + bm, wake = wh * 60 + wm;
      if (wake === bed) return 0;
      return wake > bed ? wake - bed : wake + 1440 - bed;
    },

    /* ---------- 运动 ---------- */
    async addExercise() {
      const d = Number(this.exForm.duration_min);
      if (!d || d <= 0) { this.$root.toast('请填写运动时长'); return; }
      try {
        await api.post('/api/exercise', Object.assign({ date: this.date }, this.exForm, { duration_min: d }));
        this.exForm = { type: this.exForm.type, duration_min: '', intensity: 'Medium', note: '' };
        await this.reload();
        this.$root.toast('运动已记录');
        if (window.RobotCompanion) window.RobotCompanion.acknowledge();
      } catch (e) { this.$root.toast(e.message); }
    },
    async delExercise(id) {
      await api.del('/api/exercise/' + id);
      await this.reload();
      this.$root.toast('已删除');
    },

    /* ---------- 饮水 ---------- */
    async addWater(ml) {
      const amount = Number(ml);
      if (!amount || amount <= 0) return;
      try {
        await api.post('/api/water', { date: this.date, amount_ml: amount, time: nowTimeLocal() });
        this.waterCustom = '';
        const wasReached = this.waterGoalReached;
        await this.reload();
        if (!wasReached && this.waterGoalReached && window.RobotCompanion) {
          window.RobotCompanion.celebrate();
        }
        this.$root.toast('+' + amount + ' ml');
      } catch (e) { this.$root.toast(e.message); }
    },
    async undoWater() {
      try {
        await api.post('/api/water/undo', { date: this.date });
        await this.reload();
        this.$root.toast('已撤销最近一条');
      } catch (e) { this.$root.toast(e.message); }
    },
    async delWater(id) {
      await api.del('/api/water/' + id);
      await this.reload();
      this.$root.toast('已删除');
    },
    async saveGoal() {
      try {
        const st = await api.put('/api/life/settings', { waterGoal: Number(this.goalInput) });
        this.settings = st;
        this.goalInput = st.waterGoal;
        await this.reload();
        this.$root.toast('目标已更新');
      } catch (e) { this.$root.toast(e.message); }
    },

    /* ---------- 心情 ---------- */
    async addMood() {
      try {
        await api.post('/api/mood', {
          date: this.date,
          time: nowTimeLocal(),
          mood: this.moodForm.mood,
          note: this.moodForm.note,
          tags: this.moodForm.tags,
        });
        this.moodForm = { mood: this.moodForm.mood, note: '', tags: '' };
        await this.reload();
        this.$root.toast('心情已记录');
        if (window.RobotCompanion) window.RobotCompanion.acknowledge();
      } catch (e) { this.$root.toast(e.message); }
    },
    async delMood(id) {
      await api.del('/api/mood/' + id);
      await this.reload();
      this.$root.toast('已删除');
    },

    /* ---------- 精力 ---------- */
    async saveEnergy(level) {
      const lv = level || this.energyForm.level;
      try {
        await api.post('/api/energy', { date: this.date, level: lv, note: this.energyForm.note });
        this.energyForm.level = lv;
        await this.reload();
        this.$root.toast('精力已记录');
      } catch (e) { this.$root.toast(e.message); }
    },
    async delEnergy(id) {
      await api.del('/api/energy/' + id);
      await this.reload();
      this.$root.toast('已删除');
    },

    /* ---------- 通用行内编辑 ---------- */
    startEdit(type, row) {
      const form = Object.assign({}, row);
      this.editing = { type, id: row.id, form };
    },
    cancelEdit() { this.editing = null; },
    isEditing(type, id) {
      return !!(this.editing && this.editing.type === type && this.editing.id === id);
    },
    async commitEdit() {
      if (!this.editing) return;
      const { type, id, form } = this.editing;
      try {
        if (type === 'exercise') {
          await api.put('/api/exercise/' + id, {
            date: form.date,
            type: form.type,
            duration_min: Number(form.duration_min),
            intensity: form.intensity,
            note: form.note,
          });
        } else if (type === 'water') {
          await api.put('/api/water/' + id, {
            date: form.date,
            amount_ml: Number(form.amount_ml),
            time: form.time,
          });
        } else if (type === 'mood') {
          await api.put('/api/mood/' + id, {
            date: form.date,
            time: form.time,
            mood: form.mood,
            note: form.note,
            tags: form.tags,
          });
        } else if (type === 'sleep') {
          await api.put('/api/sleep/' + id, {
            date: form.date,
            bedtime: form.bedtime,
            wake_time: form.wake_time,
            quality: form.quality,
            note: form.note,
          });
        }
        this.editing = null;
        await this.reload();
        this.$root.toast('已更新');
      } catch (e) { this.$root.toast(e.message); }
    },
  },

  mounted() {
    this.readHashTab();
    // 地址栏/前进后退切换子标签
    lifeHashHandler = (e) => {
      const d = e.detail || {};
      if (d.base !== 'life') return;
      const key = d.sub;
      if (!key || key === this.tab) return;
      if (!LIFE_TABS.some((t) => t.key === key)) return;
      this.tab = key;
      this.$nextTick(() => {
        const c = document.querySelector('.content');
        if (c) c.scrollTop = 0;
      });
    };
    window.addEventListener('pla:hashchange', lifeHashHandler);
    this.reload();
  },
  unmounted() {
    if (lifeHashHandler) {
      window.removeEventListener('pla:hashchange', lifeHashHandler);
      lifeHashHandler = null;
    }
  },
};

window.LifeDashboard = LifeDashboard;
// 供 AI Daily Briefing 页面复用图表组件
window.LifeCharts = { LifeBarChart, LifeLineChart, LifeRing };