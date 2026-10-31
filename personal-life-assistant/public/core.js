/* =========================================================
   共享基础层：日期工具 + API 封装 + 格式化
   被 life.js / app.js 共同使用（经典脚本，全局可见）
   ========================================================= */

function pad(n) { return String(n).padStart(2, '0'); }

function todayLocal() {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function nowLocal() {
  const d = new Date();
  return todayLocal() + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function nowTimeLocal() {
  const d = new Date();
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function addDays(dateStr, n) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
}

/* ---------- API 封装（同源，无需 CORS） ---------- */
const api = {
  async req(method, path, body) {
    const opt = { method, headers: {} };
    if (body !== undefined) {
      opt.headers['Content-Type'] = 'application/json';
      opt.body = JSON.stringify(body);
    }
    const r = await fetch(path, opt);
    if (!r.ok) {
      let msg = '请求失败 ' + r.status;
      try { const j = await r.json(); if (j && j.error) msg = j.error; } catch (e) {}
      throw new Error(msg);
    }
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  },
  get(p) { return this.req('GET', p); },
  post(p, b) { return this.req('POST', p, b); },
  put(p, b) { return this.req('PUT', p, b); },
  patch(p, b) { return this.req('PATCH', p, b); },
  del(p) { return this.req('DELETE', p); },
};

const fmtMoney = (n) =>
  (Number(n) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
