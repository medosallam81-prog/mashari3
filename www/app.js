/* مشاريعي: خطط المشاريع، المسؤولين، المتابعات، المعاملات والتذكيرات */
const CFG = window.FIREBASE_CONFIG;
const CAP = window.Capacitor;
const isNative = !!(CAP && CAP.isNativePlatform && CAP.isNativePlatform());
const LN = isNative && CAP.registerPlugin ? CAP.registerPlugin('LocalNotifications') : null;
const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
const LKEY = 'mashari3-board';

let state = { projects: [] };
let selected = null, openTask = null, query = '';
let cloud = null;           // {ref, setDoc, auth, user, signOut}
let writing = false, pending = false, timer = null, dirty = false, lastWritten = '';

const $ = (id) => document.getElementById(id);
const plist = $('plist'), detail = $('detail'), nowEl = $('now');

/* ---------------- helpers ---------------- */
const n = (x) => Number(x).toLocaleString('ar-EG');
const uid = () => Math.random().toString(36).slice(2, 10);
const pad = (x) => String(x).padStart(2, '0');
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids) { if (c == null || c === false) continue; el.append(c.nodeType ? c : document.createTextNode(c)); }
  return el;
}
const days = (ts) => ts ? Math.floor((Date.now() - ts) / 86400000) : null;
function rel(ts) {
  const d = days(ts); if (d == null) return '';
  if (d <= 0) return 'النهارده'; if (d === 1) return 'امبارح'; if (d === 2) return 'من يومين';
  if (d <= 10) return 'من ' + n(d) + ' أيام'; return 'من ' + n(d) + ' يوم';
}
function norm(x) { return (x || '').trim().replace(/\s+/g, ' ').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').toLowerCase(); }
function dstr(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
const todayStr = () => dstr(new Date());
function dueTs(t) { return t.date ? new Date(t.date + 'T' + (t.time || '09:00')).getTime() : 0; }
function fmtTs(ts, withTime = true) {
  const d = new Date(ts), td = todayStr(), ds = dstr(d);
  const tm = new Date(); tm.setDate(tm.getDate() + 1);
  let s = ds === td ? 'النهارده' : ds === dstr(tm) ? 'بكرة' : d.toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' });
  if (withTime) s += ' ' + d.toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit' });
  return s;
}
function fmtDue(t) { return t.date ? fmtTs(dueTs(t), !!t.time) : ''; }
function dueKind(t) {
  if (!t.date || t.s === 2) return '';
  const td = todayStr();
  if (t.date < td) return 'over';
  if (t.date === td) return (t.time && dueTs(t) < Date.now()) ? 'over' : 'today';
  return '';
}
const STAGES = ['لسه ماتقدمتش', 'تحت التخليص', 'جاهزة للاستلام', 'استلمتها'];
function setStage(t, k) { t.stage = k; t.s = k === 3 ? 2 : k === 0 ? 0 : 1; }
function prog(p) { const t = p.tasks.length, d = p.tasks.filter((x) => x.s === 2).length; return { t, d, pct: t ? Math.round(d / t * 100) : 0 }; }
function nextStep(p) { return p.tasks.find((x) => x.s === 1) || p.tasks.find((x) => x.s === 0); }
const find = (id) => state.projects.find((p) => p.id === id);
const touch = (p) => { p.updatedAt = Date.now(); };
function allTasks() { const r = []; state.projects.forEach((p) => p.tasks.forEach((t) => r.push({ p, t }))); return r; }
function people() {
  const m = {};
  allTasks().forEach(({ t }) => {
    const w = (t.who || '').trim(); if (!w) return; const k = norm(w);
    m[k] = m[k] || { name: w, open: 0, doing: 0, done: 0 };
    if (t.s === 2) m[k].done++; else { m[k].open++; if (t.s === 1) m[k].doing++; }
  });
  return Object.values(m).sort((a, b) => b.open - a.open);
}
function statusTag(t) {
  if (t.kind === 'm') return h('span', { class: 'tag' + (t.stage === 2 ? ' doing' : t.s === 2 ? ' done' : ''), text: STAGES[t.stage || 0] });
  return h('span', { class: 'tag' + (t.s === 1 ? ' doing' : t.s === 2 ? ' done' : ''), text: t.s === 0 ? 'لسه' : t.s === 1 ? 'شغال' : 'خلصت' });
}
function toast(msg) {
  const el = h('div', { class: 'toast', role: 'status', text: msg });
  document.body.append(el); setTimeout(() => el.remove(), 2600);
}

/* ---------------- storage ---------------- */
function saveLocal() { try { localStorage.setItem(LKEY, JSON.stringify(state)); } catch (e) {} }
function setSync(kind) {
  const el = $('sync'); el.className = 'sync ' + kind;
  el.lastChild.textContent = kind === 'ok' ? 'متزامن' : kind === 'err' ? 'مش متزامن' : kind === 'saving' ? 'بيحفظ…' : kind === 'offline' ? 'من غير نت' : 'على الجهاز ده';
}
function save() {
  dirty = true; saveLocal(); scheduleNotifs();
  if (!cloud) { dirty = false; return; }
  setSync('saving');
  clearTimeout(timer); timer = setTimeout(() => { timer = null; flush(); }, 700);
}
async function flush() {
  if (!cloud) return;
  if (writing) { pending = true; return; }
  writing = true;
  const body = JSON.stringify(state);
  try { await cloud.setDoc(cloud.ref, JSON.parse(body)); lastWritten = body; setSync(navigator.onLine ? 'ok' : 'offline'); }
  catch (e) { console.warn(e); setSync('err'); }
  writing = false;
  if (pending) { pending = false; flush(); return; }
  if (!timer) dirty = false;
}
const valid = (d) => d && Array.isArray(d.projects);
function applyRemote(data) {
  const s = JSON.stringify(data); if (s === lastWritten) return;
  lastWritten = s; state = JSON.parse(s); saveLocal(); scheduleNotifs();
  if (selected && !find(selected)) selected = null;
  const a = document.activeElement;
  if (a && detail.contains(a) && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT')) renderList(); else render();
}

/* ---------------- notifications ---------------- */
function hid(s) { let x = 7; for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0; return (Math.abs(x) % 2000000000) + 1; }
function reminders() {
  const out = [], now = Date.now();
  allTasks().forEach(({ p, t }) => {
    if (t.s !== 2 && t.date) {
      const at = dueTs(t);
      if (at > now) out.push({
        key: t.id + ':d', at, pid: p.id, tid: t.id,
        title: t.kind === 'm' ? '📄 ميعاد استلام معاملة' : '⏰ ميعاد مهمة',
        body: t.text + '، ' + p.name + (t.who ? ' (مع ' + t.who + ')' : ''),
      });
    }
    if (t.follow && t.follow > now && t.s !== 2) out.push({
      key: t.id + ':f' + t.follow, at: t.follow, pid: p.id, tid: t.id,
      title: '🔁 راجع مع ' + (t.who || 'المسؤول'),
      body: t.text + '، ' + p.name,
    });
  });
  return out.sort((a, b) => a.at - b.at).slice(0, 60);
}
let notifTimer = null, channelMade = false, notifState = 'unknown', webTimers = [];
function scheduleNotifs() { clearTimeout(notifTimer); notifTimer = setTimeout(syncNotifs, 1200); }
async function syncNotifs() {
  const list = reminders();
  if (LN) {
    try {
      let perm = await LN.checkPermissions();
      if (perm.display !== 'granted') perm = await LN.requestPermissions();
      notifState = perm.display;
      if (perm.display !== 'granted') return;
      if (!channelMade) {
        try { await LN.createChannel({ id: 'reminders', name: 'تذكيرات المهام', importance: 5, visibility: 1, vibration: true }); } catch (e) {}
        channelMade = true;
      }
      const pend = await LN.getPending();
      if (pend.notifications && pend.notifications.length) await LN.cancel({ notifications: pend.notifications.map((x) => ({ id: x.id })) });
      if (list.length) await LN.schedule({
        notifications: list.map((r) => ({
          id: hid(r.key), title: r.title, body: r.body, channelId: 'reminders',
          schedule: { at: new Date(r.at), allowWhileIdle: true }, extra: { pid: r.pid, tid: r.tid },
        })),
      });
    } catch (e) { console.warn('notif', e); }
    return;
  }
  // الكمبيوتر: تنبيهات المتصفح وهو مفتوح
  webTimers.forEach(clearTimeout); webTimers = [];
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const horizon = Date.now() + 24 * 3600 * 1000;
  list.filter((r) => r.at < horizon).forEach((r) => {
    webTimers.push(setTimeout(() => {
      try { const nt = new Notification(r.title, { body: r.body, tag: r.key }); nt.onclick = () => { window.focus(); openTask = r.tid; select(r.pid); }; } catch (e) {}
      render();
    }, r.at - Date.now()));
  });
}
if (LN) {
  LN.addListener('localNotificationActionPerformed', (ev) => {
    const x = ev && ev.notification && ev.notification.extra;
    if (x && x.pid && find(x.pid)) { openTask = x.tid; select(x.pid, true); }
  });
}

/* ---------------- navigation ---------------- */
if (isNative && CAP.registerPlugin) {
  const AppP = CAP.registerPlugin('App');
  AppP.addListener('backButton', () => {
    if ($('sheetRoot').firstChild) { closeSheet(); return; }
    if (selected) { goHome(); return; }
    if (query) { query = ''; $('q').value = ''; renderList(); return; }
    AppP.exitApp();
  });
}
function select(id, push) {
  const was = selected;
  selected = id;
  if (id && !was && push !== false) { try { history.pushState({ p: id }, ''); } catch (e) {} }
  document.body.classList.toggle('show-detail', !!id);
  render(); window.scrollTo({ top: 0 });
  if (id && openTask) {
    const el = document.getElementById('t-' + openTask);
    if (el) { const d = el.closest('details'); if (d) d.open = true; el.scrollIntoView({ block: 'center' }); }
  }
}
function goHome() { if (history.state && history.state.p) history.back(); else select(null, false); }
window.addEventListener('popstate', (e) => {
  const p = e.state && e.state.p;
  selected = p && find(p) ? p : null; openTask = null;
  document.body.classList.toggle('show-detail', !!selected); render();
});

/* ---------------- rendering: list ---------------- */
function render() { renderList(); renderDetail(); }

function renderPeople() {
  const box = $('people'), dl = $('names');
  box.replaceChildren(); dl.replaceChildren();
  const mOpen = allTasks().filter(({ t }) => t.kind === 'm' && t.s !== 2).length;
  if (allTasks().some(({ t }) => t.kind === 'm')) {
    box.append(h('button', { class: 'chip', 'aria-pressed': query === ':m' ? 'true' : 'false', onclick: () => { query = query === ':m' ? '' : ':m'; $('q').value = ''; renderList(); } }, '📄 المعاملات', h('b', { text: n(mOpen) })));
  }
  people().forEach((x) => {
    dl.append(h('option', { value: x.name }));
    box.append(h('button', { class: 'chip', 'aria-pressed': norm(query) === norm(x.name) ? 'true' : 'false', onclick: () => {
      query = norm(query) === norm(x.name) ? '' : x.name; $('q').value = query; renderList();
    } }, x.name, h('b', { text: n(x.open) })));
  });
}

function resultLine(p, t) {
  const dk = dueKind(t);
  return h('li', null, h('button', { onclick: () => { openTask = t.id; select(p.id); } },
    statusTag(t), h('span', { style: 'flex:1', text: t.text }),
    t.date ? h('span', { class: 'when ' + dk, text: fmtDue(t) }) : null));
}

function renderResults() {
  const res = $('results'), home = $('home');
  res.replaceChildren();
  home.hidden = !!query.trim();
  if (!query.trim()) return;
  const all = allTasks();
  if (query === ':m') {
    const ms = all.filter(({ t }) => t.kind === 'm');
    [2, 1, 0, 3].forEach((k) => {
      const l = ms.filter(({ t }) => (t.stage || 0) === k); if (!l.length) return;
      const c = h('div', { class: 'res' }, h('h3', null, h('span', { class: k === 2 ? 'hl' : '', text: STAGES[k] + ' (' + n(l.length) + ')' })));
      const ul = h('ul');
      l.forEach(({ p, t }) => ul.append(h('li', null, h('button', { onclick: () => { openTask = t.id; select(p.id); } },
        h('span', { style: 'flex:1', text: t.text + (t.office ? '، ' + t.office : '') }),
        h('span', { class: 'tag', text: t.who || p.name }),
        t.date ? h('span', { class: 'when ' + dueKind(t), text: fmtDue(t) }) : null))));
      c.append(ul); res.append(c);
    });
    if (!ms.length) res.append(h('div', { class: 'empty', text: 'مفيش معاملات لسه. افتح أي مهمة ودوس ⋯ وعلّم إنها معاملة.' }));
    return;
  }
  const q = norm(query);
  const byWho = all.filter(({ t }) => norm(t.who).includes(q));
  const byText = all.filter((x) => !byWho.includes(x) && (norm(x.t.text).includes(q) || norm(x.t.office).includes(q) || norm(x.t.ref).includes(q)));
  const groups = {};
  byWho.forEach((x) => { const k = norm(x.t.who); (groups[k] = groups[k] || { name: x.t.who.trim(), items: [] }).items.push(x); });
  Object.values(groups).forEach((g) => {
    const open = g.items.filter((x) => x.t.s !== 2), doing = open.filter((x) => x.t.s === 1).length;
    const fol = open.filter((x) => x.t.follow).length;
    const card = h('div', { class: 'res' }, h('h3', null, h('span', { class: 'hl', text: g.name })),
      h('p', { class: 'sum', text: 'عنده ' + n(open.length) + ' مهام مفتوحة' + (doing ? '، ' + n(doing) + ' شغال فيهم' : '') + (fol ? '، و' + n(fol) + ' مستنية مراجعة' : '') + (g.items.length > open.length ? '. خلّص ' + n(g.items.length - open.length) : '') }));
    const byP = {};
    g.items.sort((a, b) => (a.t.s === 2) - (b.t.s === 2)).forEach((x) => { (byP[x.p.id] = byP[x.p.id] || { p: x.p, l: [] }).l.push(x.t); });
    Object.values(byP).forEach((o) => { card.append(h('h4', { text: o.p.name })); const ul = h('ul'); o.l.forEach((t) => ul.append(resultLine(o.p, t))); card.append(ul); });
    res.append(card);
  });
  if (byText.length) {
    const c = h('div', { class: 'res' }, h('h3', { text: 'مهام فيها الكلمة' })); const ul = h('ul');
    byText.forEach(({ p, t }) => ul.append(resultLine(p, t))); c.append(ul); res.append(c);
  }
  if (!byWho.length && !byText.length) res.append(h('div', { class: 'empty', text: 'مفيش نتايج لـ«' + query.trim() + '». اكتب الاسم زي ما متسجّل في المهمة.' }));
}

function snooze(p, t, ms) { t.follow = Date.now() + ms; touch(p); save(); render(); toast('هفكّرك ' + fmtTs(t.follow)); }

function renderSoon() {
  const el = $('soon'); el.replaceChildren();
  const now = Date.now(), lim = now + 7 * 86400000, items = [];
  allTasks().forEach(({ p, t }) => {
    if (t.s === 2) return;
    if (t.date && dueTs(t) <= lim) items.push({ p, t, at: dueTs(t), type: 'd' });
    if (t.follow && t.follow <= lim) items.push({ p, t, at: t.follow, type: 'f' });
  });
  items.sort((a, b) => a.at - b.at);
  el.hidden = !items.length; if (!items.length) return;
  el.append(h('h3', { text: 'محتاج انتباهك' }));
  const ul = h('ul');
  items.slice(0, 12).forEach(({ p, t, at, type }) => {
    const late = at <= now;
    const label = type === 'f' ? '🔁 راجع مع ' + (t.who || 'المسؤول') : t.kind === 'm' ? '📄 استلام معاملة' : '⏰ ميعاد';
    const li = h('li', null, h('button', { onclick: () => { openTask = t.id; select(p.id); } },
      h('span', null, h('small', { text: label + '  |  ' + p.name }), t.text),
      h('span', { class: 'when' + (late ? ' over' : (type === 'd' && dueKind(t) === 'today') ? ' today' : ''), text: (late ? 'فات: ' : '') + (type === 'd' ? fmtDue(t) : fmtTs(at)) })));
    if (type === 'f' && late) {
      li.append(h('div', { class: 'acts' },
        h('button', { class: 'btn', text: 'راجعت', onclick: () => { t.follow = 0; t.lastReview = Date.now(); touch(p); save(); render(); toast('تمام. لو محتاج متابعة تانية حطها من ⋯'); } }),
        h('button', { class: 'btn ghost', text: 'أجّل يوم', onclick: () => snooze(p, t, 86400000) }),
        h('button', { class: 'btn ghost', text: 'خلصت المهمة', onclick: () => { t.follow = 0; if (t.kind === 'm') setStage(t, 3); else t.s = 2; touch(p); save(); render(); } })));
    }
    ul.append(li);
  });
  el.append(ul);
}

function renderList() {
  document.body.classList.toggle('show-detail', !!selected);
  renderPeople(); renderResults(); renderSoon();
  const doing = allTasks().filter(({ t }) => t.s === 1 && t.kind !== 'm');
  nowEl.hidden = !doing.length; nowEl.replaceChildren();
  if (doing.length) {
    nowEl.append(h('h3', { text: 'شغال فيه دلوقتي' }));
    const ul = h('ul');
    doing.forEach(({ p, t }) => ul.append(h('li', null, h('button', { onclick: () => { openTask = t.id; select(p.id); } }, h('small', { text: p.name + (t.who ? '  |  ' + t.who : '') }), t.text))));
    nowEl.append(ul);
  }
  plist.replaceChildren();
  if (!state.projects.length) {
    plist.append(h('li', null, h('div', { class: 'empty' },
      h('p', { text: 'مفيش مشاريع لسه. ابدأ بأول مشروع، أو استورد بياناتك القديمة من ⚙︎.' }),
      h('button', { class: 'btn solid', onclick: openAdd, text: '+ أضف مشروع' }))));
    return;
  }
  state.projects.forEach((p) => {
    const g = prog(p), nx = nextStep(p), d = days(p.updatedAt);
    const stale = d != null && d >= 7 && g.d < g.t;
    plist.append(h('li', null, h('button', { class: 'pcard', 'aria-current': selected === p.id ? 'true' : 'false', onclick: () => select(p.id) },
      h('div', { class: 'name' }, h('span', { class: 'hl', text: p.name })),
      p.note ? h('p', { class: 'line' }, h('b', { text: 'وقفت عند: ' }), p.note) : null,
      !p.note && nx ? h('p', { class: 'line' }, h('b', { text: 'الجاي: ' }), nx.text) : null,
      h('div', { class: 'bar' }, h('span', { style: 'width:' + g.pct + '%' })),
      h('div', { class: 'pfoot' },
        h('span', { text: g.t ? n(g.d) + ' من ' + n(g.t) + ' خلصوا' : 'من غير خطوات' }),
        h('span', { class: stale ? 'stale' : '', text: p.updatedAt ? (stale ? 'ما اتلمسش ' : 'آخر تعديل ') + rel(p.updatedAt) : '' })))));
  });
}

/* ---------------- rendering: detail ---------------- */
function cycle(p, t) {
  if (t.kind === 'm') setStage(t, ((t.stage || 0) + 1) % 4);
  else t.s = (t.s + 1) % 3;
  if (t.s === 2) t.follow = 0;
  touch(p); save(); render();
}

function editPanel(p, t) {
  const upd = () => { touch(p); save(); render(); };
  const box = h('div', { class: 'tedit' });

  box.append(h('label', null, 'المهمة دي عند مين؟',
    h('input', { class: 'field', list: 'names', value: t.who || '', placeholder: 'مثلاً: أحمد', onchange: (e) => { t.who = e.target.value.trim(); upd(); } })));

  // معاملة
  const chk = h('input', { type: 'checkbox', onchange: (e) => { if (e.target.checked) { t.kind = 'm'; setStage(t, t.s === 2 ? 3 : t.s === 1 ? 1 : 0); } else { t.kind = ''; } upd(); } });
  chk.checked = t.kind === 'm';
  box.append(h('label', { class: 'check' }, chk, 'دي معاملة بتتخلّص ومستني أستلمها'));
  if (t.kind === 'm') {
    box.append(h('div', { class: 'row' },
      h('label', null, 'الجهة', h('input', { class: 'field', value: t.office || '', placeholder: 'مثلاً: الشهر العقاري', onchange: (e) => { t.office = e.target.value.trim(); upd(); } })),
      h('label', null, 'رقم المعاملة', h('input', { class: 'field', value: t.ref || '', dir: 'ltr', onchange: (e) => { t.ref = e.target.value.trim(); upd(); } }))));
    const st = h('div', { class: 'stages' });
    STAGES.forEach((s, k) => st.append(h('button', { class: 'chip', type: 'button', 'aria-pressed': (t.stage || 0) === k ? 'true' : 'false', text: s, onclick: () => { setStage(t, k); if (k === 3) t.follow = 0; upd(); } })));
    box.append(h('div', { class: 'subhead', text: 'وصلت لفين؟' }), st);
  }

  // ميعاد
  box.append(h('div', { class: 'subhead', text: t.kind === 'm' ? 'ميعاد الاستلام المتوقع' : 'الميعاد' }));
  box.append(h('div', { class: 'row' },
    h('label', null, 'اليوم', h('input', { class: 'field', type: 'date', value: t.date || '', onchange: (e) => { t.date = e.target.value; if (!t.date) t.time = ''; upd(); } })),
    h('label', null, 'الساعة (اختياري)', h('input', { class: 'field', type: 'time', value: t.time || '', onchange: (e) => { t.time = e.target.value; if (t.time && !t.date) t.date = todayStr(); upd(); } }))));
  if (t.date) box.append(h('div', { class: 'acts' }, h('span', { class: 'kind', text: (dueTs(t) > Date.now() ? 'هيفكّرك ' : 'الميعاد فات: ') + fmtTs(dueTs(t), !!t.time) }), h('button', { class: 'btn ghost', type: 'button', text: 'امسح الميعاد', onclick: () => { t.date = ''; t.time = ''; upd(); } })));

  // متابعة
  const who = t.who || 'المسؤول';
  box.append(h('div', { class: 'subhead', text: 'فكّرني أراجع مع ' + who + ' بعد:' }));
  const H = 3600000, D = 86400000;
  const quick = h('div', { class: 'quick' });
  [['ساعة', H], ['٣ ساعات', 3 * H], ['بكرة', D], ['٣ أيام', 3 * D], ['أسبوع', 7 * D], ['أسبوعين', 14 * D]].forEach(([l, ms]) =>
    quick.append(h('button', { class: 'btn', type: 'button', text: l, onclick: () => { t.follow = Date.now() + ms; upd(); toast('هفكّرك تراجع مع ' + who + ' ' + fmtTs(t.follow)); } })));
  box.append(quick);
  const toLocal = (ts) => { const d = new Date(ts); return dstr(d) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  box.append(h('label', null, 'أو حدد يوم وساعة',
    h('input', { class: 'field', type: 'datetime-local', value: t.follow ? toLocal(t.follow) : '', onchange: (e) => { const v = e.target.value; t.follow = v ? new Date(v).getTime() : 0; upd(); } })));
  if (t.follow) box.append(h('div', { class: 'acts' },
    h('span', { class: 'kind', text: 'المراجعة ' + fmtTs(t.follow) }),
    h('button', { class: 'btn ghost', type: 'button', text: 'إلغاء المتابعة', onclick: () => { t.follow = 0; upd(); } })));
  if (t.lastReview) box.append(h('span', { class: 'kind', text: 'آخر مراجعة ' + rel(t.lastReview) }));
  return box;
}

function taskRow(p, t) {
  const isOpen = openTask === t.id, dk = dueKind(t);
  const meta = [];
  if (t.who) meta.push(h('span', { class: 'who', text: t.who }));
  if (t.kind === 'm') meta.push(h('span', { class: 'stg' + (t.stage === 2 ? ' ready' : ''), text: STAGES[t.stage || 0] + (t.office ? '، ' + t.office : '') }));
  if (t.date) meta.push(h('span', { class: 'when ' + dk, text: (dk === 'over' ? 'فات: ' : '') + fmtDue(t) }));
  if (t.follow && t.s !== 2) meta.push(h('span', { class: 'fol' + (t.follow <= Date.now() ? ' when over' : ''), text: 'مراجعة ' + fmtTs(t.follow) }));
  const li = h('li', { class: 'task' + (t.s === 2 ? ' done' : t.s === 1 ? ' doing' : ''), id: 't-' + t.id },
    h('button', { class: 'st', 'data-s': t.s, 'aria-label': t.kind === 'm' ? STAGES[t.stage || 0] + '. اضغط للمرحلة الجاية' : t.s === 0 ? 'لسه. اضغط عشان تبدأ' : t.s === 1 ? 'شغال. اضغط لما تخلص' : 'خلصت. اضغط ترجّعها', onclick: () => cycle(p, t) }),
    h('div', { class: 'tbody' },
      h('input', { class: 'ttext', value: t.text, 'aria-label': 'الخطوة', onchange: (e) => { const v = e.target.value.trim(); if (!v) { e.target.value = t.text; return; } t.text = v; touch(p); save(); renderList(); } }),
      meta.length ? h('div', { class: 'tmeta' }, ...meta) : null),
    h('button', { class: 'more', 'aria-expanded': isOpen ? 'true' : 'false', 'aria-label': 'المسؤول والميعاد والمتابعة', title: 'المسؤول والميعاد والمتابعة', text: '⋯', onclick: () => { openTask = isOpen ? null : t.id; renderDetail(); } }),
    h('button', { class: 'del', 'aria-label': 'امسح الخطوة', title: 'امسح', text: '×', onclick: () => { p.tasks = p.tasks.filter((x) => x !== t); touch(p); save(); render(); } }));
  if (isOpen) li.append(editPanel(p, t));
  return li;
}

function renderDetail() {
  detail.replaceChildren();
  const p = selected && find(selected);
  if (!p) { detail.append(h('div', { class: 'pick', text: state.projects.length ? 'اختار مشروع من القايمة عشان تشوف خطته ووقفت فين.' : 'أول ما تضيف مشروع هتلاقي خطته هنا.' })); return; }
  const g = prog(p);
  detail.append(h('button', { class: 'btn ghost back', onclick: goHome, text: '→ كل المشاريع' }));

  const title = h('h2', { class: 'ptitle', title: 'اضغط عشان تغيّر الاسم' }, h('span', { class: 'hl', text: p.name }));
  title.addEventListener('click', () => {
    if (title.querySelector('input')) return;
    const inp = h('input', { value: p.name, 'aria-label': 'اسم المشروع' });
    const done = () => { const v = inp.value.trim(); if (v && v !== p.name) { p.name = v; touch(p); save(); } render(); };
    inp.addEventListener('blur', done);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } if (e.key === 'Escape') { inp.value = p.name; inp.blur(); } });
    title.replaceChildren(inp); inp.focus(); inp.select();
  });
  detail.append(title);
  detail.append(h('p', { class: 'pmeta', text: (g.t ? n(g.d) + ' من ' + n(g.t) + ' خطوات خلصت (' + n(g.pct) + '٪)' : 'لسه مفيش خطوات') + (p.updatedAt ? '. آخر تعديل ' + rel(p.updatedAt) : '') }));

  const stamp = h('small', { text: p.noteAt ? 'اتكتبت ' + rel(p.noteAt) : '' });
  detail.append(h('div', { class: 'sec' }, h('span', { text: 'وقفت فين؟' }), stamp));
  const ta = h('textarea', { class: 'note', placeholder: 'آخر حاجة عملتها، ومستني إيه، والخطوة الجاية…', 'aria-label': 'وقفت فين' });
  ta.value = p.note || '';
  ta.addEventListener('input', () => { p.note = ta.value; p.noteAt = Date.now(); touch(p); stamp.textContent = 'اتكتبت النهارده'; save(); renderList(); });
  detail.append(ta);
  const nx = nextStep(p);
  if (nx) detail.append(h('div', { class: 'next' }, h('span', { text: nx.s === 1 ? 'شغال في:' : 'الخطوة الجاية:' }), h('span', { text: nx.text })));

  const open = p.tasks.filter((t) => t.s !== 2), closed = p.tasks.filter((t) => t.s === 2);
  detail.append(h('div', { class: 'sec' }, h('span', { text: 'الخطة' }), h('small', { text: open.length ? n(open.length) + ' فاضلين' : '' })));
  const ul = h('ul', { class: 'tasks' }); open.forEach((t) => ul.append(taskRow(p, t))); detail.append(ul);

  const addIn = h('input', { class: 'field', placeholder: 'أضف خطوة…', 'aria-label': 'خطوة جديدة' });
  detail.append(h('form', { class: 'addt', autocomplete: 'off', onsubmit: (e) => {
    e.preventDefault(); const v = addIn.value.trim(); if (!v) return;
    p.tasks.push({ id: uid(), text: v, s: 0 }); touch(p); save(); render();
    const f = detail.querySelector('.addt input'); if (f) f.focus();
  } }, addIn, h('button', { class: 'btn', type: 'submit', text: 'إضافة' })));
  detail.append(h('p', { class: 'legend', text: 'الدايرة: فاضية = لسه، نصها = شغال، مليانة = خلصت. ودوس ⋯ عشان تحدد المسؤول والميعاد والمتابعة، أو تعلّمها معاملة.' }));

  if (closed.length) {
    const dg = h('details', { class: 'donegrp' }, h('summary', { text: 'خلصت (' + n(closed.length) + ')' }));
    const ul2 = h('ul', { class: 'tasks' }); closed.forEach((t) => ul2.append(taskRow(p, t))); dg.append(ul2);
    if (closed.some((t) => t.id === openTask)) dg.open = true;
    detail.append(dg);
  }

  const delBtn = h('button', { class: 'btn danger', text: 'امسح المشروع' });
  let armed = false, t0;
  delBtn.addEventListener('click', () => {
    if (!armed) { armed = true; delBtn.textContent = 'متأكد؟ اضغط تاني'; t0 = setTimeout(() => { armed = false; delBtn.textContent = 'امسح المشروع'; }, 3500); return; }
    clearTimeout(t0); state.projects = state.projects.filter((x) => x !== p); save(); goHome();
  });
  detail.append(h('div', { class: 'dfoot' }, delBtn));
}

/* ---------------- add project ---------------- */
const addForm = $('addForm'), addName = $('addName');
function openAdd() { addForm.classList.add('open'); addName.focus(); }
$('addBtn').addEventListener('click', () => (addForm.classList.contains('open') ? addForm.classList.remove('open') : openAdd()));
addForm.addEventListener('submit', (e) => {
  e.preventDefault(); const v = addName.value.trim(); if (!v) return;
  const p = { id: 'p' + uid(), name: v, note: '', noteAt: 0, tasks: [], createdAt: Date.now(), updatedAt: Date.now() };
  state.projects.push(p); addName.value = ''; addForm.classList.remove('open'); save(); select(p.id);
});
$('q').addEventListener('input', (e) => { query = e.target.value; renderList(); });

/* ---------------- settings sheet ---------------- */
function closeSheet() { $('sheetRoot').replaceChildren(); }
$('menuBtn').addEventListener('click', () => {
  const box = h('div', { class: 'box', role: 'dialog', 'aria-label': 'الإعدادات' });
  box.append(h('h2', { text: 'الإعدادات' }));
  if (cloud && cloud.user) box.append(h('p', { class: 'muted', text: 'داخل بـ ' + cloud.user.email }));
  else box.append(h('p', { class: 'muted', text: 'وضع تجريبي: البيانات على الجهاز ده بس. حط بيانات Firebase في firebase-config.js عشان تتزامن.' }));

  if (LN) {
    box.append(h('button', { class: 'btn', text: 'جرّب التذكير (هيجيلك إشعار بعد ٥ ثواني)', onclick: async () => {
      try {
        let perm = await LN.checkPermissions(); if (perm.display !== 'granted') perm = await LN.requestPermissions();
        if (perm.display !== 'granted') { toast('الإشعارات مقفولة. افتحها من إعدادات التليفون للتطبيق.'); return; }
        try { await LN.createChannel({ id: 'reminders', name: 'تذكيرات المهام', importance: 5, visibility: 1, vibration: true }); } catch (e) {}
        await LN.schedule({ notifications: [{ id: 99, title: 'مشاريعي', body: 'التذكيرات شغالة تمام 👍', channelId: 'reminders', schedule: { at: new Date(Date.now() + 5000), allowWhileIdle: true } }] });
        toast('اقفل التطبيق واستنى ٥ ثواني');
      } catch (e) { toast('حصلت مشكلة في الإشعارات'); }
    } }));
  } else if ('Notification' in window) {
    box.append(h('button', { class: 'btn', text: Notification.permission === 'granted' ? 'تنبيهات المتصفح شغالة' : 'فعّل تنبيهات المتصفح (وهو مفتوح)', onclick: async () => {
      const r = await Notification.requestPermission(); toast(r === 'granted' ? 'تمام، هتجيلك تنبيهات طول ما الصفحة مفتوحة' : 'التنبيهات مقفولة'); scheduleNotifs(); closeSheet();
    } }));
  }
  box.append(h('button', { class: 'btn', text: 'استيراد بيانات (ملف JSON)', onclick: () => $('importFile').click() }));
  if (!isNative) box.append(h('button', { class: 'btn', text: 'تصدير نسخة احتياطية', onclick: exportData }));
  if (cloud && cloud.user) box.append(h('button', { class: 'btn danger', text: 'خروج', onclick: async () => { closeSheet(); await cloud.signOut(); } }));
  box.append(h('button', { class: 'btn ghost', text: 'قفل', onclick: closeSheet }));
  const sh = h('div', { class: 'sheet', onclick: (e) => { if (e.target === sh) closeSheet(); } }, box);
  $('sheetRoot').replaceChildren(sh);
});
function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: 'mashari3-backup-' + todayStr() + '.json' });
  document.body.append(a); a.click(); a.remove();
}
$('importFile').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!valid(d)) throw new Error('bad');
    let added = 0;
    d.projects.forEach((p) => { if (!p || !p.id || !Array.isArray(p.tasks)) return; if (!find(p.id)) { state.projects.push(p); added++; } });
    save(); render(); closeSheet(); toast(added ? 'اتضاف ' + n(added) + ' مشاريع' : 'المشاريع دي موجودة عندك بالفعل');
  } catch (err) { toast('الملف ده مش ملف بيانات مشاريعي'); }
});

