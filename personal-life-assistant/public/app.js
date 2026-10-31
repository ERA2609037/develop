/* =========================================================
   个人生活助手 · 前端逻辑 (Vue 3 全局构建，免构建步骤)
   技术栈：Vue 3 + Fetch(API) + 本地 SQLite 后端
   说明：pad / todayLocal / api / fmtMoney 等基础能力在 core.js
   ========================================================= */

const { createApp } = Vue;

/* =========================================================
   Q 版机器人吉祥物
   ========================================================= */
const Robot = {
  name: 'Robot',
  props: { size: { type: Number, default: 140 } },
  computed: { h() { return Math.round(this.size * 1.1); } },
  template: `
  <svg :width="size" :height="h" viewBox="0 0 200 220" class="robot" fill="none" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="100" cy="206" rx="46" ry="9" fill="url(#rgShadow)" />
    <g class="robot-bob">
      <line x1="100" y1="30" x2="100" y2="14" stroke="url(#rgBody)" stroke-width="4" stroke-linecap="round" />
      <circle class="robot-antenna" cx="100" cy="11" r="7" fill="#22d3ee" />
      <rect x="34" y="60" width="12" height="30" rx="6" fill="url(#rgBody)" />
      <rect x="154" y="60" width="12" height="30" rx="6" fill="url(#rgBody)" />
      <rect x="44" y="30" width="112" height="92" rx="28" fill="url(#rgBody)" />
      <rect x="58" y="46" width="84" height="58" rx="18" fill="#0a0e1a" />
      <circle class="robot-eye" cx="82" cy="72" r="8" fill="#22d3ee" />
      <circle class="robot-eye" cx="118" cy="72" r="8" fill="#a78bfa" />
      <path d="M86 88 Q100 99 114 88" stroke="#22d3ee" stroke-width="3.5" fill="none" stroke-linecap="round" />
      <rect x="64" y="128" width="72" height="58" rx="20" fill="url(#rgBody)" />
      <circle class="robot-chest" cx="100" cy="152" r="9" fill="#0a0e1a" stroke="#22d3ee" stroke-width="3" />
      <rect x="40" y="130" width="14" height="34" rx="7" fill="url(#rgBody)" />
      <rect x="146" y="130" width="14" height="34" rx="7" fill="url(#rgBody)" />
    </g>
  </svg>`,
};

/* 空状态：小机器人 + 文案 */
const EmptyState = {
  name: 'EmptyState',
  props: { text: { type: String, default: '这里空空如也' } },
  template: `<div class="empty-state"><Robot :size="92" /><p class="empty-text">{{ text }}</p></div>`,
};

/* =========================================================
   首页（卡片式）
   ========================================================= */
const Home = {
  name: 'home',
  template: '#tpl-home',
  data() {
    return {
      stats: {
        todoTotal: 0, todoDone: 0, expense: 0, income: 0, balance: 0, scheduleToday: 0, journalTotal: 0,
        life: { sleepMin: null, waterMl: 0, waterGoal: 2000, exerciseMin: 0, energy: null, mood: null },
      },
      ai: {
        configured: false, greeting: '你好', greetingEn: 'HELLO', headline: '',
        pendingTasks: 0, overdueTasks: 0, todayEvents: 0, upcomingEvents: 0,
        recommendation: null, hasData: false,
      },
      base: [
        { view: 'life', icon: '🧬', title: 'Life Dashboard', desc: '睡眠 · 运动 · 饮水 · 心情 · 精力', grad: 'linear-gradient(135deg,#34d399,#22d3ee)' },
        { view: 'todos', icon: '✅', title: 'Todo List', desc: '待办事项 · 优先级 · 截止日', grad: 'linear-gradient(135deg,#22d3ee,#38bdf8)' },
        { view: 'expenses', icon: '💰', title: '记账', desc: '收支记录 · 分类 · 月度结余', grad: 'linear-gradient(135deg,#a78bfa,#f472b6)' },
        { view: 'schedules', icon: '📅', title: '日程', desc: '时间安排 · 时间线', grad: 'linear-gradient(135deg,#34d399,#22d3ee)' },
        { view: 'journals', icon: '📓', title: '日记', desc: '心情记录 · 自由书写', grad: 'linear-gradient(135deg,#fbbf24,#fb7185)' },
      ],
    };
  },
  computed: {
    todoPct() {
      const s = this.stats;
      return s.todoTotal ? Math.round((s.todoDone / s.todoTotal) * 100) : 0;
    },
    features() {
      const s = this.stats;
      const L = s.life || {};
      const badge = { todos: s.todoTotal, expenses: '¥' + fmtMoney(s.expense), schedules: s.scheduleToday, journals: s.journalTotal };
      return this.base.map((f) => {
        const item = Object.assign({}, f, { badge: badge[f.view] });
        if (f.view === 'life') {
          item.badge = undefined;
          item.metrics = [
            { label: '昨夜睡眠', value: L.sleepMin != null ? fmtDuration(L.sleepMin) : '—' },
            { label: '今日饮水', value: (L.waterMl || 0) + ' ml' },
            { label: '今日运动', value: fmtDuration(L.exerciseMin || 0) },
          ];
        }
        return item;
      });
    },
  },
  methods: {
    fmt: fmtMoney,
    async load() {
      try {
        this.stats = await api.get('/api/stats');
        // 逾期任务 -> 预警动画（每个会话只提醒一次，避免每次回到首页都重复预警）
        const todos = await api.get('/api/todos');
        const today = todayLocal();
        const overdue = todos.some((t) => !t.done && t.due_date && t.due_date < today);
        const rc = window.RobotCompanion;
        if (overdue && rc && rc.scene && !window.__plaOverdueWarned) {
          window.__plaOverdueWarned = true;
          rc.warn();
        }
        // AI 首页简报摘要
        try { this.ai = await api.get('/api/ai/home'); } catch (e) { /* 忽略 */ }
      } catch (e) { console.error(e); }
    },
  },
  mounted() { this.load(); },
};

