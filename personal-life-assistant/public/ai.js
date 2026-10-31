/* =========================================================
   AI Daily Briefing · 前端组件
   依赖：core.js（api / todayLocal / addDays）、life.js（图表组件）
   说明：所有数值由后端聚合真实数据计算，前端只负责展示与交互。
   ========================================================= */

const CHAT_KEY = 'pla-ai-chat';
let aiHashHandler = null;

function loadChat() {
  try {
    const raw = sessionStorage.getItem(CHAT_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.slice(-40) : [];
  } catch (e) { return []; }
}
function saveChat(messages) {
  try { sessionStorage.setItem(CHAT_KEY, JSON.stringify(messages.slice(-40))); } catch (e) {}
}

const AiBriefing = {
  name: 'ai',
  template: '#tpl-ai',

  components: {
    LifeBarChart: window.LifeCharts ? window.LifeCharts.LifeBarChart : null,
    LifeLineChart: window.LifeCharts ? window.LifeCharts.LifeLineChart : null,
  },

  data() {
    return {
      tab: 'daily',
      loading: false,
      error: '',
      report: null,
      history: [],
      status: {
        configured: false,
        provider: 'local',
        model: null,
        settings: {
          diaryEnabled: false,
          currency: '¥',
          autoGenerate: true,
          sources: { todos: true, calendar: true, finance: true, lifestyle: true },
        },
      },
      settings: { diaryEnabled: false, currency: '¥', autoGenerate: true, sources: { todos: true, calendar: true, finance: true, lifestyle: true } },
      showSettings: false,
      chat: { question: '', messages: [], sending: false },
      histFilter: { type: 'all', range: 'all' },
      histLoading: false,
      quickQuestions: [
        '今天该先做什么？',
        '哪些任务逾期了？',
        '这个月花了多少钱？',
        '我最近睡眠怎么样？',
        '本周效率如何？',
      ],
    };
  },

  computed: {
    tabs() {
      return [
        { key: 'daily', label: '日报' },
        { key: 'weekly', label: '周报' },
        { key: 'monthly', label: '月报' },
        { key: 'history', label: '历史' },
      ];
    },
    sourceLabel() {
      if (!this.report) return '';
      const s = this.report.source;
      if (s === 'ai') return 'AI 生成';
      if (s === 'local-fallback') return 'AI 失败 · 本地兜底';
      return '本地分析引擎';
    },
  },

  methods: {
    fmtTime(iso) {
      if (!iso) return '';
      const d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso).slice(11, 16);
      return pad(d.getHours()) + ':' + pad(d.getMinutes());
    },
    fmtDate(iso) {
      if (!iso) return '';
      const d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso).slice(0, 10);
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    },

    computePeriod(type) {
      const today = todayLocal();
      if (type === 'daily') return { from: today, to: today };
      if (type === 'weekly') {
        const [y, m, d] = today.split('-').map(Number);
        const dow = (new Date(y, m - 1, d).getDay() + 6) % 7; // 0 = 周一
        return { from: addDays(today, -dow), to: today };
      }
      return { from: today.slice(0, 8) + '01', to: today };
    },

    async loadStatus() {
      try {
        this.status = await api.get('/api/ai/status');
        this.settings = JSON.parse(JSON.stringify(this.status.settings));
      } catch (e) { /* 状态读取失败不阻塞页面 */ }
    },

    async ensureReport(type, force) {
      this.loading = true;
      this.error = '';
      try {
        if (!force) {
          const p = this.computePeriod(type);
          const list = await api.get('/api/ai/reports?type=' + type + '&from=' + p.from + '&to=' + p.to + '&limit=20');
          const hit = (list || []).find((h) => h.period_from === p.from && h.period_to === p.to);
          if (hit) {
            this.report = await api.get('/api/ai/reports/' + hit.id);
            this.loading = false;
            return;
          }
        }
        this.report = await api.post('/api/ai/briefing', { type, date: todayLocal() });
      } catch (e) {
        this.error = e.message || '生成失败';
      } finally {
        this.loading = false;
      }
    },

    async switchTab(key) {
      this.tab = key;
      try { history.replaceState(null, '', '#/ai/' + key); } catch (e) {}
      if (key === 'history') { await this.loadHistory(); return; }
      await this.ensureReport(key, false);
      this.$nextTick(this.scrollTop);
    },

    async loadHistory() {
      this.histLoading = true;
      try {
        const q = ['limit=60'];
        if (this.histFilter.type !== 'all') q.push('type=' + this.histFilter.type);
        if (this.histFilter.range !== 'all') {
          q.push('from=' + addDays(todayLocal(), -(Number(this.histFilter.range) - 1)));
        }
        this.history = await api.get('/api/ai/reports?' + q.join('&'));
      } catch (e) { this.error = e.message; }
      finally { this.histLoading = false; }
    },

    setHistType(t) {
      if (this.histFilter.type === t) return;
      this.histFilter.type = t;
      this.loadHistory();
    },
    setHistRange(r) {
      if (this.histFilter.range === r) return;
      this.histFilter.range = r;
      this.loadHistory();
    },

    async openReport(id) {
      try {
        const r = await api.get('/api/ai/reports/' + id);
        this.report = r;
        this.tab = r.type || 'daily';
        this.$nextTick(this.scrollTop);
      } catch (e) { this.$root.toast('打开失败：' + e.message); }
    },

    async regenerate() {
      const type = this.tab === 'history' ? 'daily' : this.tab;
      this.tab = type;
      await this.ensureReport(type, true);
      this.$root.toast('已重新生成');
    },

    async ask(q) {
      const question = (typeof q === 'string' ? q : this.chat.question).trim();
      if (!question || this.chat.sending) return;
      this.chat.messages.push({ role: 'user', text: question });
      saveChat(this.chat.messages);
      this.chat.question = '';
      this.chat.sending = true;
      try {
        const r = await api.post('/api/ai/ask', { question });
        this.chat.messages.push({ role: 'ai', text: r.answer, citations: r.citations || [], source: r.source });
      } catch (e) {
        this.chat.messages.push({ role: 'ai', text: '回答失败：' + e.message });
      } finally {
        saveChat(this.chat.messages);
        this.chat.sending = false;
        this.$nextTick(this.scrollChat);
      }
    },

    clearChat() {
      this.chat.messages = [];
      saveChat(this.chat.messages);
    },

    scrollChat() {
      const el = this.$el && this.$el.querySelector('.ai-chat-log');
      if (el) el.scrollTop = el.scrollHeight;
    },
    scrollTop() {
      const c = document.querySelector('.content');
      if (c) c.scrollTop = 0;
    },

    openSettings() {
      this.settings = JSON.parse(JSON.stringify(this.status.settings));
      this.showSettings = true;
    },
    async saveSettings() {
      try {
        const r = await api.put('/api/ai/settings', {
          diaryEnabled: this.settings.diaryEnabled,
          currency: this.settings.currency,
          autoGenerate: this.settings.autoGenerate,
          sources: this.settings.sources,
        });
        this.status.settings = r;
        this.showSettings = false;
        this.$root.toast('设置已保存');
        await this.ensureReport(this.tab === 'history' ? 'daily' : this.tab, true);
      } catch (e) { this.$root.toast('保存失败：' + e.message); }
    },
  },

  async mounted() {
    await this.loadStatus();

    // 恢复上次的追问对话（同一会话内保留）
    this.chat.messages = loadChat();
    this.$nextTick(this.scrollChat);

    const m = /^#\/ai\/?([a-z]*)/.exec(location.hash || '');
    const k = m && m[1];
    if (['daily', 'weekly', 'monthly', 'history'].includes(k)) this.tab = k;

    // 地址栏/前进后退切换子标签
    aiHashHandler = (e) => {
      const d = e.detail || {};
      if (d.base !== 'ai') return;
      const key = d.sub || 'daily';
      if (!['daily', 'weekly', 'monthly', 'history'].includes(key) || key === this.tab) return;
      this.switchTab(key);
    };
    window.addEventListener('pla:hashchange', aiHashHandler);

    if (this.tab === 'history') {
      await this.loadHistory();
    } else {
      // 首次打开当天：若当天日报已存在则读取，否则自动生成
      await this.ensureReport(this.tab, false);
    }
  },

  unmounted() {
    if (aiHashHandler) {
      window.removeEventListener('pla:hashchange', aiHashHandler);
      aiHashHandler = null;
    }
  },
};

window.AiBriefing = AiBriefing;