/* ---------------- auth & startup ---------------- */
function showApp() { $('login').classList.add('hidden'); $('app').classList.remove('hidden'); }
function showLogin() { $('app').classList.add('hidden'); $('login').classList.remove('hidden'); }
function loadLocal() { try { const raw = localStorage.getItem(LKEY); if (raw) { const d = JSON.parse(raw); if (valid(d)) state = d; } } catch (e) {} }

const AUTH_ERR = {
  'auth/invalid-credential': 'الإيميل أو الباسورد غلط.',
  'auth/wrong-password': 'الباسورد غلط.',
  'auth/user-not-found': 'مفيش حساب بالإيميل ده. دوس «اعمل حساب».',
  'auth/email-already-in-use': 'الإيميل ده عليه حساب بالفعل. ادخل بيه.',
  'auth/weak-password': 'الباسورد لازم ٦ حروف على الأقل.',
  'auth/invalid-email': 'الإيميل مكتوب غلط.',
  'auth/network-request-failed': 'مفيش نت. اتأكد من الاتصال وجرّب تاني.',
  'auth/too-many-requests': 'محاولات كتير. استنى شوية وجرّب.',
  'auth/operation-not-allowed': 'لازم تفعّل الدخول بالإيميل في Firebase (Authentication > Sign-in method).',
};