/* =========================================================
   Todo List
   ========================================================= */
const Todos = {
  name: 'todos',
  template: '#tpl-todos',
  data() {
    return {
      items: [],
      filter: 'all',
      form: { title: '', priority: '中', due_date: '' },
    };
  },
  computed: {
    filtered() {
      if (this.filter === 'active') return this.items.filter((t) => !t.done);
      if (this.filter === 'done') return this.items.filter((t) => t.done);
      return this.items;
    },
  },
  methods: {
    async load() { this.items = await api.get('/api/todos'); },
    async add() {
      if (!this.form.title.trim()) return;
      await api.post('/api/todos', { ...this.form, title: this.form.title.trim() });
      this.form = { title: '', priority: '中', due_date: '' };
      this.load();
      this.$root.toast('已添加待办');
    },
    async toggle(t) {
      await api.patch('/api/todos/' + t.id + '/toggle');
      this.load();
      if (!t.done && window.RobotCompanion) window.RobotCompanion.celebrate();
    },
    async remove(id) { await api.del('/api/todos/' + id); this.load(); this.$root.toast('已删除'); },
  },
  mounted() { this.load(); },
};

/* =========================================================
   记账
   ========================================================= */
const Expenses = {
  name: 'expenses',
  template: '#tpl-expenses',
  data() {
    return {
      items: [],
      form: { amount: '', type: '支出', category: '餐饮', date: todayLocal(), note: '' },
    };
  },
  computed: {
    totals() {
      let expense = 0, income = 0;
      for (const e of this.items) {
        if (e.type === '收入') income += Number(e.amount);
        else expense += Number(e.amount);
      }
      return { expense, income, balance: income - expense };
    },
  },
  methods: {
    fmt: fmtMoney,
    async load() { this.items = await api.get('/api/expenses'); },
    async add() {
      if (!this.form.amount) return;
      await api.post('/api/expenses', {
        amount: Number(this.form.amount),
        type: this.form.type,
        category: this.form.category,
        date: this.form.date,
        note: this.form.note,
      });
      this.form = { amount: '', type: '支出', category: '餐饮', date: todayLocal(), note: '' };
      this.load();
      this.$root.toast('已记录');
      if (window.RobotCompanion) window.RobotCompanion.acknowledge();
    },
    async remove(id) { await api.del('/api/expenses/' + id); this.load(); this.$root.toast('已删除'); },
  },
  mounted() { this.load(); },
};

/* =========================================================
   日程
   ========================================================= */
const Schedules = {
  name: 'schedules',
  template: '#tpl-schedules',
  data() {
    return {
      items: [],
      form: { title: '', location: '', start_time: '', end_time: '', note: '' },
    };
  },
  computed: {
    sorted() {
      return [...this.items].sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
    },
  },
  methods: {
    fmtTime(s) { return (s || '').replace('T', ' '); },
    async load() { this.items = await api.get('/api/schedules'); },
    async add() {
      if (!this.form.title.trim() || !this.form.start_time) return;
      await api.post('/api/schedules', { ...this.form, title: this.form.title.trim() });
      this.form = { title: '', location: '', start_time: '', end_time: '', note: '' };
      this.load();
      this.$root.toast('已安排');
    },
    async remove(id) { await api.del('/api/schedules/' + id); this.load(); this.$root.toast('已删除'); },
  },
  mounted() { this.load(); },
};

/* =========================================================
   日记
   ========================================================= */
const Journals = {
  name: 'journals',
  template: '#tpl-journals',
  data() {
    return {
      items: [],
      form: { title: '', mood: '平静', date: todayLocal(), content: '' },
    };
  },
  methods: {
    moodEmoji(m) {
      return { 开心: '😊', 平静: '🙂', 低落: '😔', 愤怒: '😠', 疲惫: '😩' }[m] || '🙂';
    },
    async load() { this.items = await api.get('/api/journals'); },
    async add() {
      if (!this.form.title.trim()) return;
      await api.post('/api/journals', { ...this.form, title: this.form.title.trim() });
      this.form = { title: '', mood: '平静', date: todayLocal(), content: '' };
      this.load();
      this.$root.toast('已写下');
      if (window.RobotCompanion) window.RobotCompanion.acknowledge();
    },
    async remove(id) { await api.del('/api/journals/' + id); this.load(); this.$root.toast('已删除'); },
  },
  mounted() { this.load(); },
};

/* =========================================================
   根组件
   ========================================================= */
const APP_VIEWS = ['life', 'ai', 'todos', 'expenses', 'schedules', 'journals'];

/* 解析 #/<模块>/<子页>，未知模块回落首页 */
function parseHash() {
  const h = (location.hash || '').replace(/^#\/?/, '');
  const parts = h.split('/');
  const base = parts[0] || '';
  return { base: APP_VIEWS.includes(base) ? base : 'home', sub: parts[1] || '' };
}

let hashHandler = null;
let lastHash = null;   // 记录已处理的 hash，避免 popstate/hashchange 重复触发

const App = {
  data() {
    return { view: 'home', theme: 'dark', clock: '', toastMsg: '', toastTimer: null };
  },
  methods: {
    go(v) {
      this.view = v;
      const target = v === 'home' ? '#/' : '#/' + v;
      if ((location.hash || '#/') !== target) {
        try { history.pushState(null, '', target); } catch (e) {}
      }
      lastHash = target;
      // 主动跳转时同步通知子模块（pushState 不会触发 hashchange）
      window.dispatchEvent(new CustomEvent('pla:hashchange', { detail: { base: v, sub: '' } }));
    },
    toggleTheme() {
      this.theme = this.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', this.theme);
      try { localStorage.setItem('pla-theme', this.theme); } catch (e) {}
    },
    toast(msg) {
      this.toastMsg = msg;
      if (this.toastTimer) clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => { this.toastMsg = ''; }, 1800);
    },
    tick() {
      const d = new Date();
      this.clock = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    },
  },
  mounted() {
    let saved = 'dark';
    try { saved = localStorage.getItem('pla-theme') || 'dark'; } catch (e) {}
    const q = new URLSearchParams(location.search).get('theme');
    if (q === 'light' || q === 'dark') saved = q;
    this.theme = saved;
    document.documentElement.setAttribute('data-theme', saved);

    const initial = parseHash();
    if (initial.base !== 'home') this.view = initial.base;

    // 浏览器前进/后退、手动改地址栏 → 同步视图
    lastHash = location.hash || '#/';
    hashHandler = () => {
      const h = location.hash || '#/';
      if (h === lastHash) return;   // 去重：同一次变更可能触发多次事件
      lastHash = h;
      const { base, sub } = parseHash();
      if (base !== this.view) this.view = base;
      window.dispatchEvent(new CustomEvent('pla:hashchange', { detail: { base, sub } }));
    };
    window.addEventListener('hashchange', hashHandler);

    this.tick();
    setInterval(this.tick, 1000);
  },
  unmounted() {
    if (hashHandler) {
      window.removeEventListener('hashchange', hashHandler);
      hashHandler = null;
    }
  },
};

const app = createApp(App);
app.component('Robot', Robot);
app.component('EmptyState', EmptyState);
app.component('home', Home);
if (window.LifeDashboard) app.component('life', window.LifeDashboard);
if (window.AiBriefing) app.component('ai', window.AiBriefing);
app.component('todos', Todos);
app.component('expenses', Expenses);
app.component('schedules', Schedules);
app.component('journals', Journals);
app.mount('#app');