async function startCloud() {
  let A, F, app;
  try {
    const [core, a, f] = await Promise.all([import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-firestore.js')]);
    A = a; F = f; app = core.initializeApp(CFG);
  } catch (e) {
    console.warn(e); loadLocal(); showApp(); render(); setSync('offline');
    $('banner').textContent = 'مش قادر أوصل للسيرفر. شغال على النسخة المحفوظة على الجهاز، واتأكد من النت.';
    $('banner').classList.remove('hidden'); return;
  }
  const auth = A.initializeAuth(app, { persistence: [A.indexedDBLocalPersistence, A.browserLocalPersistence] });
  let db;
  try { db = F.initializeFirestore(app, { localCache: F.persistentLocalCache() }); } catch (e) { db = F.getFirestore(app); }

  const err = $('loginErr');
  const run = async (fn) => {
    err.textContent = ''; $('loginBtn').disabled = true;
    try { await fn(auth, $('email').value.trim(), $('pass').value); }
    catch (e) { err.textContent = AUTH_ERR[e.code] || ('حصلت مشكلة: ' + (e.code || e.message)); }
    $('loginBtn').disabled = false;
  };
  $('loginForm').addEventListener('submit', (e) => { e.preventDefault(); run(A.signInWithEmailAndPassword); });
  $('signupBtn').addEventListener('click', () => { if (!$('loginForm').reportValidity()) return; run(A.createUserWithEmailAndPassword); });
  $('resetBtn').addEventListener('click', async () => {
    const em = $('email').value.trim(); if (!em) { err.textContent = 'اكتب الإيميل الأول.'; return; }
    try { await A.sendPasswordResetEmail(auth, em); err.textContent = 'بعتنالك إيميل تغيّر منه الباسورد.'; } catch (e) { err.textContent = AUTH_ERR[e.code] || 'حصلت مشكلة.'; }
  });

  let unsub = null;
  A.onAuthStateChanged(auth, (user) => {
    if (unsub) { unsub(); unsub = null; }
    if (!user) { cloud = null; state = { projects: [] }; showLogin(); return; }
    const ref = F.doc(db, 'users', user.uid, 'data', 'board');
    cloud = { ref, setDoc: F.setDoc, user, signOut: () => { try { localStorage.removeItem(LKEY); } catch (e) {} return A.signOut(auth); } };
    loadLocal(); showApp(); render();
    unsub = F.onSnapshot(ref, { includeMetadataChanges: true }, (snap) => {
      setSync(snap.metadata.fromCache && !navigator.onLine ? 'offline' : 'ok');
      if (snap.metadata.hasPendingWrites || dirty) return;
      const d = snap.exists() ? snap.data() : null;
      if (valid(d)) applyRemote(d);
      else if (!snap.metadata.fromCache && state.projects.length) save();
    }, (e) => { console.warn(e); setSync('err'); });
  });
}

window.addEventListener('online', () => { if (cloud) setSync('ok'); });
window.addEventListener('offline', () => setSync('offline'));
setInterval(() => { const a = document.activeElement; if (!(a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'))) renderList(); }, 60000);

if (CFG) startCloud();
else {
  loadLocal(); showApp(); render(); setSync('local'); scheduleNotifs();
  $('banner').textContent = 'وضع تجريبي: البيانات محفوظة على الجهاز ده بس لحد ما تضيف بيانات Firebase.';
  $('banner').classList.remove('hidden');
}
