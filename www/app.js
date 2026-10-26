/* مشاريعي: خطط المشاريع، الفريق، المتابعات، المعاملات، المشاركة والتذكيرات */
const CFG = window.FIREBASE_CONFIG;
const CAP = window.Capacitor;
const isNative = !!(CAP && CAP.isNativePlatform && CAP.isNativePlatform());
const LN = isNative && CAP.registerPlugin ? CAP.registerPlugin('LocalNotifications') : null;
const FB = 'https://www.gstatic.com/firebasejs/11.10.0/';
const LKEY = 'mashari3-board', LANGKEY = 'mashari3-lang';
const WEB_URL = 'https://medosallam81-prog.github.io/mashari3/';
const APK_URL = WEB_URL + 'mashari3.apk';

let state = { projects: [], team: [], profile: {} };
let selected = null, openTask = null, openAssigned = null, query = '';
let cloud = null;           // {db, F, ref, user, signOut}
let writing = false, pending = false, timer = null, dirty = false, lastWritten = '';
let toMe = [];              // مهام متبعتالي من ناس تانية
let ownerSharedReady = false;
let filesCache = {}, fileSub = { key: '', unsub: null };
let deptFilter = ''; try { deptFilter = localStorage.getItem('mashari3-dept') || ''; } catch (e) {}
const projOK = (p) => !deptFilter || p.dept === deptFilter;
const dept = (id) => (state.depts || []).find((d) => d.id === id);
const myName = () => (state.profile.name || '').trim() || (cloud && cloud.user ? cloud.user.email : '') || t('me');
const NKEY = 'mashari3-notified';
let myOrg = null, orgResolved = false, orgTasks = [], openOrg = null, customFollow = null, pendingOpen = null;
const openSecs = new Set();
{ const m = (location.hash || '').match(/^#a_(\w+)/); if (m) pendingOpen = m[1]; }
let notified = new Set(); try { notified = new Set(JSON.parse(localStorage.getItem(NKEY) || '[]')); } catch (e) {}
function markNotified(k) { notified.add(k); try { localStorage.setItem(NKEY, JSON.stringify([...notified].slice(-300))); } catch (e) {} }

const $ = (id) => document.getElementById(id);
const plist = $('plist'), detail = $('detail'), nowEl = $('now');

/* ---------------- language ---------------- */
function detectLang() {
  const list = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'ar']).map((x) => String(x).toLowerCase());
  for (const l of list) {
    if (l.startsWith('ar')) return 'ar';
    if (/^(sr|me|cnr|hr|bs|sh)/.test(l)) return 'me';
    if (l.startsWith('en')) return 'en';
  }
  return 'en';
}
let lang = null;
try { lang = localStorage.getItem(LANGKEY); } catch (e) {}
if (!lang || !window.L[lang]) lang = detectLang();
function t(k, ...a) { const d = window.L[lang], v = d[k] !== undefined ? d[k] : window.L.ar[k]; return typeof v === 'function' ? v(...a) : v; }
function loc() {
  const want = t('locale');
  try { if (Intl.DateTimeFormat.supportedLocalesOf([want]).length) return want; } catch (e) {}
  return lang === 'me' ? 'hr' : want;
}
function applyLang() {
  document.documentElement.lang = lang === 'me' ? 'sr-Latn-ME' : lang;
  document.documentElement.dir = t('dir');
  document.title = t('appName');
  $('loginTitle').textContent = t('appName'); $('brand').textContent = t('appName');
  $('loginSub').textContent = t('loginSub');
  $('email').placeholder = t('email'); $('pass').placeholder = t('passPh');
  $('loginBtn').textContent = t('login'); $('signupBtn').textContent = t('signup'); $('resetBtn').textContent = t('forgot');
  $('addBtn').textContent = t('addProject'); $('addName').placeholder = t('newProjectPh'); $('addName').setAttribute('aria-label', t('newProjectPh'));
  $('addSubmit').textContent = t('add'); $('q').placeholder = t('searchPh');
  $('menuBtn').setAttribute('aria-label', t('settings')); $('menuBtn').title = t('settings');
  setSync(syncKind); if (bannerKey) setBanner(bannerKey);
  const ll = $('loginLangs');
  if (ll) {
    ll.replaceChildren();
    ['ar', 'en', 'me'].forEach((l) => ll.append(h('button', { class: 'chip', type: 'button', 'aria-pressed': lang === l ? 'true' : 'false', text: window.L[l].langName, onclick: () => setLang(l) })));
  }
  const lb = $('langBtn');
  if (lb) { lb.textContent = { ar: 'ع', en: 'EN', me: 'ME' }[lang]; lb.title = t('language'); lb.setAttribute('aria-label', t('language')); }
}
function setLang(l) { lang = l; try { localStorage.setItem(LANGKEY, l); } catch (e) {} applyLang(); render(); scheduleNotifs(); }

/* ---------------- helpers ---------------- */
const n = (x) => Number(x).toLocaleString(loc());
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
  if (d <= 0) return t('today'); if (d === 1) return t('yesterday'); if (d === 2) return t('twoDays');
  return t('daysAgo', n(d), d > 10);
}
function norm(x) { return (x || '').trim().replace(/\s+/g, ' ').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').toLowerCase(); }
function dstr(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
const todayStr = () => dstr(new Date());
function dueTs(x) { return x.date ? new Date(x.date + 'T' + (x.time || '09:00')).getTime() : 0; }
function fmtTs(ts, withTime = true) {
  const d = new Date(ts), ds = dstr(d);
  const tm = new Date(); tm.setDate(tm.getDate() + 1);
  let s = ds === todayStr() ? t('today') : ds === dstr(tm) ? t('tomorrow') : d.toLocaleDateString(loc(), { weekday: 'long', day: 'numeric', month: 'long' });
  if (withTime) s += ' ' + d.toLocaleTimeString(loc(), { hour: 'numeric', minute: '2-digit' });
  return s;
}
function fmtDue(x) { return x.date ? fmtTs(dueTs(x), !!x.time) : ''; }
function dueKind(x) {
  if (!x.date || x.s === 2) return '';
  const td = todayStr();
  if (x.date < td) return 'over';
  if (x.date === td) return (x.time && dueTs(x) < Date.now()) ? 'over' : 'today';
  return '';
}
const STG = () => t('stages');
function setStage(x, k) { x.stage = k; x.s = k === 3 ? 2 : k === 0 ? 0 : 1; }
function prog(p) { const a = p.tasks.length, d = p.tasks.filter((x) => x.s === 2).length; return { t: a, d, pct: a ? Math.round(d / a * 100) : 0 }; }
function nextStep(p) { return p.tasks.find((x) => x.s === 1) || p.tasks.find((x) => x.s === 0); }
const find = (id) => state.projects.find((p) => p.id === id);
const touch = (p) => { p.updatedAt = Date.now(); };
const activeProjects = () => state.projects.filter((p) => !p.archived);
const allTasksF = () => allTasks().filter(({ p }) => projOK(p));
function allTasks() { const r = []; state.projects.forEach((p) => p.tasks.forEach((x) => r.push({ p, t: x }))); return r; }
function member(name) { const k = norm(name); return k ? (state.team || []).find((m) => norm(m.name) === k) : null; }
function people() {
  const m = {};
  (state.team || []).forEach((x) => { if (x.name) m[norm(x.name)] = { name: x.name, open: 0, doing: 0, done: 0 }; });
  allTasks().forEach(({ t: x }) => {
    const w = (x.who || '').trim(); if (!w) return; const k = norm(w);
    m[k] = m[k] || { name: w, open: 0, doing: 0, done: 0 };
    if (x.s === 2) m[k].done++; else { m[k].open++; if (x.s === 1) m[k].doing++; }
  });
  return Object.values(m).sort((a, b) => b.open - a.open);
}
function statusTag(x) {
  if (x.kind === 'm') return h('span', { class: 'tag' + (x.stage === 2 ? ' doing' : x.s === 2 ? ' done' : ''), text: STG()[x.stage || 0] });
  return h('span', { class: 'tag' + (x.s === 1 ? ' doing' : x.s === 2 ? ' done' : ''), text: x.s === 0 ? t('sTodo') : x.s === 1 ? t('sDoing') : t('sDone') });
}
function toast(msg) { const el = h('div', { class: 'toast', role: 'status', text: msg }); document.body.append(el); setTimeout(() => el.remove(), 2800); }
function openExternal(url) {
  if (isNative) { const a = h('a', { href: url }); document.body.append(a); a.click(); a.remove(); }
  else window.open(url, '_blank', 'noopener');
}

/* ---------------- storage ---------------- */
function normalizeState() {
  if (!Array.isArray(state.team)) state.team = [];
  if (!state.profile || typeof state.profile !== 'object') state.profile = {};
  if (!Array.isArray(state.depts) || !state.depts.length) state.depts = t('deptDefaults').map(([icon, name], i) => ({ id: 'd' + (i + 1), icon, name }));
  if (!Array.isArray(state.templates)) state.templates = [];
}
function saveLocal() { try { localStorage.setItem(LKEY, JSON.stringify(state)); } catch (e) {} }
let syncKind = 'local', bannerKey = '';
function setBanner(k) { bannerKey = k; $('banner').textContent = t(k); $('banner').classList.remove('hidden'); }
function setSync(kind) {
  syncKind = kind;
  const el = $('sync'); el.className = 'sync ' + kind;
  el.lastChild.textContent = t({ ok: 'syncOk', err: 'syncErr', saving: 'syncSaving', offline: 'syncOffline', local: 'syncLocal' }[kind]);
}
function processRepeats() {
  const N = { d: 1, w: 7, m: 0 };
  state.projects.forEach((p) => {
    p.tasks.slice().forEach((x) => {
      if (!x.repeat || x.s !== 2 || x.repeated) return;
      x.repeated = true;
      const base = x.date ? new Date(x.date + 'T12:00') : new Date();
      if (x.repeat === 'm') base.setMonth(base.getMonth() + 1); else base.setDate(base.getDate() + N[x.repeat]);
      if (dstr(base) < todayStr()) { const t0 = new Date(); base.setFullYear(t0.getFullYear(), t0.getMonth(), t0.getDate() + (x.repeat === 'd' ? 1 : x.repeat === 'w' ? 7 : 30)); }
      const nx = { id: uid(), text: x.text, s: 0, who: x.who || '', brief: x.brief || '', urgent: !!x.urgent, repeat: x.repeat, date: dstr(base), time: x.time || '' };
      if (x.shareEmail) nx.shareEmail = x.shareEmail;
      p.tasks.push(nx);
    });
  });
}
function stampTimes() {
  const now = Date.now();
  allTasks().forEach(({ t: x }) => {
    if (x.s >= 1 && !x.startedAt) x.startedAt = now;
    if (x.s === 2 && !x.doneAt) x.doneAt = now;
    if (x.s !== 2 && x.doneAt) { delete x.doneAt; if (x.review === 'ok') delete x.review; }
    if (x.s === 0 && x.startedAt) delete x.startedAt;
  });
}
function save() {
  processRepeats(); stampTimes();
  dirty = true; saveLocal(); scheduleNotifs();
  if (!cloud) { dirty = false; return; }
  setSync('saving');
  clearTimeout(timer); timer = setTimeout(() => { timer = null; flush(); }, 700);
}
async function flush() {
  if (!cloud) return;
  if (writing) { pending = true; return; }
  writing = true;
  pushShared();
  const body = JSON.stringify(state);
  try { await cloud.F.setDoc(cloud.ref, JSON.parse(body)); lastWritten = body; setSync(navigator.onLine ? 'ok' : 'offline'); }
  catch (e) { console.warn(e); setSync('err'); }
  writing = false;
  if (pending) { pending = false; flush(); return; }
  if (!timer) dirty = false;
}
const valid = (d) => d && Array.isArray(d.projects);
function applyRemote(data) {
  const s = JSON.stringify(data); if (s === lastWritten) return;
  lastWritten = s; state = JSON.parse(s); normalizeState(); saveLocal(); scheduleNotifs();
  if (selected && !find(selected)) selected = null;
  const a = document.activeElement;
  if (a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT') && !a.closest('.listcol')) renderList(); else render();
}

/* ---------------- sharing (app-to-app) ---------------- */
function shareFields(p, x) {
  return {
    ownerUid: cloud.user.uid, ownerEmail: (cloud.user.email || '').toLowerCase(),
    ownerName: (state.profile.name || '').trim() || cloud.user.email || '',
    assigneeEmail: x.shareEmail, assigneeName: x.who || '',
    projectName: p.name, text: x.text, date: x.date || '', time: x.time || '',
    kind: x.kind || '', stage: x.stage || 0, office: x.office || '', ref: x.ref || '', s: x.s,
    taskId: x.id, brief: x.brief || '', urgent: !!x.urgent, checks: x.checks || [], org: orgUid(),
  };
}
function shareHash(p, x) { return JSON.stringify([p.name, x.text, x.date, x.time, x.kind, x.stage, x.office, x.ref, x.s, x.shareEmail, x.who, state.profile.name, x.brief, x.urgent, x.checks, orgUid()]); }
let pendingUnshare = [];
function unshare(x) { if (x.shareId) pendingUnshare.push(x.shareId); delete x.shareId; delete x.shareEmail; delete x._sh; delete x.seenAt; delete x.reply; }
function pushShared() {
  if (!cloud || !cloud.user) return;
  const { F, db } = cloud;
  pendingUnshare.splice(0).forEach((sid) => {
    F.deleteDoc(F.doc(db, 'shared', sid)).catch((e) => console.warn(e));
    ownerFiles((d) => F.updateDoc(d.ref, { assigneeEmail: '', shareId: '' }).catch(() => {}), ['shareId', sid]);
  });
  if (!ownerSharedReady || !orgResolved) return;
  allTasks().forEach(({ p, t: x }) => {
    if (!x.shareEmail) return;
    if (!x.shareId) x.shareId = cloud.user.uid.slice(0, 8) + '_' + uid() + uid();
    const hsh = shareHash(p, x);
    if (hsh === x._sh) return;
    const first = !x._sh;
    if (first) linkFiles(x);
    const now = Date.now();
    x._sh = hsh; x.shAt = now;
    const payload = { ...shareFields(p, x), updatedBy: 'owner', updatedAt: now };
    if (first) { if (!(x.log || []).some((e) => e.a === 'assigned')) (x.log = x.log || []).push({ a: 'assigned', by: myName(), at: now }); payload.log = F.arrayUnion(...x.log); }
    F.setDoc(F.doc(db, 'shared', x.shareId), payload, { merge: true }).catch((e) => console.warn('share', e));
  });
}
function mergeFromShared(sid, d) {
  const hit = allTasks().find(({ t: x }) => x.shareId === sid); if (!hit) return;
  const { p, t: x } = hit;
  let changed = false, note = '';
  if (d.seenAt && d.seenAt !== x.seenAt) { x.seenAt = d.seenAt; changed = true; }
  if (Array.isArray(d.log) && d.log.length > (x.log || []).length) {
    const fresh = d.log.slice((x.log || []).length);
    x.log = d.log; changed = true;
    const last = fresh.filter((e) => e.by !== myName() && e.a === 'msg').pop();
    if (last) note = '💬 ' + last.m;
  }
  if (d.updatedBy === 'assignee' && (d.updatedAt || 0) > (x.shAt || 0)) {
    if (d.s !== x.s || (x.kind === 'm' && d.stage !== x.stage)) {
      if (x.kind === 'm') setStage(x, d.stage || 0); else x.s = d.s;
      if (x.s === 2) { x.follow = 0; x.review = 'pending'; }
      note = x.kind === 'm' ? STG()[x.stage || 0] : (x.s === 2 ? t('sDone') : x.s === 1 ? t('sDoing') : t('sTodo'));
    }
    if (Array.isArray(d.checks) && JSON.stringify(d.checks) !== JSON.stringify(x.checks || [])) { x.checks = d.checks; note = note || '☑'; }
    if ((d.reply || '') !== (x.reply || '')) { x.reply = d.reply || ''; note = note || (t('replyLabel') + x.reply); }
    if ((d.photoAt || 0) > (x.photoAt || 0)) { x.photoAt = d.photoAt; note = note || '📷'; if (filesCache['o:' + x.id]) delete filesCache['o:' + x.id]; }
    x.shAt = d.updatedAt; changed = true;
  }
  if (!changed) return;
  x._sh = shareHash(p, x); touch(p);
  if (note) {
    const msg = t('teamUpdate', x.who || d.assigneeName || '', x.text + ' (' + note + ')');
    toast(msg);
    const k = 'u:' + sid + ':' + (d.updatedAt || 0) + ':' + (d.log || []).length;
    if (!notified.has(k)) { markNotified(k); notifyNow(t('appName'), msg, { pid: p.id, tid: x.id }); }
  }
  save(); const a = document.activeElement;
  if (a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT')) renderList(); else render();
}
function updateAssigned(id, fields, entry) {
  if (!cloud) return;
  const { F, db } = cloud;
  const payload = { ...fields, updatedBy: 'assignee', updatedAt: Date.now() };
  if (entry) payload.log = F.arrayUnion({ ...entry, by: myName(), at: Date.now() });
  F.updateDoc(F.doc(db, 'shared', id), payload).catch((e) => { console.warn(e); toast(t('syncErr')); });
}
function logAdd(x, entry) {
  const e = { ...entry, by: myName(), at: Date.now() };
  (x.log = x.log || []).push(e);
  if (x.shareId && cloud && x._sh) cloud.F.updateDoc(cloud.F.doc(cloud.db, 'shared', x.shareId), { log: cloud.F.arrayUnion(e) }).catch((err) => console.warn(err));
}
function logText(e) {
  if (e.a === 'msg') return e.m;
  return (t('logA')[e.a] || e.a) + (e.m ? ' ' + e.m : '');
}
/* ---------------- automatic translation (Gemini via Firebase AI Logic) ---------------- */
let fbApp = null, aiMod = null, aiState = 'unknown';   // unknown | ok | off
const TRKEY = 'mashari3-tr';
let trCache = {}; try { trCache = JSON.parse(localStorage.getItem(TRKEY) || '{}'); } catch (e) {}
const trQueue = new Map(); let trTimer = null, trBusy = false;
const trOn = () => state.profile.translate !== false;
const AR = /[\u0600-\u06FF]/, LAT = /[A-Za-zčćžšđČĆŽŠĐ]/;
function needsTr(text) {
  if (!text || text.length < 2) return false;
  if (lang === 'ar') return LAT.test(text) && !AR.test(text);
  return AR.test(text) || (LAT.test(text) && state.profile.trLatin !== false);
}
function tr(text) {
  if (!trOn() || aiState === 'off' || !needsTr(text)) return null;
  const k = lang + '|' + text;
  if (k in trCache) return trCache[k];
  if (!trQueue.has(k)) { trQueue.set(k, text); clearTimeout(trTimer); trTimer = setTimeout(flushTr, 500); }
  return null;
}
const trT = (text) => tr(text) || text;
async function aiGenerate(prompt, json) {
  if (!fbApp) throw new Error('noapp');
  if (!aiMod) {
    const A = await import(FB + 'firebase-ai.js');
    aiMod = { A, ai: A.getAI(fbApp, { backend: new A.GoogleAIBackend() }), names: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'], i: 0 };
  }
  let last;
  for (; aiMod.i < aiMod.names.length; aiMod.i++) {
    try {
      const m = aiMod.A.getGenerativeModel(aiMod.ai, json ? { model: aiMod.names[aiMod.i], generationConfig: { responseMimeType: 'application/json' } } : { model: aiMod.names[aiMod.i] });
      const r = await m.generateContent(prompt);
      return r.response.text();
    } catch (e) { last = e; if (!/not.?found|404|not supported|unsupported|deprecat/i.test(String(e && e.message || e))) throw e; }
  }
  throw last || new Error('nomodel');
}
async function flushTr() {
  if (trBusy || !trQueue.size) return;
  trBusy = true;
  const batch = [...trQueue.entries()].slice(0, 25);
  batch.forEach(([k]) => trQueue.delete(k));
  const target = { ar: 'Egyptian Arabic', en: 'English', me: 'Montenegrin (Latin script)' }[lang];
  const prompt = 'Translate each string in this JSON array into ' + target + '. Keep names of people and places, numbers, times and emojis as they are. Keep it short and natural, like a workplace task. If a string is already in ' + target + ', return it unchanged. Reply with ONLY a JSON array of strings with the same length and order.\n' + JSON.stringify(batch.map(([, v]) => v));
  try {
    const raw = await aiGenerate(prompt);
    const out = JSON.parse(raw.replace(/```json|```/g, '').trim());
    if (Array.isArray(out) && out.length === batch.length) {
      batch.forEach(([k], i) => { if (typeof out[i] === 'string') trCache[k] = out[i]; });
      const keys = Object.keys(trCache); if (keys.length > 3000) keys.slice(0, keys.length - 3000).forEach((k) => delete trCache[k]);
      try { localStorage.setItem(TRKEY, JSON.stringify(trCache)); } catch (e) {}
      aiState = 'ok';
    }
  } catch (e) {
    console.warn('translate', e);
    aiState = 'off';
  }
  trBusy = false;
  const a = document.activeElement;
  if (!(a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'))) render();
  if (trQueue.size && aiState !== 'off') flushTr();
}
function gtLink(text) {
  const tl = { ar: 'ar', en: 'en', me: 'bs' }[lang];
  return 'https://translate.google.com/?sl=auto&tl=' + tl + '&text=' + encodeURIComponent(text) + '&op=translate';
}
function origLine(text) {
  const tt = tr(text);
  if (tt) return null;
  if (aiState === 'off' && needsTr(text)) return h('button', { class: 'iconbtn gt', type: 'button', text: '🌐', title: t('gTranslate'), 'aria-label': t('gTranslate'), onclick: () => openExternal(gtLink(text)) });
  return null;
}

function threadView(log, onSend) {
  const box = h('div', { class: 'thread' });
  const list = h('ul', { class: 'tlog' });
  (log || []).slice(-40).forEach((e) => list.append(h('li', { class: e.a === 'msg' ? 'msg' : 'evt' },
    h('b', { text: e.by || '' }), ' ', h('span', { text: e.a === 'msg' ? trT(e.m) : logText(e), title: e.a === 'msg' && tr(e.m) ? e.m : null }), h('small', { text: ' · ' + fmtTs(e.at) }))));
  if (!(log || []).length) list.append(h('li', { class: 'evt', text: t('noLog') }));
  const inp = h('input', { class: 'field', placeholder: t('msgPh') });
  const send = () => { const v = inp.value.trim(); if (!v) return; inp.value = ''; onSend(v); };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
  box.append(list, h('div', { class: 'addt' }, inp, h('button', { class: 'btn solid', type: 'button', text: t('send'), onclick: send })));
  return box;
}
function checklistView(checks, editable, onChange) {
  const box = h('div', { class: 'checks' });
  (checks || []).forEach((c) => {
    const cb = h('input', { type: 'checkbox', onchange: (e) => { c.d = e.target.checked; onChange(checks); } }); cb.checked = !!c.d;
    box.append(h('div', { class: 'citem' + (c.d ? ' done' : '') }, h('label', { class: 'check' }, cb, h('span', { text: editable ? c.t : trT(c.t) })),
      editable ? h('button', { class: 'del', type: 'button', text: '×', 'aria-label': t('deleteStep'), onclick: () => onChange(checks.filter((y) => y !== c)) }) : null));
  });
  if (editable) {
    const inp = h('input', { class: 'field', placeholder: t('checkPh') });
    const add = () => { const v = inp.value.trim(); if (!v) return; onChange([...(checks || []), { id: uid(), t: v, d: false }], true); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    box.append(h('div', { class: 'addt' }, inp, h('button', { class: 'btn', type: 'button', text: t('add'), onclick: add })));
  }
  return box;
}
const checkCount = (c) => (c && c.length ? c.filter((y) => y.d).length + '/' + c.length : '');
function startShared(F, db, user) {
  const col = F.collection(db, 'shared');
  const subs = [];
  subs.push(F.onSnapshot(F.query(col, F.where('ownerUid', '==', user.uid)), (snap) => {
    snap.docs.forEach((d) => mergeFromShared(d.id, d.data()));
    if (!ownerSharedReady) { ownerSharedReady = true; if (allTasks().some(({ t: x }) => x.shareEmail)) save(); }
  }, (e) => console.warn('owner shared', e)));
  if (user.email) subs.push(F.onSnapshot(F.query(col, F.where('assigneeEmail', '==', user.email.toLowerCase())), (snap) => {
    toMe = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => x.ownerUid !== user.uid);
    toMe.forEach((x) => {
      if (!x.seenAt) updateAssigned(x.id, { seenAt: Date.now() });
      const k = 'n:' + x.id;
      if (!notified.has(k)) { markNotified(k); if (x.s !== 2) notifyNow(t('newAssigned', x.ownerName || x.ownerEmail), x.text, { aid: x.id }); }
    });
    if (pendingOpen && toMe.some((x) => x.id === pendingOpen)) { openAssigned = pendingOpen; pendingOpen = null; select(null, false); }
    renderList(); scheduleNotifs();
  }, (e) => console.warn('assigned', e)));
  return () => subs.forEach((f) => f());
}

/* ---------------- photos & documents ---------------- */
let galCtx = {};
async function compressImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    let max = 1280, q = 0.72, out = '';
    for (let k = 0; k < 6; k++) {
      const sc = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * sc)); c.height = Math.max(1, Math.round(img.naturalHeight * sc));
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      out = c.toDataURL('image/jpeg', q);
      if (out.length < 650000) break;
      max = Math.round(max * 0.8); q = Math.max(0.5, q - 0.06);
    }
    return out;
  } finally { URL.revokeObjectURL(url); }
}
function filesQuery(key) {
  const { F, db, user } = cloud, col = F.collection(db, 'files'), id = key.slice(2);
  if (key[0] === 'g') return F.query(col, F.where('org', '==', user.uid), F.where('shareId', '==', id));
  if (key[0] === 'k') return isGM() ? F.query(col, F.where('org', '==', user.uid), F.where('taskId', '==', 'k_' + id)) : F.query(col, F.where('ownerUid', '==', user.uid), F.where('taskId', '==', 'k_' + id));
  return key[0] === 'o'
    ? F.query(col, F.where('ownerUid', '==', user.uid), F.where('taskId', '==', id))
    : F.query(col, F.where('assigneeEmail', '==', (user.email || '').toLowerCase()), F.where('shareId', '==', id));
}
function watchFiles(key) {
  if (!cloud || fileSub.key === key) return;
  if (fileSub.unsub) fileSub.unsub();
  fileSub = { key, unsub: null };
  fileSub.unsub = cloud.F.onSnapshot(filesQuery(key), (snap) => {
    filesCache[key] = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.at - b.at);
    refreshGallery(key);
  }, (e) => { console.warn('files', e); filesCache[key] = filesCache[key] || []; refreshGallery(key); });
}
const galId = (key) => 'gal-' + key.replace(':', '-');
function refreshGallery(key) { const el = document.getElementById(galId(key)); if (el) el.replaceWith(gallery(key)); }
function gallery(key) {
  const ctx = galCtx[key], box = h('div', { class: 'gal', id: galId(key) });
  if (!cloud) { box.append(h('span', { class: 'kind', text: t('needLogin') })); return box; }
  const files = filesCache[key], grid = h('div', { class: 'thumbs' });
  if (!files) grid.append(h('span', { class: 'kind', text: '…' }));
  else if (!files.length) grid.append(h('span', { class: 'kind', text: t('noPhotos') }));
  else files.forEach((f) => grid.append(h('button', { class: 'thumb', type: 'button', onclick: () => viewFile(f) },
    h('img', { src: f.data, alt: t(f.kind), loading: 'lazy' }), h('span', { class: 'tl ' + f.kind, text: t(f.kind) }))));
  box.append(grid);
  const acts = h('div', { class: 'quick' });
  (ctx.mode === 'g' ? [] : ctx.mode === 'k' ? ['doc'] : ctx.mode === 'o' ? ['before', 'after', 'doc'] : ['after', 'doc']).forEach((k) =>
    acts.append(h('button', { class: 'btn', type: 'button', text: t('add_' + k), onclick: () => pickFile(key, k) })));
  box.append(acts);
  return box;
}
function pickFile(key, kind) {
  const inp = h('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  inp.addEventListener('change', async () => { const f = inp.files[0]; inp.remove(); if (f) await uploadFile(key, kind, f); });
  document.body.append(inp); inp.click();
}
async function uploadFile(key, kind, file) {
  if (!cloud) { toast(t('needLogin')); return; }
  const ctx = galCtx[key];
  toast(t('uploading'));
  let data;
  try { data = await compressImage(file); } catch (e) { toast(t('badImage')); return; }
  if (data.length > 900000) { toast(t('tooBig')); return; }
  const { F, db, user } = cloud;
  const d = { kind, data, at: Date.now(), by: user.uid, byName: (state.profile.name || '').trim() || user.email };
  if (ctx.mode === 'k') Object.assign(d, { ownerUid: user.uid, taskId: 'k_' + ctx.x.id, org: K.kid });
  else if (ctx.mode === 'o') {
    Object.assign(d, { ownerUid: user.uid, taskId: ctx.x.id, org: orgUid() });
    if (ctx.x.shareEmail && ctx.x.shareId) Object.assign(d, { assigneeEmail: ctx.x.shareEmail, shareId: ctx.x.shareId });
  } else {
    Object.assign(d, { ownerUid: ctx.x.ownerUid, taskId: ctx.x.taskId || '', assigneeEmail: (user.email || '').toLowerCase(), shareId: ctx.x.id, org: ctx.x.org || '' });
  }
  try {
    await F.addDoc(F.collection(db, 'files'), d);
    toast(t('uploaded'));
    if (ctx.mode === 'k') { /* invoice photo */ }
    else if (ctx.mode === 'a') updateAssigned(ctx.x.id, { photoAt: Date.now() }, { a: 'photo', m: t(kind) });
    else { ctx.x.photos = (ctx.x.photos || 0) + 1; touch(ctx.p); save(); renderList(); }
  } catch (e) { console.warn(e); toast(t('uploadErr')); }
}
function viewFile(f) {
  const mine = cloud && (f.by === cloud.user.uid || f.ownerUid === cloud.user.uid);
  const box = h('div', { class: 'box viewer', role: 'dialog', 'aria-label': t(f.kind) },
    h('img', { src: f.data, alt: t(f.kind) }),
    h('p', { class: 'muted', text: t(f.kind) + ' · ' + t('photoBy', f.byName || '') + ' · ' + fmtTs(f.at) }),
    h('div', { class: 'shareline' },
      mine ? h('button', { class: 'btn danger', text: t('deletePhoto'), onclick: async () => {
        try { await cloud.F.deleteDoc(cloud.F.doc(cloud.db, 'files', f.id)); closeSheet(); } catch (e) { toast(t('uploadErr')); }
      } }) : null,
      h('button', { class: 'btn', text: t('close'), onclick: closeSheet })));
  openSheet(box);
}
function ownerFiles(cb, where) {
  if (!cloud) return;
  const { F, db, user } = cloud;
  F.getDocs(F.query(F.collection(db, 'files'), F.where('ownerUid', '==', user.uid), F.where(where[0], '==', where[1])))
    .then((snap) => snap.docs.forEach((d) => cb(d))).catch((e) => console.warn(e));
}
function linkFiles(x) { ownerFiles((d) => cloud.F.updateDoc(d.ref, { assigneeEmail: x.shareEmail, shareId: x.shareId }).catch(() => {}), ['taskId', x.id]); }
function deleteTaskFiles(x) { ownerFiles((d) => cloud.F.deleteDoc(d.ref).catch(() => {}), ['taskId', x.id]); }

/* ---------------- company / organization ---------------- */
function orgUid() { return myOrg && myOrg.orgUid ? myOrg.orgUid : (cloud && cloud.user ? cloud.user.uid : ''); }
const isGM = () => !!(cloud && myOrg && myOrg.orgUid === cloud.user.uid);
async function resolveOrg() {
  const { F, db, user } = cloud;
  try {
    const d = user.email ? await F.getDoc(F.doc(db, 'orgIndex', user.email.toLowerCase())) : null;
    myOrg = d && d.exists() && d.data().orgUid !== user.uid ? d.data() : { orgUid: user.uid, role: 'gm' };
  } catch (e) { console.warn('org', e); myOrg = { orgUid: user.uid, role: 'gm' }; }
  orgResolved = true;
  if (isGM()) { syncOrgIndex(); watchOrg(); }
  watchReports();
  setTimeout(aiBrief, 2500);
  kStart();
  save(); renderList();
}
let orgSyncTimer = null;
function headFor(m) {
  if (m.role === 'head' || m.role === 'manager' || !m.dept) return '';
  const hd = (state.team || []).find((y) => y !== m && y.role === 'head' && y.dept === m.dept && y.email);
  return hd ? hd.email.trim().toLowerCase() : '';
}
function syncOrgIndex() {
  clearTimeout(orgSyncTimer);
  orgSyncTimer = setTimeout(() => {
    if (!isGM()) return;
    const { F, db, user } = cloud;
    const now = (state.team || []).filter((m) => m.email).map((m) => m.email.trim().toLowerCase());
    (state.profile.orgSynced || []).filter((e) => !now.includes(e)).forEach((e) => F.deleteDoc(F.doc(db, 'orgIndex', e)).catch(() => {}));
    (state.team || []).filter((m) => m.email).forEach((m) => F.setDoc(F.doc(db, 'orgIndex', m.email.trim().toLowerCase()),
      { orgUid: user.uid, role: m.role || 'staff', headEmail: headFor(m), dept: m.dept || '', deptName: dept(m.dept) ? dept(m.dept).name : '', name: m.name || '', gmName: myName() }, { merge: true }).catch((e) => console.warn('orgIndex', e)));
    if (JSON.stringify(state.profile.orgSynced || []) !== JSON.stringify(now)) { state.profile.orgSynced = now; save(); }
  }, 1500);
}
let orgUnsub = null;
function watchOrg() {
  if (orgUnsub) orgUnsub();
  const { F, db, user } = cloud;
  orgUnsub = F.onSnapshot(F.query(F.collection(db, 'shared'), F.where('org', '==', user.uid)), (snap) => {
    orgTasks = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => x.ownerUid !== user.uid);
    $('orgBtn').hidden = !orgTasks.length;
    if ($('sheetRoot').querySelector('[data-org]')) openCompany();
  }, (e) => console.warn('orgTasks', e));
}
function openCompany() {
  const now = Date.now(), wk = now - 7 * 86400000;
  const box = h('div', { class: 'box', role: 'dialog', 'aria-label': t('company'), 'data-org': '1' });
  box.append(h('h2', { text: t('company') }), h('p', { class: 'muted', text: t('companyHint') }));
  const K = { open: 0, over: 0, review: 0, done7: 0 };
  orgTasks.forEach((x) => { if (x.s !== 2) { K.open++; if (dueKind(x) === 'over') K.over++; } else if ((x.updatedAt || 0) >= wk) K.done7++; });
  const tiles = h('div', { class: 'tiles' });
  [['open', 'kOpen'], ['over', 'kOver'], ['done7', 'kDone7']].forEach(([k, l]) => tiles.append(h('div', { class: 'tile' + (k === 'over' && K.over ? ' bad' : '') }, h('b', { text: n(K[k]) }), h('span', { text: t(l) }))));
  box.append(tiles);
  const groups = {};
  orgTasks.slice().sort((a, b) => (a.s === 2) - (b.s === 2) || (dueKind(b) === 'over') - (dueKind(a) === 'over')).forEach((x) => { const k = x.ownerName || x.ownerEmail; (groups[k] = groups[k] || []).push(x); });
  if (!orgTasks.length) box.append(h('p', { class: 'muted', text: t('companyEmpty') }));
  Object.entries(groups).forEach(([owner, list]) => {
    box.append(h('div', { class: 'subhead', text: '👤 ' + owner }));
    const ul = h('ul', { class: 'assigned' });
    list.forEach((x) => {
      const isOpen = openOrg === x.id, dk = dueKind(x);
      const li = h('li', null, h('div', { class: 'arow', style: 'cursor:pointer', onclick: () => { openOrg = isOpen ? null : x.id; openCompany(); } },
        statusTag(x), h('div', { class: 'tbody' }, h('div', { text: (x.urgent ? '🔴 ' : '') + trT(x.text) }),
          h('div', { class: 'from', text: '→ ' + (x.assigneeName || x.assigneeEmail) + ' · ' + x.projectName + (x.checks && x.checks.length ? ' · ☑ ' + checkCount(x.checks) : '') + (x.seenAt ? ' · 👁' : '') }),
          x.date ? h('span', { class: 'when ' + dk, text: (dk === 'over' ? t('late') : '') + fmtDue(x) }) : null)));
      if (isOpen) {
        galCtx['g:' + x.id] = { mode: 'g', x }; watchFiles('g:' + x.id);
        li.append(h('div', { class: 'areply' }, x.brief ? h('p', { class: 'brief', text: x.brief }) : null,
          gallery('g:' + x.id),
          threadView(x.log, (m) => { const e = { a: 'msg', m, by: myName(), at: Date.now() }; cloud.F.updateDoc(cloud.F.doc(cloud.db, 'shared', x.id), { log: cloud.F.arrayUnion(e) }).catch(() => toast(t('syncErr'))); })));
      }
      ul.append(li);
    });
    box.append(ul);
  });
  box.append(h('button', { class: 'btn ghost', text: t('close'), onclick: () => { openOrg = null; closeSheet(); } }));
  const sc = $('sheetRoot').querySelector('[data-org]'); const top = sc ? sc.scrollTop : 0;
  openSheet(box); box.scrollTop = top;
}

/* ---------------- presence (who installed the app) ---------------- */
let lastAnnounce = 0;
function announce() {
  if (!cloud || !cloud.user || !cloud.user.email || Date.now() - lastAnnounce < 30 * 60000) return;
  lastAnnounce = Date.now();
  const { F, db, user } = cloud;
  F.setDoc(F.doc(db, 'members', user.email.toLowerCase()), { uid: user.uid, name: (state.profile.name || '').trim(), lastSeen: Date.now(), platform: isNative ? 'android' : 'web', lang }, { merge: true }).catch((e) => console.warn('presence', e));
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) announce(); });
let memberStatus = {};
async function loadMemberStatus() {
  if (!cloud) return;
  const { F, db } = cloud;
  await Promise.all((state.team || []).filter((m) => m.email).map(async (m) => {
    const em = m.email.trim().toLowerCase();
    try { const d = await F.getDoc(F.doc(db, 'members', em)); memberStatus[em] = d.exists() ? d.data() : null; } catch (e) { memberStatus[em] = undefined; }
  }));
}
function inviteLink(m) {
  const L = window.L[m.lang || lang] || window.L[lang];
  const msg = L.inviteMsg({ name: m.name || '', apk: APK_URL, web: WEB_URL, email: (m.email || '').trim().toLowerCase(), from: (state.profile.name || '').trim() });
  const digits = m.phone ? m.phone.replace(/\D/g, '').replace(/^00/, '') : '';
  return 'https://wa.me/' + digits + '?text=' + encodeURIComponent(msg);
}

/* ---------------- voice recording → WAV ---------------- */
function b64(buf) { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }
async function toWav(blob) {
  const ab = await blob.arrayBuffer();
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const src = await ctx.decodeAudioData(ab); ctx.close && ctx.close();
  const rate = 16000, len = Math.max(1, Math.ceil(src.duration * rate));
  const off = new OfflineAudioContext(1, len, rate);
  const node = off.createBufferSource(); node.buffer = src; node.connect(off.destination); node.start();
  const out = (await off.startRendering()).getChannelData(0);
  const buf = new ArrayBuffer(44 + out.length * 2), v = new DataView(buf);
  const w = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + out.length * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, out.length * 2, true);
  for (let i = 0; i < out.length; i++) { const x = Math.max(-1, Math.min(1, out[i])); v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true); }
  return b64(buf);
}
function micButton(onAudio) {
  let rec = null, chunks = [], timer = null, t0 = 0, stream = null;
  const btn = h('button', { class: 'btn mic', type: 'button', text: '🎙 ' + t('speak') });
  const stop = () => { if (rec && rec.state !== 'inactive') rec.stop(); };
  btn.addEventListener('click', async () => {
    if (rec && rec.state === 'recording') { stop(); return; }
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) { toast(t('micDenied')); return; }
    chunks = []; rec = new MediaRecorder(stream);
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = async () => {
      clearInterval(timer); stream.getTracks().forEach((tr0) => tr0.stop());
      btn.classList.remove('rec'); btn.textContent = '⏳ ' + t('aiWorking'); btn.disabled = true;
      try { const wav = await toWav(new Blob(chunks, { type: rec.mimeType || 'audio/webm' })); await onAudio(wav); }
      catch (e) { console.warn(e); toast(t('aiFail')); }
      btn.disabled = false; btn.textContent = '🎙 ' + t('speak');
    };
    rec.start(); t0 = Date.now(); btn.classList.add('rec');
    const tick = () => { const sec = Math.floor((Date.now() - t0) / 1000); btn.textContent = '⏹ ' + t('stopRec') + ' ' + n(Math.floor(sec / 60)) + ':' + n(pad(sec % 60)); if (sec >= 60) stop(); };
    tick(); timer = setInterval(tick, 500);
  });
  return btn;
}
const aiReady = () => !!fbApp && aiState !== 'off';
const LANGNAME = () => ({ ar: 'Egyptian Arabic', en: 'English', me: 'Montenegrin (Latin script)' }[lang]);

/* ---------------- AI: speak or type → tasks ---------------- */
function inboxProject() {
  let p = state.projects.find((x) => x.inbox);
  if (!p) { p = { id: 'p' + uid(), name: t('inboxName'), inbox: true, note: '', noteAt: 0, tasks: [], createdAt: Date.now(), updatedAt: Date.now(), dept: '' }; state.projects.unshift(p); }
  return p;
}
async function aiToTasks(text, wav) {
  const d = new Date();
  const ctx = {
    today: dstr(d), weekday: d.toLocaleDateString('en-GB', { weekday: 'long' }), now: pad(d.getHours()) + ':' + pad(d.getMinutes()),
    team: (state.team || []).filter((m) => m.name).map((m) => ({ name: m.name, dept: dept(m.dept) ? dept(m.dept).name : '' })),
    projects: activeProjects().map((p) => ({ name: p.name, dept: dept(p.dept) ? dept(p.dept).name : '' })),
  };
  const prompt = 'You turn a manager\'s instructions into tasks for a hotel/restaurant/farm/maintenance company. Context JSON: ' + JSON.stringify(ctx) +
    '\nExtract every separate task. For each give: text (short task title in the same language the manager used), who (EXACT name from team if mentioned or clearly meant, else ""), project (EXACT name from projects if it fits, else ""), date (YYYY-MM-DD, resolve words like tomorrow/Thursday/after 3 days relative to today, else ""), time (HH:MM 24h or ""), urgent (true/false), checks (array of short sub-steps if listed, else []), brief (extra details or "").' +
    '\nReply ONLY as JSON: {"tasks":[...]}' + (text ? '\nInstructions:\n' + text : '\nThe instructions are in the attached audio.');
  const parts = [{ text: prompt }]; if (wav) parts.push({ inlineData: { mimeType: 'audio/wav', data: wav } });
  const raw = await aiGenerate(parts, true);
  const j = JSON.parse(raw.replace(/```json|```/g, '').trim());
  return (j.tasks || []).filter((x) => x && x.text);
}
function openVoiceTask(defProject, preset) {
  let drafts = preset || [];
  const box = h('div', { class: 'box', role: 'dialog', 'aria-label': t('aiAdd') });
  const ta = h('textarea', { class: 'field', rows: '3', placeholder: t('aiAddPh') });
  const run = async (text, wav) => {
    if (!aiReady()) { toast(t('trOff')); return; }
    toast(t('aiWorking'));
    try { drafts = await aiToTasks(text, wav); if (!drafts.length) toast(t('aiNothing')); draw(); }
    catch (e) { console.warn(e); aiState = e && /not.?found|permission|API|disabled/i.test(String(e.message || e)) ? 'off' : aiState; toast(t('aiFail')); }
  };
  const draw = () => {
    box.replaceChildren(h('h2', { text: t('aiAdd') }));
    if (!drafts.length) {
      box.append(h('p', { class: 'muted', text: t('aiAddHint') }), micButton((wav) => run('', wav)), ta,
        h('div', { class: 'shareline' }, h('button', { class: 'btn solid', type: 'button', text: '✨ ' + t('aiGo'), onclick: () => { const v = ta.value.trim(); if (v) run(v, null); } }),
          h('button', { class: 'btn ghost', type: 'button', text: t('close'), onclick: closeSheet })));
      return;
    }
    const names = [['', '—'], ...(state.team || []).filter((m) => m.name).map((m) => [m.name, m.name])];
    const projs = [['', '📥 ' + (defProject ? defProject.name : t('inboxName'))], ...activeProjects().filter((p) => !defProject || p.id !== defProject.id).map((p) => [p.id, p.name])];
    drafts.forEach((d0) => {
      if (d0.project && !d0.pid) { const pm = activeProjects().find((p) => norm(p.name) === norm(d0.project)); if (pm) d0.pid = pm.id; }
      if (d0.who && !names.some(([v]) => v === d0.who)) names.push([d0.who, d0.who]);
      box.append(h('div', { class: 'member draft' },
        h('div', { class: 'addt' }, h('input', { class: 'field', value: d0.text, onchange: (e) => { d0.text = e.target.value; } }),
          h('button', { class: 'del', type: 'button', text: '×', onclick: () => { drafts = drafts.filter((y) => y !== d0); draw(); } })),
        prop('👤 ' + t('pWho'), selectEl(names, d0.who || '', (v) => { d0.who = v; })),
        prop('📁 ' + t('project'), selectEl(projs, d0.pid || '', (v) => { d0.pid = v; })),
        prop('📅 ' + t('pDue'), h('div', { class: 'inline' },
          h('input', { class: 'field', type: 'date', value: d0.date || '', onchange: (e) => { d0.date = e.target.value; } }),
          h('input', { class: 'field', type: 'time', value: d0.time || '', onchange: (e) => { d0.time = e.target.value; } }))),
        prop('⚡ ' + t('pPriority'), selectEl([['', t('normal')], ['u', t('urgent')]], d0.urgent ? 'u' : '', (v) => { d0.urgent = v === 'u'; })),
        d0.checks && d0.checks.length ? h('p', { class: 'muted', text: '☑ ' + d0.checks.join(' · ') }) : null,
        d0.brief ? h('p', { class: 'muted', text: '📝 ' + d0.brief }) : null));
    });
    box.append(h('div', { class: 'shareline' },
      h('button', { class: 'btn solid', type: 'button', text: '✓ ' + t('aiSave', n(drafts.length)), onclick: () => {
        drafts.forEach((d0) => {
          const p = (d0.pid && find(d0.pid)) || defProject || inboxProject();
          const nt = { id: uid(), text: d0.text.trim(), s: 0 };
          if (d0.who) nt.who = d0.who; if (d0.date) nt.date = d0.date; if (d0.time) { nt.time = d0.time; if (!nt.date) nt.date = todayStr(); }
          if (d0.urgent) nt.urgent = true; if (d0.brief) nt.brief = d0.brief;
          if (d0.checks && d0.checks.length) nt.checks = d0.checks.map((c) => ({ id: uid(), t: String(c), d: false }));
          if (d0.fromReport) nt.fromReport = d0.fromReport;
          if (nt.who) autoShare(nt);
          p.tasks.push(nt); touch(p);
          if (d0.fromReport) setReport(d0.fromReport, { status: 'task', taskRef: p.name + ' / ' + nt.text });
        });
        save(); closeSheet(); render(); toast(t('aiSaved'));
      } }),
      h('button', { class: 'btn', type: 'button', text: '🎙 ' + t('again'), onclick: () => { drafts = []; draw(); } }),
      h('button', { class: 'btn ghost', type: 'button', text: t('close'), onclick: closeSheet })));
  };
  draw(); openSheet(box);
}

/* ---------------- reports (بلاغات) ---------------- */
let reportsIn = [], reportsMine = [], repSubs = [];
const staffMode = () => !!(myOrg && myOrg.role === 'staff' && !isGM() && !state.projects.length);
const KINDS = { problem: '🔧', request: '🙋', idea: '💡' };
function watchReports() {
  repSubs.forEach((f) => f()); repSubs = [];
  if (!cloud) return;
  const { F, db, user } = cloud, col = F.collection(db, 'reports');
  const merge = () => { renderList(); const b = $('inboxBtn'); const nw = reportsIn.filter((r) => r.status === 'new').length; b.hidden = !reportsIn.length; b.textContent = '📥' + (nw ? ' ' + n(nw) : ''); if ($('sheetRoot').querySelector('[data-inbox]')) openInbox(); };
  let byOrg = [], byHead = [];
  const combine = () => { const m = {}; [...byOrg, ...byHead].forEach((r) => { m[r.id] = r; }); reportsIn = Object.values(m).sort((a, b) => b.at - a.at); merge(); };
  if (isGM()) repSubs.push(F.onSnapshot(F.query(col, F.where('org', '==', user.uid)), (sn) => { byOrg = sn.docs.map((d) => ({ id: d.id, ...d.data() })); combine();
    sn.docChanges().forEach((ch) => { if (ch.type === 'added') { const r = ch.doc.data(); const k = 'r:' + ch.doc.id; if (r.status === 'new' && !notified.has(k)) { markNotified(k); notifyNow(t('newReport', r.fromName || ''), r.title || r.text, {}); } } });
  }, (e) => console.warn('reports', e)));
  if (user.email) repSubs.push(F.onSnapshot(F.query(col, F.where('headEmail', '==', user.email.toLowerCase())), (sn) => { byHead = sn.docs.map((d) => ({ id: d.id, ...d.data() })); combine(); }, (e) => console.warn('reports head', e)));
  repSubs.push(F.onSnapshot(F.query(col, F.where('fromUid', '==', user.uid)), (sn) => { reportsMine = sn.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.at - a.at); renderList(); }, (e) => console.warn('reports mine', e)));
}
function setReport(id, fields) { if (!cloud) return; cloud.F.updateDoc(cloud.F.doc(cloud.db, 'reports', id), { ...fields, updatedAt: Date.now() }).catch((e) => console.warn(e)); }
function openReport() {
  const r = { kind: 'problem', urgent: false, text: '', photo: '' };
  const box = h('div', { class: 'box', role: 'dialog', 'aria-label': t('report') });
  const ta = h('textarea', { class: 'field', rows: '3', placeholder: t('reportPh') });
  let kindRow, urg, photoImg;
  const drawKinds = () => { kindRow.replaceChildren(); ['problem', 'request', 'idea'].forEach((k) => kindRow.append(h('button', { class: 'chip', type: 'button', 'aria-pressed': r.kind === k ? 'true' : 'false', text: KINDS[k] + ' ' + t('k_' + k), onclick: () => { r.kind = k; drawKinds(); } }))); };
  kindRow = h('div', { class: 'langs' }); drawKinds();
  urg = h('input', { type: 'checkbox', onchange: (e) => { r.urgent = e.target.checked; } });
  photoImg = h('div', { class: 'thumbs' });
  const pick = () => { const inp = h('input', { type: 'file', accept: 'image/*', style: 'display:none' }); inp.addEventListener('change', async () => { const f = inp.files[0]; inp.remove(); if (!f) return; try { r.photo = await compressImage(f); photoImg.replaceChildren(h('div', { class: 'thumb' }, h('img', { src: r.photo, alt: '' }))); } catch (e) { toast(t('badImage')); } }); document.body.append(inp); inp.click(); };
  const classify = async (text, wav) => {
    const prompt = 'A staff member is reporting to their manager. Return JSON {"text": transcript or cleaned text in the SAME language they used, "title": very short title (max 8 words) in that language, "kind": "problem"|"request"|"idea", "urgent": true|false}.' + (text ? '\nReport:\n' + text : '\nThe report is in the attached audio.');
    const parts = [{ text: prompt }]; if (wav) parts.push({ inlineData: { mimeType: 'audio/wav', data: wav } });
    return JSON.parse((await aiGenerate(parts, true)).replace(/```json|```/g, '').trim());
  };
  const mic = micButton(async (wav) => {
    if (!aiReady()) { toast(t('trOff')); return; }
    try { const j = await classify('', wav); ta.value = j.text || ''; r.title = j.title || ''; if (KINDS[j.kind]) r.kind = j.kind; r.urgent = !!j.urgent; urg.checked = r.urgent; drawKinds(); }
    catch (e) { console.warn(e); toast(t('aiFail')); }
  });
  const send = h('button', { class: 'btn solid', type: 'button', text: '📤 ' + t('send'), onclick: async () => {
    r.text = ta.value.trim(); if (!r.text && !r.photo) { toast(t('reportEmpty')); return; }
    send.disabled = true;
    if (r.text && !r.title && aiReady()) { try { const j = await classify(r.text, null); r.title = j.title || ''; if (KINDS[j.kind] && r.kind === 'problem') r.kind = j.kind; if (j.urgent) r.urgent = true; } catch (e) {} }
    const { F, db, user } = cloud;
    const doc = { fromUid: user.uid, fromEmail: (user.email || '').toLowerCase(), fromName: myName(), org: myOrg ? myOrg.orgUid : '', headEmail: (myOrg && myOrg.headEmail) || '', dept: (myOrg && myOrg.deptName) || '',
      kind: r.kind, urgent: r.urgent, title: r.title || '', text: r.text, photo: r.photo || '', status: 'new', at: Date.now(), updatedAt: Date.now(), lang };
    try { await F.addDoc(F.collection(db, 'reports'), doc); closeSheet(); toast(t('reportSent')); } catch (e) { console.warn(e); toast(t('uploadErr')); send.disabled = false; }
  } });
  box.append(h('h2', { text: '🙋 ' + t('report') }), h('p', { class: 'muted', text: t('reportHint') }), mic, ta, kindRow,
    h('label', { class: 'check' }, urg, t('urgent')),
    h('div', { class: 'shareline' }, h('button', { class: 'btn', type: 'button', text: '📷 ' + t('addPhoto'), onclick: pick }), photoImg),
    h('div', { class: 'shareline' }, send, h('button', { class: 'btn ghost', type: 'button', text: t('close'), onclick: closeSheet })));
  openSheet(box);
}
const ST_R = () => ({ new: t('rNew'), seen: t('rSeen'), task: t('rTask'), done: t('rDone') });
function openInbox() {
  const box = h('div', { class: 'box', role: 'dialog', 'aria-label': t('inbox'), 'data-inbox': '1' });
  box.append(h('h2', { text: '📥 ' + t('inbox') }));
  if (!reportsIn.length) box.append(h('p', { class: 'muted', text: t('inboxEmpty') }));
  reportsIn.forEach((r) => {
    if (r.status === 'new') setReport(r.id, { status: 'seen' });
    const rep = h('input', { class: 'field', placeholder: t('replyPh'), value: r.reply || '' });
    box.append(h('div', { class: 'member' + (r.status === 'done' ? ' muted' : '') },
      h('div', { class: 'shareline' }, h('b', { text: KINDS[r.kind] + ' ' + (r.urgent ? '🔴 ' : '') + trT(r.title || r.text.slice(0, 60)) })),
      h('div', { class: 'from', text: (r.fromName || r.fromEmail) + (r.dept ? ' · ' + r.dept : '') + ' · ' + fmtTs(r.at) + ' · ' + ST_R()[r.status] }),
      r.text && r.title ? h('p', { class: 'brief', text: trT(r.text) }) : null,
      r.photo ? h('button', { class: 'thumb', type: 'button', style: 'width:96px', onclick: () => viewFile({ data: r.photo, kind: 'before', byName: r.fromName, at: r.at, id: '' }) }, h('img', { src: r.photo, alt: '' })) : null,
      r.taskRef ? h('p', { class: 'kind ok', text: '↪ ' + r.taskRef }) : null,
      h('div', { class: 'addt' }, rep, h('button', { class: 'btn', type: 'button', text: t('send'), onclick: () => { setReport(r.id, { reply: rep.value.trim() }); toast('✓'); } })),
      r.status !== 'done' ? h('div', { class: 'shareline' },
        r.status !== 'task' ? h('button', { class: 'btn solid', type: 'button', text: '↪ ' + t('toTask'), onclick: () => { closeSheet(); openVoiceTask(null, [{ text: r.title || r.text, brief: r.title ? r.text : '', urgent: !!r.urgent, fromReport: r.id }]); } }) : null,
        h('button', { class: 'btn', type: 'button', text: '✓ ' + t('rDone'), onclick: () => setReport(r.id, { status: 'done' }) })) : null));
  });
  box.append(h('button', { class: 'btn ghost', text: t('close'), onclick: closeSheet }));
  openSheet(box);
}
function renderReportsBox() {
  const el = $('reports'); el.replaceChildren();
  const canReport = !!(cloud && myOrg && !isGM());
  el.hidden = !canReport && !staffMode();
  document.body.classList.toggle('staff', staffMode());
  if (el.hidden) return;
  el.append(h('button', { class: 'btn solid big', type: 'button', text: '🙋 ' + t('report'), onclick: openReport }));
  if (reportsMine.length) {
    const ul = h('ul', { class: 'assigned' });
    reportsMine.slice(0, 8).forEach((r) => ul.append(h('li', null, h('div', { text: KINDS[r.kind] + ' ' + (r.title || r.text.slice(0, 60)) }),
      h('div', { class: 'from', text: fmtTs(r.at) + ' · ' + ST_R()[r.status] + (r.taskRef ? ' · ↪' : '') }),
      r.reply ? h('div', { class: 'rep', text: '💬 ' + trT(r.reply) }) : null)));
    el.append(h('h3', { text: t('myReports') }), ul);
  }
  if (staffMode() && !toMe.filter((x) => x.s !== 2).length) el.append(h('p', { class: 'empty', text: t('noTasksStaff') }));
}

/* ---------------- AI morning brief ---------------- */
async function aiBrief(force) {
  const el = $('brief'); if (!el) return;
  const key = 'mashari3-brief', today = todayStr();
  let cached = null; try { cached = JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) {}
  const show = (txt) => { el.replaceChildren(h('div', { class: 'shareline' }, h('b', { text: '☀️ ' + t('briefTitle') }), h('button', { class: 'iconbtn', type: 'button', text: '↻', 'aria-label': 'refresh', onclick: () => aiBrief(true) })), h('p', { text: txt })); el.hidden = false; };
  if (staffMode() || state.profile.aiBrief === false) { el.hidden = true; return; }
  if (!force && cached && cached.date === today && cached.lang === lang) { show(cached.text); return; }
  if (!aiReady() || (!force && new Date().getHours() < 5)) { el.hidden = true; return; }
  const data = { today, overdue: [], dueToday: [], reviews: [], followUps: [], newReports: reportsIn.filter((r) => r.status === 'new').map((r) => (r.fromName || '') + ': ' + (r.title || r.text).slice(0, 80)) };
  allTasks().forEach(({ p, t: x }) => {
    const line = x.text + (x.who ? ' (' + x.who + ')' : '') + ' [' + p.name + ']';
    if (x.s !== 2 && dueKind(x) === 'over') data.overdue.push(line);
    if (x.s !== 2 && x.date === today) data.dueToday.push(line);
    if (x.s === 2 && x.review === 'pending') data.reviews.push(line);
    if (x.s !== 2 && x.follow && dstr(new Date(x.follow)) <= today) data.followUps.push(line);
  });
  orgTasks.forEach((x) => { if (x.s !== 2 && dueKind(x) === 'over') data.overdue.push(x.text + ' (' + (x.assigneeName || '') + ', ' + t('fromX', x.ownerName || '') + ')'); });
  if (!data.overdue.length && !data.dueToday.length && !data.reviews.length && !data.followUps.length && !data.newReports.length) { el.hidden = true; return; }
  try {
    const txt = (await aiGenerate('You are an operations assistant for a business owner. Write a morning brief in ' + LANGNAME() + ', max 4 short lines, most important first: who is late, what needs his review, what is due today, new staff reports. Be specific with names. No greetings, no markdown.\nData: ' + JSON.stringify(data))).trim();
    try { localStorage.setItem(key, JSON.stringify({ date: today, lang, text: txt })); } catch (e) {}
    show(txt);
  } catch (e) { console.warn('brief', e); el.hidden = true; }
}

/* ---------------- WhatsApp ---------------- */
function autoShare(x) {
  const m = member(x.who);
  if (!cloud || !m || !m.email) return false;
  const em = m.email.trim().toLowerCase();
  if (x.shareEmail !== em) { if (x.shareEmail) unshare(x); x.shareEmail = em; delete x._sh; }
  if (!x.shareId) x.shareId = cloud.user.uid.slice(0, 8) + '_' + uid() + uid();
  return true;
}
function waLink(p, x) {
  const m = member(x.who);
  const shared = autoShare(x);
  const digits = m && m.phone ? m.phone.replace(/\D/g, '').replace(/^00/, '') : '';
  const L = window.L[(m && m.lang) || lang] || window.L[lang];
  let msg = L.waMsg({
    name: x.who || '', text: x.text, project: p.name, due: x.date ? fmtDue(x) : '',
    follow: x.follow && x.follow > Date.now() ? fmtTs(x.follow) : '', from: '',
  });
  if (x.brief) msg += '\n📝 ' + x.brief;
  if (x.checks && x.checks.length) msg += '\n' + x.checks.map((c) => '☐ ' + c.t).join('\n');
  if (shared) {
    msg += '\n\n' + L.waInApp(WEB_URL + '#a_' + x.shareId);
    if (memberStatus[m.email.trim().toLowerCase()] === null) msg += '\n' + L.waNoApp(APK_URL, m.email.trim().toLowerCase());
  }
  const from = (state.profile.name || '').trim(); if (from) msg += '\n\n' + from;
  return 'https://wa.me/' + digits + '?text=' + encodeURIComponent(msg);
}

/* ---------------- notifications ---------------- */
function hid(s) { let x = 7; for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0; return (Math.abs(x) % 2000000000) + 1; }
function reminders() {
  const out = [], now = Date.now();
  allTasks().forEach(({ p, t: x }) => {
    if (x.s !== 2 && x.date) {
      const at = dueTs(x);
      if (at > now) out.push({ key: x.id + ':d', at, pid: p.id, tid: x.id, title: x.kind === 'm' ? t('notifPickup') : t('notifDue'), body: x.text + ' · ' + p.name + (x.who ? ' · ' + x.who : '') });
    }
    if (x.follow && x.follow > now && x.s !== 2) out.push({ key: x.id + ':f' + x.follow, at: x.follow, pid: p.id, tid: x.id, title: t('notifFollow', x.who || t('whoDefault')), body: x.text + ' · ' + p.name });
  });
  toMe.forEach((x) => {
    if (x.s === 2 || !x.date) return;
    const at = dueTs(x);
    if (at > now) out.push({ key: 'a:' + x.id + ':' + x.date + (x.time || ''), at, aid: x.id, title: t('notifAssigned', x.ownerName || ''), body: x.text + ' · ' + x.projectName });
  });
  K.batches.forEach((b) => {
    if (!b.exp || b.status !== 'in') return;
    const d = new Date(b.exp + 'T09:00'); d.setDate(d.getDate() - 1);
    if (d.getTime() > now && d.getTime() < now + 8 * DAY) out.push({ key: 'kx:' + b.id + b.exp, at: d.getTime(), title: t('k_notifExp'), body: b.name + ' · ' + b.qty + ' ' + kl('units', b.unit) + ' · ' + t('k_expTomorrow') });
  });
  const main = out.sort((a, b) => a.at - b.at).slice(0, 50);
  if (state.profile.digest !== false) {
    for (let i = 0; i < 7; i++) {
      const d = new Date(); d.setDate(d.getDate() + i); d.setHours(9, 0, 0, 0);
      if (d.getTime() <= now) continue;
      const ds = dstr(d);
      let c = 0;
      allTasks().forEach(({ t: x }) => { if (x.s !== 2 && (x.date === ds || (x.follow && dstr(new Date(x.follow)) === ds))) c++; });
      toMe.forEach((x) => { if (x.s !== 2 && x.date === ds) c++; });
      K.batches.forEach((b) => { if (b.exp && b.exp <= ds && b.status === 'in') c++; });
      const over = i === 0 ? allTasks().filter(({ t: x }) => dueKind(x) === 'over').length : 0;
      if (c || over) main.push({ key: 'digest:' + ds + ':' + c + ':' + over, at: d.getTime(), title: t('digestTitle'), body: t('digestBody', n(c), n(over)) });
    }
  }
  return main;
}
function notifyNow(title, body, extra) {
  if (LN) {
    ensureChannel().then(() => LN.schedule({ notifications: [{ id: hid('now' + Date.now() + body), title, body, channelId: 'reminders', schedule: { at: new Date(Date.now() + 800), allowWhileIdle: true }, extra: { pid: '', tid: '', aid: '', ...extra } }] })).catch(() => {});
  } else if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
    try { const nt = new Notification(title, { body }); nt.onclick = () => { window.focus(); openFromNotif(extra); }; } catch (e) {}
  }
}
let notifTimer = null, channelMade = false, webTimers = [];
function scheduleNotifs() { clearTimeout(notifTimer); notifTimer = setTimeout(syncNotifs, 1200); }
async function ensureChannel() {
  if (channelMade) return;
  try { await LN.createChannel({ id: 'reminders', name: 'Reminders', importance: 5, visibility: 1, vibration: true }); } catch (e) {}
  channelMade = true;
}
async function syncNotifs() {
  const list = reminders();
  if (LN) {
    try {
      let perm = await LN.checkPermissions();
      if (perm.display !== 'granted') perm = await LN.requestPermissions();
      if (perm.display !== 'granted') return;
      await ensureChannel();
      const pend = await LN.getPending();
      if (pend.notifications && pend.notifications.length) await LN.cancel({ notifications: pend.notifications.map((x) => ({ id: x.id })) });
      if (list.length) await LN.schedule({
        notifications: list.map((r) => ({
          id: hid(r.key), title: r.title, body: r.body, channelId: 'reminders',
          schedule: { at: new Date(r.at), allowWhileIdle: true }, extra: { pid: r.pid || '', tid: r.tid || '', aid: r.aid || '' },
        })),
      });
    } catch (e) { console.warn('notif', e); }
    return;
  }
  webTimers.forEach(clearTimeout); webTimers = [];
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const horizon = Date.now() + 24 * 3600 * 1000;
  list.filter((r) => r.at < horizon).forEach((r) => {
    webTimers.push(setTimeout(() => {
      try { const nt = new Notification(r.title, { body: r.body, tag: r.key }); nt.onclick = () => { window.focus(); openFromNotif(r); }; } catch (e) {}
      render();
    }, r.at - Date.now()));
  });
}
function openFromNotif(x) {
  if (x.aid) { openAssigned = x.aid; select(null, false); return; }
  if (x.pid && find(x.pid)) { openTask = x.tid; select(x.pid, true); }
}
if (LN) LN.addListener('localNotificationActionPerformed', (ev) => { const x = ev && ev.notification && ev.notification.extra; if (x) openFromNotif(x); });

/* ---------------- navigation ---------------- */
if (isNative && CAP.registerPlugin) {
  const AppP = CAP.registerPlugin('App');
  AppP.addListener('backButton', () => {
    if ($('sheetRoot').firstChild) { closeSheet(); return; }
    if (K.on) { kClose(); return; }
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
  const target = id && openTask ? document.getElementById('t-' + openTask) : (!id && openAssigned ? document.getElementById('a-' + openAssigned) : null);
  if (target) { const d = target.closest('details'); if (d) d.open = true; target.scrollIntoView({ block: 'center' }); }
}
function goHome() { if (history.state && history.state.p) history.back(); else select(null, false); }
window.addEventListener('popstate', (e) => {
  const p = e.state && e.state.p;
  selected = p && find(p) ? p : null; openTask = null;
  document.body.classList.toggle('show-detail', !!selected); render();
});

/* ---------------- rendering: list ---------------- */
function render() { renderList(); renderDetail(); }

function renderDepts() {
  const box = $('depts'); box.replaceChildren();
  box.hidden = !state.projects.length;
  if (box.hidden) return;
  const cnt = (id) => allTasks().filter(({ p, t: x }) => x.s !== 2 && !p.archived && (!id || p.dept === id)).length;
  const chip = (id, label) => h('button', { class: 'chip', 'aria-pressed': deptFilter === id ? 'true' : 'false', onclick: () => {
    deptFilter = id; try { localStorage.setItem('mashari3-dept', id); } catch (e) {} renderList();
  } }, label, h('b', { text: n(cnt(id)) }));
  box.append(chip('', t('allDepts')));
  state.depts.forEach((d) => box.append(chip(d.id, d.icon + ' ' + d.name)));
}
function renderPeople() {
  const box = $('people'), dl = $('names');
  box.replaceChildren(); dl.replaceChildren();
  const all = allTasks();
  if (all.some(({ t: x }) => x.kind === 'm')) {
    const mOpen = all.filter(({ t: x }) => x.kind === 'm' && x.s !== 2).length;
    box.append(h('button', { class: 'chip', 'aria-pressed': query === ':m' ? 'true' : 'false', onclick: () => { query = query === ':m' ? '' : ':m'; $('q').value = ''; renderList(); } }, t('transactions'), h('b', { text: n(mOpen) })));
  }
  people().forEach((x) => {
    dl.append(h('option', { value: x.name }));
    box.append(h('button', { class: 'chip', 'aria-pressed': norm(query) === norm(x.name) ? 'true' : 'false', onclick: () => {
      query = norm(query) === norm(x.name) ? '' : x.name; $('q').value = query; renderList();
    } }, x.name, h('b', { text: n(x.open) })));
  });
}

function resultLine(p, x) {
  return h('li', null, h('button', { onclick: () => { openTask = x.id; select(p.id); } },
    statusTag(x), h('span', { style: 'flex:1', text: x.text }),
    x.date ? h('span', { class: 'when ' + dueKind(x), text: fmtDue(x) }) : null));
}

function renderResults() {
  const res = $('results'), home = $('home');
  res.replaceChildren();
  home.hidden = !!query.trim();
  if (!query.trim()) return;
  const all = allTasks();
  if (query === ':m') {
    const ms = all.filter(({ t: x }) => x.kind === 'm');
    [2, 1, 0, 3].forEach((k) => {
      const l = ms.filter(({ t: x }) => (x.stage || 0) === k); if (!l.length) return;
      const c = h('div', { class: 'res' }, h('h3', null, h('span', { class: k === 2 ? 'hl' : '', text: STG()[k] + ' (' + n(l.length) + ')' })));
      const ul = h('ul');
      l.forEach(({ p, t: x }) => ul.append(h('li', null, h('button', { onclick: () => { openTask = x.id; select(p.id); } },
        h('span', { style: 'flex:1', text: x.text + (x.office ? ' · ' + x.office : '') }),
        h('span', { class: 'tag', text: x.who || p.name }),
        x.date ? h('span', { class: 'when ' + dueKind(x), text: fmtDue(x) }) : null))));
      c.append(ul); res.append(c);
    });
    if (!ms.length) res.append(h('div', { class: 'empty', text: t('noTransactions') }));
    return;
  }
  const q = norm(query);
  const byWho = all.filter(({ t: x }) => norm(x.who).includes(q));
  const byText = all.filter((x) => !byWho.includes(x) && (norm(x.t.text).includes(q) || norm(x.t.office).includes(q) || norm(x.t.ref).includes(q)));
  const groups = {};
  byWho.forEach((x) => { const k = norm(x.t.who); (groups[k] = groups[k] || { name: x.t.who.trim(), items: [] }).items.push(x); });
  Object.values(groups).forEach((g) => {
    const open = g.items.filter((x) => x.t.s !== 2), doing = open.filter((x) => x.t.s === 1).length;
    const fol = open.filter((x) => x.t.follow).length, done = g.items.length - open.length;
    const card = h('div', { class: 'res' }, h('h3', null, h('span', { class: 'hl', text: g.name })),
      h('p', { class: 'sum', text: t('resultSum', n(open.length), doing ? n(doing) : 0, fol ? n(fol) : 0, done ? n(done) : 0) }));
    const byP = {};
    g.items.sort((a, b) => (a.t.s === 2) - (b.t.s === 2)).forEach((x) => { (byP[x.p.id] = byP[x.p.id] || { p: x.p, l: [] }).l.push(x.t); });
    Object.values(byP).forEach((o) => { card.append(h('h4', { text: o.p.name })); const ul = h('ul'); o.l.forEach((x) => ul.append(resultLine(o.p, x))); card.append(ul); });
    if (open.length) {
      const m = member(g.name);
      card.append(h('div', { class: 'shareline', style: 'margin-top:10px' }, h('button', { class: 'btn wa', text: t('sendTasks'), onclick: () => {
        const lines = [t('tasksFor', g.name)];
        open.forEach(({ p, t: x }) => lines.push('• ' + (x.urgent ? '🔴 ' : '') + x.text + ' (' + p.name + ')' + (x.date ? ' · ' + fmtDue(x) : '')));
        openExternal('https://wa.me/' + (m && m.phone ? m.phone.replace(/\D/g, '').replace(/^00/, '') : '') + '?text=' + encodeURIComponent(lines.join('\n')));
      } })));
    }
    res.append(card);
  });
  if (byText.length) {
    const c = h('div', { class: 'res' }, h('h3', { text: t('textMatches') })); const ul = h('ul');
    byText.forEach(({ p, t: x }) => ul.append(resultLine(p, x))); c.append(ul); res.append(c);
  }
  if (!byWho.length && !byText.length) res.append(h('div', { class: 'empty', text: t('noResults', query.trim()) }));
}

function snooze(p, x, ms) { x.follow = Date.now() + ms; touch(p); save(); render(); toast(t('remindAt', fmtTs(x.follow))); }

function renderMine() {
  const el = $('mine'); el.replaceChildren();
  const list = toMe.slice().sort((a, b) => (a.s === 2) - (b.s === 2) || (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0) || (dueTs(a) || 9e15) - (dueTs(b) || 9e15));
  const open = list.filter((x) => x.s !== 2);
  el.hidden = !open.length && !list.some((x) => x.id === openAssigned);
  if (el.hidden) return;
  el.append(h('h3', { text: t('assignedToMe') + ' (' + n(open.length) + ')' }));
  const ul = h('ul', { class: 'assigned' });
  const setS = (x, s, stage) => {
    const prev = x.s; x.s = s; if (stage !== undefined) x.stage = stage;
    const ev = s === 1 && prev !== 1 ? 'start' : s === 2 ? 'done' : s === 0 ? 'reopen' : null;
    updateAssigned(x.id, stage !== undefined ? { s, stage } : { s }, ev ? { a: ev } : null);
    if (s === 2) toast(t('doneSent'));
    renderList();
  };
  list.filter((x) => x.s !== 2 || x.id === openAssigned).forEach((x) => {
    const isOpen = openAssigned === x.id, dk = dueKind(x), cc = checkCount(x.checks);
    const st = h('button', { class: 'st', 'data-s': x.s || 0, 'aria-label': x.kind === 'm' ? t('aStage', STG()[x.stage || 0]) : (x.s === 0 ? t('aTodo') : x.s === 1 ? t('aDoing') : t('aDone')), onclick: () => {
      if (x.kind === 'm') { const k = ((x.stage || 0) + 1) % 4; setS(x, k === 3 ? 2 : k === 0 ? 0 : 1, k); }
      else setS(x, ((x.s || 0) + 1) % 3);
    } });
    const li = h('li', { id: 'a-' + x.id },
      h('div', { class: 'arow' }, st,
        h('div', { class: 'tbody', onclick: () => { openAssigned = isOpen ? null : x.id; renderList(); } },
          h('div', { text: (x.urgent ? '🔴 ' : '') + trT(x.text) }),
          h('div', { class: 'from', text: t('fromX', x.ownerName || x.ownerEmail) + ' · ' + trT(x.projectName) + (x.kind === 'm' ? ' · ' + STG()[x.stage || 0] : '') + (cc ? ' · ☑ ' + cc : '') }),
          x.date ? h('span', { class: 'when ' + dk, text: (dk === 'over' ? t('late') : '') + fmtDue(x) }) : null)));
    if (isOpen) {
      galCtx['a:' + x.id] = { mode: 'a', x }; watchFiles('a:' + x.id);
      const box = h('div', { class: 'areply' });
      if (x.kind === 'm') {
        box.append(prop('📍 ' + t('whereNow'), selectEl(STG().map((sg, k) => [String(k), sg]), String(x.stage || 0), (v) => { const k = +v; setS(x, k === 3 ? 2 : k === 0 ? 0 : 1, k); })));
      } else {
        box.append(prop('📌 ' + t('pStatus'), selectEl([['0', t('sTodo')], ['1', t('sDoing')], ['2', t('sDone')]], String(x.s || 0), (v) => setS(x, +v))));
      }
      box.append(origLine(x.text) || '');
      if (x.brief) box.append(h('p', { class: 'brief', text: trT(x.brief) }), origLine(x.brief) || '');
      if (x.checks && x.checks.length) box.append(section('a' + x.id + ':c', t('checklist'), cc, checklistView(x.checks, false, (c) => { x.checks = c; updateAssigned(x.id, { checks: c }); renderList(); }), true));
      box.append(section('a' + x.id + ':p', t('photos'), '', gallery('a:' + x.id), false));
      const am = (x.log || []).filter((e) => e.a === 'msg').length;
      box.append(section('a' + x.id + ':m', t('thread'), am ? n(am) : '', threadView(x.log, (m) => { (x.log = x.log || []).push({ a: 'msg', m, by: myName(), at: Date.now() }); updateAssigned(x.id, {}, { a: 'msg', m }); renderList(); }), am > 0));
      li.append(box);
    }
    ul.append(li);
  });
  el.append(ul);
}

function approve(p, x) { x.review = 'ok'; logAdd(x, { a: 'approved' }); touch(p); save(); render(); }
function sendBack(p, x) {
  const ta = h('textarea', { class: 'field', placeholder: t('returnPh'), rows: '3' });
  const box = h('div', { class: 'box', role: 'dialog' }, h('h2', { text: t('returnTask') }), h('p', { class: 'muted', text: x.text }), ta,
    h('div', { class: 'shareline' },
      h('button', { class: 'btn solid', text: t('send'), onclick: () => {
        if (x.kind === 'm') setStage(x, 1); else x.s = 1;
        x.review = ''; logAdd(x, { a: 'returned', m: ta.value.trim() }); touch(p); save(); closeSheet(); render();
      } }),
      h('button', { class: 'btn ghost', text: t('close'), onclick: closeSheet })));
  openSheet(box); ta.focus();
}
function renderSoon() {
  const el = $('soon'); el.replaceChildren();
  const now = Date.now(), lim = now + 7 * 86400000, items = [];
  allTasksF().forEach(({ p, t: x }) => {
    if (x.s === 2 && x.review === 'pending') items.push({ p, x, at: -1, type: 'r' });
    if (x.s === 2) return;
    if (x.date && dueTs(x) <= lim) items.push({ p, x, at: dueTs(x), type: 'd' });
    if (x.follow && x.follow <= lim) items.push({ p, x, at: x.follow, type: 'f' });
    if (x.urgent && !x.date && !x.follow) items.push({ p, x, at: 0, type: 'u' });
  });
  items.sort((a, b) => a.at - b.at);
  el.hidden = !items.length; if (!items.length) return;
  el.append(h('h3', { text: t('attention') }));
  const ul = h('ul');
  items.slice(0, 12).forEach(({ p, x, at, type }) => {
    const late = type !== 'u' && type !== 'r' && at <= now;
    const label = type === 'r' ? t('needsReview', x.who || '') : type === 'u' ? t('urgent') : type === 'f' ? t('lblFollow', x.who || t('whoDefault')) : x.kind === 'm' ? t('lblPickup') : t('lblDue');
    const li = h('li', null, h('button', { onclick: () => { openTask = x.id; select(p.id); } },
      h('span', null, h('small', { text: label + '  |  ' + p.name }), x.text),
      h('span', { class: 'when' + (late ? ' over' : (type === 'd' && dueKind(x) === 'today') ? ' today' : ''), text: type === 'u' || type === 'r' ? '' : (late ? t('late') : '') + (type === 'd' ? fmtDue(x) : fmtTs(at)) })));
    if (type === 'r') li.append(h('div', { class: 'acts' },
      h('button', { class: 'btn solid', text: t('approve'), onclick: () => approve(p, x) }),
      h('button', { class: 'btn', text: t('returnTask'), onclick: () => sendBack(p, x) })));
    if (type === 'f' && late) {
      li.append(h('div', { class: 'acts' },
        h('button', { class: 'btn', text: t('reviewed'), onclick: () => { x.follow = 0; x.lastReview = Date.now(); touch(p); save(); render(); toast(t('reviewedToast')); } }),
        h('button', { class: 'btn ghost', text: t('snoozeDay'), onclick: () => snooze(p, x, 86400000) }),
        h('button', { class: 'btn ghost', text: t('taskDone'), onclick: () => { x.follow = 0; if (x.kind === 'm') setStage(x, 3); else x.s = 2; touch(p); save(); render(); } })));
    }
    ul.append(li);
  });
  el.append(ul);
}

function projectSummary(p) {
  const g = prog(p), lines = ['📋 ' + p.name, t('sumProgress', n(g.d), n(g.t))];
  if (p.note) lines.push(t('stoppedAt') + p.note);
  const open = p.tasks.filter((x) => x.s !== 2).sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0));
  if (open.length) {
    lines.push('', t('sumOpen'));
    open.forEach((x) => lines.push('• ' + (x.urgent ? '🔴 ' : '') + x.text + (x.who ? ' (' + x.who + ')' : '') + (x.date ? ' · ' + fmtDue(x) : '') + (x.s === 1 ? ' · ' + t('sDoing') : x.kind === 'm' ? ' · ' + STG()[x.stage || 0] : '')));
  }
  return lines.join('\n');
}
function projectCard(p) {
  const g = prog(p), nx = nextStep(p), d = days(p.updatedAt);
  const stale = d != null && d >= 7 && g.d < g.t && !p.archived;
  const urg = p.tasks.filter((x) => x.urgent && x.s !== 2).length;
  return h('li', null, h('button', { class: 'pcard', 'aria-current': selected === p.id ? 'true' : 'false', onclick: () => select(p.id) },
    h('div', { class: 'name' }, dept(p.dept) ? dept(p.dept).icon + ' ' : '', h('span', { class: 'hl', text: p.name }), urg ? h('span', { class: 'urgc', text: ' 🔴 ' + n(urg) }) : null),
    p.note ? h('p', { class: 'line' }, h('b', { text: t('stoppedAt') }), p.note) : null,
    !p.note && nx ? h('p', { class: 'line' }, h('b', { text: t('nextShort') }), nx.text) : null,
    h('div', { class: 'bar' }, h('span', { style: 'width:' + g.pct + '%' })),
    h('div', { class: 'pfoot' },
      h('span', { text: g.t ? t('doneOf', n(g.d), n(g.t)) : t('noStepsShort') }),
      h('span', { class: stale ? 'stale' : '', text: p.updatedAt ? (stale ? t('staleAt', rel(p.updatedAt)) : t('lastEdit', rel(p.updatedAt))) : '' }))));
}
function renderList() {
  document.body.classList.toggle('show-detail', !!selected);
  renderReportsBox(); renderDepts(); renderPeople(); renderResults(); renderMine(); renderSoon();
  const doing = allTasksF().filter(({ t: x }) => x.s === 1 && x.kind !== 'm');
  nowEl.hidden = !doing.length; nowEl.replaceChildren();
  if (doing.length) {
    nowEl.append(h('h3', { text: t('nowDoing') }));
    const ul = h('ul');
    doing.forEach(({ p, t: x }) => ul.append(h('li', null, h('button', { onclick: () => { openTask = x.id; select(p.id); } }, h('small', { text: p.name + (x.who ? '  |  ' + x.who : '') }), x.text))));
    nowEl.append(ul);
  }
  plist.replaceChildren();
  if (!state.projects.length) {
    if (toMe.length) return;
    plist.append(h('li', null, h('div', { class: 'empty' }, h('p', { text: t('emptyProjects') }), h('button', { class: 'btn solid', onclick: openAdd, text: t('addProjectBtn') }))));
    return;
  }
  activeProjects().filter(projOK).forEach((p) => plist.append(projectCard(p)));
  const arch = state.projects.filter((p) => p.archived);
  if (arch.length) {
    const ul = h('ul', { class: 'plist' }); arch.forEach((p) => ul.append(projectCard(p)));
    plist.append(h('li', null, h('details', { class: 'donegrp' }, h('summary', { text: t('archivedGroup', n(arch.length)) }), ul)));
  }
}

/* ---------------- rendering: detail ---------------- */
function cycle(p, x) {
  const prev = x.s;
  if (x.kind === 'm') setStage(x, ((x.stage || 0) + 1) % 4);
  else x.s = (x.s + 1) % 3;
  if (x.s !== prev) logAdd(x, { a: x.s === 1 ? 'start' : x.s === 2 ? 'done' : 'reopen' });
  if (x.s === 2) { x.follow = 0; x.review = 'ok'; }
  touch(p); save(); render();
}

function section(key, title, badge, body, defOpen) {
  const d = h('details', { class: 'sec2' }, h('summary', null, h('span', { text: title }), badge ? h('span', { class: 'badge', text: badge }) : null));
  if (openSecs.has(key) || (defOpen && !openSecs.has('x:' + key))) d.open = true;
  d.addEventListener('toggle', () => { if (d.open) { openSecs.add(key); openSecs.delete('x:' + key); } else { openSecs.delete(key); openSecs.add('x:' + key); } });
  d.append(body); return d;
}
function prop(label, control) { return h('div', { class: 'prop' }, h('span', { class: 'plabel', text: label }), control); }
function selectEl(opts, value, onchange) {
  const sl = h('select', { class: 'field sel', onchange: (e) => onchange(e.target.value) });
  opts.forEach(([v, l]) => { const o = h('option', { value: v, text: l }); if (v === value) o.selected = true; sl.append(o); });
  return sl;
}
const HOUR = 3600000, DAY = 86400000, QMS = [HOUR, 3 * HOUR, DAY, 2 * DAY, 3 * DAY, 7 * DAY, 14 * DAY];
function followSelect(x, onSet) {
  const opts = [];
  if (x.follow) opts.push(['cur', '✓ ' + fmtTs(x.follow)]);
  opts.push(['', t('fNone')]);
  t('quick').forEach((l, i) => opts.push(['q' + i, l]));
  opts.push(['c', t('fCustom')]);
  return selectEl(opts, x.follow ? 'cur' : '', (v) => {
    if (v === 'cur') return;
    if (v === 'c') { customFollow = x.id; onSet(null); return; }
    customFollow = null;
    x.follow = v === '' ? 0 : Date.now() + QMS[+v.slice(1)];
    onSet(x.follow);
  });
}
function editPanel(p, x) {
  const upd = () => { touch(p); save(); render(); };
  const box = h('div', { class: 'tedit' });
  const who = x.who || t('whoDefault');

  if (x.review === 'pending' && x.s === 2) box.append(h('div', { class: 'next' }, h('span', { text: t('needsReview', x.who || '') }),
    h('span', { class: 'shareline' }, h('button', { class: 'btn solid', type: 'button', text: t('approve'), onclick: () => approve(p, x) }),
      h('button', { class: 'btn', type: 'button', text: t('returnTask'), onclick: () => sendBack(p, x) }))));

  const props = h('div', { class: 'props' });
  props.append(prop('👤 ' + t('pWho'), h('input', { class: 'field', list: 'names', value: x.who || '', placeholder: t('whoPh'), onchange: (e) => {
    const v = e.target.value.trim();
    if (x.shareEmail && norm(v) !== norm(x.who)) unshare(x);
    x.who = v; autoShare(x); upd();
  } })));
  props.append(prop('📅 ' + (x.kind === 'm' ? t('pPickup') : t('pDue')), h('div', { class: 'inline' },
    h('input', { class: 'field', type: 'date', value: x.date || '', 'aria-label': t('day'), onchange: (e) => { x.date = e.target.value; if (!x.date) x.time = ''; upd(); } }),
    h('input', { class: 'field', type: 'time', value: x.time || '', 'aria-label': t('timeOpt'), onchange: (e) => { x.time = e.target.value; if (x.time && !x.date) x.date = todayStr(); upd(); } }))));
  props.append(prop('🔁 ' + t('pFollow'), followSelect(x, (v) => { upd(); if (v) toast(t('followToast', who, fmtTs(v))); })));
  if (customFollow === x.id) {
    const toLocal = (ts) => { const d = new Date(ts); return dstr(d) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
    props.append(prop('', h('input', { class: 'field', type: 'datetime-local', value: x.follow ? toLocal(x.follow) : '', onchange: (e) => { const v = e.target.value; x.follow = v ? new Date(v).getTime() : 0; customFollow = null; upd(); } })));
  }
  props.append(prop('♻️ ' + t('repeat'), selectEl(['', 'd', 'w', 'm'].map((v, i) => [v, t('repeatOpts')[i]]), x.repeat || '', (v) => { x.repeat = v; delete x.repeated; upd(); })));
  props.append(prop('⚡ ' + t('pPriority'), selectEl([['', t('normal')], ['u', t('urgent')]], x.urgent ? 'u' : '', (v) => { x.urgent = v === 'u'; upd(); })));
  props.append(prop('🏷 ' + t('pType'), selectEl([['', t('typeTask')], ['m', t('typeTx')]], x.kind || '', (v) => {
    if (v === 'm') { x.kind = 'm'; setStage(x, x.s === 2 ? 3 : x.s === 1 ? 1 : 0); } else x.kind = '';
    upd();
  })));
  if (x.kind === 'm') props.append(prop('📍 ' + t('whereNow'), selectEl(STG().map((sg, k) => [String(k), sg]), String(x.stage || 0), (v) => { setStage(x, +v); if (+v === 3) x.follow = 0; upd(); })));
  box.append(props);

  if (x.who) {
    const m = member(x.who);
    const st = x.shareEmail ? (x.seenAt ? t('seen') : t('inApp', x.who)) : (m ? (m.email ? '' : t('noEmailHint', x.who)) : t('notInTeam', x.who));
    box.append(h('div', { class: 'shareline' },
      h('button', { class: 'btn wa', type: 'button', text: t('shareWA'), onclick: () => { const url = waLink(p, x); save(); openExternal(url); } }),
      st ? h('span', { class: 'kind' + (x.shareEmail ? ' ok' : ''), text: st }) : null));
  }

  if (x.kind === 'm') box.append(section(x.id + ':tx', '📄 ' + t('secTx'), x.ref || '', h('div', { class: 'row' },
    h('input', { class: 'field', value: x.office || '', placeholder: t('office'), onchange: (e) => { x.office = e.target.value.trim(); upd(); } }),
    h('input', { class: 'field', value: x.ref || '', placeholder: t('ref'), dir: 'ltr', onchange: (e) => { x.ref = e.target.value.trim(); upd(); } }))));

  const br = h('textarea', { class: 'field', placeholder: t('detailsPh'), rows: '3', onchange: (e) => { x.brief = e.target.value.trim(); upd(); } });
  br.value = x.brief || '';
  box.append(section(x.id + ':d', '📝 ' + t('details'), x.brief ? '✓' : '', br, !!x.brief));

  const ck = h('div', { class: 'gal' });
  ck.append(checklistView(x.checks || [], true, (c, adding) => {
    x.checks = c; upd();
    if (adding) { const f = detail.querySelector('#t-' + x.id + ' .checks input.field'); if (f) f.focus(); }
  }));
  const tplOpts = [['', t('useTemplate')], ...state.templates.map((tp) => [tp.id, '📋 ' + tp.name])];
  if ((x.checks || []).length) tplOpts.push(['save', '💾 ' + t('saveTemplate')]);
  ck.append(selectEl(tplOpts, '', (v) => {
    if (v === 'save') { state.templates.push({ id: uid(), name: x.text, checks: x.checks.map((c) => c.t), brief: x.brief || '' }); save(); toast(t('templateSaved')); render(); return; }
    const tp = state.templates.find((y) => y.id === v); if (!tp) return;
    x.checks = [...(x.checks || []), ...tp.checks.map((c) => ({ id: uid(), t: c, d: false }))];
    if (!x.brief && tp.brief) x.brief = tp.brief;
    upd();
  }));
  box.append(section(x.id + ':c', t('checklist'), checkCount(x.checks), ck, !!(x.checks && x.checks.length)));

  const key = 'o:' + x.id; galCtx[key] = { mode: 'o', p, x }; watchFiles(key);
  const nPh = (filesCache[key] || []).length;
  box.append(section(x.id + ':p', t('photos'), nPh ? n(nPh) : '', gallery(key), false));

  const msgs = (x.log || []).filter((e) => e.a === 'msg').length;
  box.append(section(x.id + ':m', t('thread'), msgs ? n(msgs) : '', threadView(x.log, (m) => { logAdd(x, { a: 'msg', m }); touch(p); save(); render();
    const f = detail.querySelector('#t-' + x.id + ' .thread input.field'); if (f) f.focus(); }), msgs > 0));
  return box;
}

function taskRow(p, x) {
  const isOpen = openTask === x.id, dk = dueKind(x);
  const meta = [];
  if (x.who) meta.push(h('span', { class: 'who', text: x.who }));
  if (x.date) meta.push(h('span', { class: 'when ' + dk, text: (dk === 'over' ? t('late') : '') + fmtDue(x) }));
  if (x.follow && x.s !== 2) meta.push(h('span', { class: 'fol' + (x.follow <= Date.now() ? ' when over' : ''), text: fmtTs(x.follow) }));
  if (x.kind === 'm') meta.push(h('span', { class: 'stg' + (x.stage === 2 ? ' ready' : ''), text: STG()[x.stage || 0] }));
  if (x.s === 2 && x.doneAt) meta.push(h('span', { text: '✓ ' + fmtTs(x.doneAt) }));
  const ic = [];
  if (x.review === 'pending' && x.s === 2) ic.push('⏳');
  if (x.urgent && x.s !== 2) ic.push('🔴');
  if (x.shareEmail) ic.push(x.seenAt ? '👁' : '📲');
  if (x.checks && x.checks.length) ic.push('☑' + checkCount(x.checks));
  const nm = (x.log || []).filter((e) => e.a === 'msg').length; if (nm) ic.push('💬' + nm);
  if (x.photos || x.photoAt) ic.push('📷');
  if (x.repeat) ic.push('♻️');
  if (x.brief) ic.push('📝');
  if (ic.length) meta.push(h('span', { class: 'icons', text: ic.join(' ') }));
  const li = h('li', { class: 'task' + (x.s === 2 ? ' done' : x.s === 1 ? ' doing' : ''), id: 't-' + x.id },
    h('button', { class: 'st', 'data-s': x.s, 'aria-label': x.kind === 'm' ? t('aStage', STG()[x.stage || 0]) : x.s === 0 ? t('aTodo') : x.s === 1 ? t('aDoing') : t('aDone'), onclick: () => cycle(p, x) }),
    h('div', { class: 'tbody' },
      h('input', { class: 'ttext', value: x.text, 'aria-label': t('step'), onchange: (e) => { const v = e.target.value.trim(); if (!v) { e.target.value = x.text; return; } x.text = v; touch(p); save(); renderList(); } }),
      meta.length ? h('div', { class: 'tmeta' }, ...meta) : null),
    h('button', { class: 'more', 'aria-expanded': isOpen ? 'true' : 'false', 'aria-label': t('moreLabel'), title: t('moreLabel'), text: '⋯', onclick: () => { openTask = isOpen ? null : x.id; renderDetail(); } }),
    h('button', { class: 'del', 'aria-label': t('deleteStep'), title: t('deleteStep'), text: '×', onclick: () => { unshare(x); deleteTaskFiles(x); p.tasks = p.tasks.filter((y) => y !== x); touch(p); save(); render(); } }));
  if (isOpen) li.append(editPanel(p, x));
  return li;
}

function renderDetail() {
  detail.replaceChildren();
  const p = selected && find(selected);
  if (!p) { detail.append(h('div', { class: 'pick', text: state.projects.length ? t('pickProject') : t('pickEmpty') })); return; }
  const g = prog(p);
  detail.append(h('button', { class: 'btn ghost back', onclick: goHome, text: t('back') }));

  const title = h('h2', { class: 'ptitle', title: t('renameTitle') }, h('span', { class: 'hl', text: p.name }));
  title.addEventListener('click', () => {
    if (title.querySelector('input')) return;
    const inp = h('input', { value: p.name, 'aria-label': t('projectName') });
    const done = () => { const v = inp.value.trim(); if (v && v !== p.name) { p.name = v; touch(p); save(); } render(); };
    inp.addEventListener('blur', done);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } if (e.key === 'Escape') { inp.value = p.name; inp.blur(); } });
    title.replaceChildren(inp); inp.focus(); inp.select();
  });
  detail.append(title);
  const ds = h('select', { class: 'field deptsel', 'aria-label': t('depts'), onchange: (e) => { p.dept = e.target.value; touch(p); save(); render(); } });
  ds.append(h('option', { value: '', text: t('noDept') }));
  state.depts.forEach((d) => { const o = h('option', { value: d.id, text: d.icon + ' ' + d.name }); if (p.dept === d.id) o.selected = true; ds.append(o); });
  detail.append(ds);
  detail.append(h('p', { class: 'pmeta', text: (g.t ? t('progress', n(g.d), n(g.t), n(g.pct)) : t('noSteps')) + (p.updatedAt ? '. ' + t('lastEdit', rel(p.updatedAt)) : '') }));

  const stamp = h('small', { text: p.noteAt ? t('noteWritten', rel(p.noteAt)) : '' });
  detail.append(h('div', { class: 'sec' }, h('span', { text: t('whereStopped') }), stamp));
  const ta = h('textarea', { class: 'note', placeholder: t('notePh'), 'aria-label': t('whereStopped') });
  ta.value = p.note || '';
  ta.addEventListener('input', () => { p.note = ta.value; p.noteAt = Date.now(); touch(p); stamp.textContent = t('noteWritten', t('today')); save(); renderList(); });
  detail.append(ta);
  const nx = nextStep(p);
  if (nx) detail.append(h('div', { class: 'next' }, h('span', { text: nx.s === 1 ? t('doingIn') : t('nextStep') }), h('span', { text: nx.text })));

  const open = p.tasks.filter((x) => x.s !== 2).sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0)), closed = p.tasks.filter((x) => x.s === 2);
  detail.append(h('div', { class: 'sec' }, h('span', { text: t('plan') }), h('small', { text: open.length ? t('left', n(open.length)) : '' })));
  const ul = h('ul', { class: 'tasks' }); open.forEach((x) => ul.append(taskRow(p, x))); detail.append(ul);

  const addIn = h('input', { class: 'field', placeholder: t('addStepPh'), 'aria-label': t('newStep') });
  detail.append(h('form', { class: 'addt', autocomplete: 'off', onsubmit: (e) => {
    e.preventDefault(); const v = addIn.value.trim(); if (!v) return;
    const q = parseQuick(v);
    const nt = { id: uid(), text: q.text, s: 0 };
    if (q.who) nt.who = q.who; if (q.date) nt.date = q.date; if (q.time) nt.time = q.time; if (q.urgent) nt.urgent = true;
    const tp = state.templates.find((y) => y.name && norm(nt.text).includes(norm(y.name)));
    if (tp) { nt.checks = tp.checks.map((c) => ({ id: uid(), t: c, d: false })); if (tp.brief) nt.brief = tp.brief; toast(t('tplApplied', tp.name)); }
    if (nt.who) autoShare(nt);
    p.tasks.push(nt); touch(p); save(); render();
    const f = detail.querySelector('.addt input'); if (f) f.focus();
  } }, addIn, h('button', { class: 'btn', type: 'button', text: '🎙', title: t('aiAdd'), 'aria-label': t('aiAdd'), onclick: () => openVoiceTask(p) }), h('button', { class: 'btn', type: 'submit', text: t('add') })));
  detail.append(h('details', { class: 'legend help' }, h('summary', { text: '❓ ' + t('helpTitle') }), h('p', { text: t('legend') }), h('p', { text: t('quickHint') })));

  if (closed.length) {
    const dg = h('details', { class: 'donegrp' }, h('summary', { text: t('doneGroup', n(closed.length)) }));
    const ul2 = h('ul', { class: 'tasks' }); closed.forEach((x) => ul2.append(taskRow(p, x))); dg.append(ul2);
    if (closed.some((x) => x.id === openTask)) dg.open = true;
    detail.append(dg);
  }

  const delBtn = h('button', { class: 'btn danger', text: t('deleteProject') });
  let armed = false, t0;
  delBtn.addEventListener('click', () => {
    if (!armed) { armed = true; delBtn.textContent = t('sure'); t0 = setTimeout(() => { armed = false; delBtn.textContent = t('deleteProject'); }, 3500); return; }
    clearTimeout(t0); p.tasks.forEach((x) => { unshare(x); deleteTaskFiles(x); }); state.projects = state.projects.filter((y) => y !== p); save(); goHome();
  });
  detail.append(h('div', { class: 'dfoot' },
    h('button', { class: 'btn wa', text: t('summaryBtn'), onclick: () => openExternal('https://wa.me/?text=' + encodeURIComponent(projectSummary(p))) }),
    h('button', { class: 'btn', text: p.archived ? t('unarchive') : t('archive'), onclick: () => { p.archived = !p.archived; touch(p); save(); if (p.archived) goHome(); else render(); } }),
    delBtn));
}

/* ---------------- smart quick add ---------------- */
function parseQuick(raw) {
  let s = ' ' + raw.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))) + ' ';
  const out = {};
  if (/!/.test(s)) { out.urgent = true; s = s.replace(/!/g, ' '); }
  const at = s.indexOf('@');
  if (at >= 0) {
    const rest = s.slice(at + 1);
    const names = (state.team || []).map((m) => m.name).filter(Boolean).sort((a, b) => b.length - a.length);
    const found = names.find((nm) => norm(rest).startsWith(norm(nm)));
    if (found) { out.who = found; s = s.slice(0, at) + ' ' + rest.slice(found.length); }
    else { const m = rest.match(/^(\S+)/); if (m) { out.who = m[1]; s = s.slice(0, at) + ' ' + rest.slice(m[1].length); } }
  }
  let m = s.match(/\s(\d{1,2})[:.](\d{2})\s*(ص|م|am|pm)?(?=\s)/i);
  if (!m) m = s.match(/\s(?:الساعة|الساعه|at|u)\s+(\d{1,2})()\s*(ص|م|am|pm)?(?=\s)/i);
  if (m) {
    let hh = +m[1]; const mm = +(m[2] || 0), ap = (m[3] || '').toLowerCase();
    if ((ap === 'م' || ap === 'pm') && hh < 12) hh += 12;
    if ((ap === 'ص' || ap === 'am') && hh === 12) hh = 0;
    if (hh < 24 && mm < 60) { out.time = pad(hh) + ':' + pad(mm); s = s.replace(m[0], ' '); }
  }
  const D = [[/\s(بعد بكر[ةه]|prekosjutra|prekosutra|day after tomorrow)(?=\s)/i, 2], [/\s(النهارده|النهاردة|اليوم|today|danas)(?=\s)/i, 0], [/\s(بكر[ةه]|tomorrow|sjutra|sutra)(?=\s)/i, 1]];
  for (const [re, add] of D) { const mm2 = s.match(re); if (mm2) { const d = new Date(); d.setDate(d.getDate() + add); out.date = dstr(d); s = s.replace(mm2[0], ' '); break; } }
  if (!out.date) {
    const WD = [['الأحد', 'الاحد', 'sunday', 'nedjelja', 'nedjelju'], ['الاثنين', 'الإثنين', 'monday', 'ponedjeljak'], ['الثلاثاء', 'tuesday', 'utorak'], ['الأربعاء', 'الاربعاء', 'wednesday', 'srijeda', 'srijedu'], ['الخميس', 'thursday', 'četvrtak', 'cetvrtak'], ['الجمعة', 'الجمعه', 'friday', 'petak'], ['السبت', 'saturday', 'subota', 'subotu']];
    for (let i = 0; i < 7 && !out.date; i++) for (const w of WD[i]) {
      const re = new RegExp('\\s(?:يوم\\s)?' + w + '(?=\\s)', 'i'); const mw = s.match(re);
      if (mw) { const d = new Date(); let k = (i - d.getDay() + 7) % 7; if (k === 0) k = 7; d.setDate(d.getDate() + k); out.date = dstr(d); s = s.replace(mw[0], ' '); break; }
    }
  }
  if (!out.date) {
    const mn = s.match(/\s(?:بعد|in|za)\s+(\d{1,2})\s*(?:أيام|ايام|يوم|days?|dana)(?=\s)/i);
    if (mn) { const d = new Date(); d.setDate(d.getDate() + +mn[1]); out.date = dstr(d); s = s.replace(mn[0], ' '); }
  }
  if (out.time && !out.date) out.date = todayStr();
  out.text = s.replace(/\s+/g, ' ').trim() || raw.trim();
  return out;
}

/* ---------------- dashboard ---------------- */
function openDash() {
  const now = Date.now(), wk = now - 7 * 86400000;
  const tasks = allTasks().filter(({ p }) => projOK(p) && !p.archived);
  const K = { open: 0, over: 0, review: 0, fol: 0, done7: 0 };
  const per = {};
  const lastAct = (x) => Math.max(x.startedAt || 0, x.doneAt || 0, ...((x.log || []).map((e) => e.at || 0)));
  tasks.forEach(({ t: x }) => {
    const k = x.who ? norm(x.who) : '';
    const r = per[k] = per[k] || { name: x.who || t('unassigned'), open: 0, over: 0, doing: 0, done7: 0, review: 0, last: 0 };
    r.last = Math.max(r.last, lastAct(x));
    if (x.s !== 2) {
      K.open++; r.open++;
      if (x.s === 1) r.doing++;
      if (dueKind(x) === 'over') { K.over++; r.over++; }
      if (x.follow && x.follow <= now) K.fol++;
    } else {
      if (x.review === 'pending') { K.review++; r.review++; }
      if ((x.doneAt || 0) >= wk) { K.done7++; r.done7++; }
    }
  });
  const d0 = dept(deptFilter);
  const box = h('div', { class: 'box', role: 'dialog', 'aria-label': t('dashboard') });
  box.append(h('h2', { text: t('dashboard') + (d0 ? ' · ' + d0.icon + ' ' + d0.name : '') }));
  const tiles = h('div', { class: 'tiles' });
  [['open', 'kOpen'], ['over', 'kOver'], ['review', 'kReview'], ['fol', 'kFol'], ['done7', 'kDone7']].forEach(([k, l]) =>
    tiles.append(h('div', { class: 'tile' + (k === 'over' && K.over ? ' bad' : '') + (k === 'review' && K.review ? ' warn' : '') }, h('b', { text: n(K[k]) }), h('span', { text: t(l) }))));
  box.append(tiles);
  if (!deptFilter) {
    box.append(h('div', { class: 'subhead', text: t('byDept') }));
    const tb = h('div', { class: 'dtable' });
    state.depts.forEach((d) => {
      const ts = allTasks().filter(({ p }) => p.dept === d.id && !p.archived).map(({ t: x }) => x);
      const o = ts.filter((x) => x.s !== 2).length, ov = ts.filter((x) => dueKind(x) === 'over').length;
      tb.append(h('button', { class: 'drow', type: 'button', onclick: () => { deptFilter = d.id; try { localStorage.setItem('mashari3-dept', d.id); } catch (e) {} renderList(); openDash(); } },
        h('span', { text: d.icon + ' ' + d.name }), h('span', { text: t('kOpen') + ' ' + n(o) }), h('span', { class: ov ? 'bad' : '', text: t('kOver') + ' ' + n(ov) })));
    });
    box.append(tb);
  }
  box.append(h('div', { class: 'subhead', text: t('byPerson') }));
  const pt = h('div', { class: 'dtable' });
  Object.values(per).sort((a, b) => b.over - a.over || b.open - a.open).forEach((r) => {
    pt.append(h('button', { class: 'drow', type: 'button', onclick: () => { if (r.name === t('unassigned')) return; closeSheet(); query = r.name; $('q').value = r.name; select(null, false); } },
      h('span', null, h('b', { text: r.name }), h('small', { class: 'from', text: r.last ? ' · ' + t('lastAct', rel(r.last)) : '' })),
      h('span', { text: t('kOpen') + ' ' + n(r.open) + (r.doing ? ' · ' + t('sDoing') + ' ' + n(r.doing) : '') }),
      h('span', { class: r.over ? 'bad' : '', text: t('kOver') + ' ' + n(r.over) + (r.review ? ' · ⏳ ' + n(r.review) : '') + ' · ✓ ' + n(r.done7) })));
  });
  if (!Object.keys(per).length) pt.append(h('p', { class: 'muted', text: t('noLog') }));
  box.append(pt);
  box.append(h('div', { class: 'shareline' },
    h('button', { class: 'btn wa', text: t('sendReport'), onclick: () => {
      const L = ['📊 ' + t('dashboard') + (d0 ? ' · ' + d0.name : '') + ' · ' + fmtTs(now, false),
        t('kOpen') + ': ' + K.open + ' · ' + t('kOver') + ': ' + K.over + ' · ' + t('kReview') + ': ' + K.review + ' · ' + t('kDone7') + ': ' + K.done7, ''];
      Object.values(per).forEach((r) => L.push('• ' + r.name + ': ' + t('kOpen') + ' ' + r.open + ', ' + t('kOver') + ' ' + r.over + ', ✓ ' + r.done7));
      openExternal('https://wa.me/?text=' + encodeURIComponent(L.join('\n')));
    } }),
    deptFilter ? h('button', { class: 'btn', text: t('allDepts'), onclick: () => { deptFilter = ''; try { localStorage.setItem('mashari3-dept', ''); } catch (e) {} renderList(); openDash(); } }) : null,
    h('button', { class: 'btn ghost', text: t('close'), onclick: closeSheet })));
  openSheet(box);
}
$('dashBtn').addEventListener('click', openDash);
$('inboxBtn').addEventListener('click', openInbox);
$('aiBtn').addEventListener('click', () => openVoiceTask(null));
$('orgBtn').addEventListener('click', () => { openOrg = null; openCompany(); });

/* ---------------- departments sheet ---------------- */
function openDepts() {
  const box = h('div', { class: 'box', role: 'dialog', 'aria-label': t('depts') });
  box.append(h('h2', { text: t('depts') }));
  state.depts.forEach((d) => box.append(h('div', { class: 'member' }, h('div', { class: 'row', style: 'grid-template-columns:64px 1fr' },
    h('input', { class: 'field', value: d.icon, 'aria-label': 'icon', style: 'text-align:center', onchange: (e) => { d.icon = e.target.value.trim() || '📁'; save(); render(); } }),
    h('input', { class: 'field', value: d.name, placeholder: t('deptName'), onchange: (e) => { d.name = e.target.value.trim(); save(); render(); } })),
    h('button', { class: 'btn ghost', type: 'button', text: t('remove'), onclick: () => {
      state.depts = state.depts.filter((y) => y !== d);
      state.projects.forEach((p) => { if (p.dept === d.id) p.dept = ''; });
      if (deptFilter === d.id) deptFilter = '';
      save(); render(); openDepts();
    } }))));
  box.append(h('button', { class: 'btn', text: t('addDept'), onclick: () => { state.depts.push({ id: 'd' + uid(), icon: '📁', name: '' }); save(); openDepts(); } }));
  box.append(h('button', { class: 'btn ghost', text: t('close'), onclick: () => { state.depts = state.depts.filter((d) => d.name); save(); render(); openSettings(); } }));
  openSheet(box);
}

/* ---------------- add project ---------------- */
const addForm = $('addForm'), addName = $('addName');
function openAdd() { addForm.classList.add('open'); addName.focus(); }
$('addBtn').addEventListener('click', () => (addForm.classList.contains('open') ? addForm.classList.remove('open') : openAdd()));
addForm.addEventListener('submit', (e) => {
  e.preventDefault(); const v = addName.value.trim(); if (!v) return;
  const p = { id: 'p' + uid(), name: v, note: '', noteAt: 0, tasks: [], createdAt: Date.now(), updatedAt: Date.now(), dept: deptFilter };
  state.projects.push(p); addName.value = ''; addForm.classList.remove('open'); save(); select(p.id);
});
$('q').addEventListener('input', (e) => { query = e.target.value; renderList(); });

/* ---------------- sheets: settings & team ---------------- */
function closeSheet() { $('sheetRoot').replaceChildren(); }
function openSheet(box) { const sh = h('div', { class: 'sheet', onclick: (e) => { if (e.target === sh) closeSheet(); } }, box); $('sheetRoot').replaceChildren(sh); }

function openSettings() {
  const box = h('div', { class: 'box', role: 'dialog', 'aria-label': t('settings') });
  box.append(h('h2', { text: t('settings') }));
  box.append(h('p', { class: 'muted', text: cloud && cloud.user ? t('loggedAs', cloud.user.email) : t('demoNote') }));

  const langs = h('div', { class: 'langs' });
  ['ar', 'en', 'me'].forEach((l) => langs.append(h('button', { class: 'chip', 'aria-pressed': lang === l ? 'true' : 'false', text: window.L[l].langName, onclick: () => { setLang(l); openSettings(); } })));
  box.append(h('div', { class: 'subhead', text: t('language') }), langs);

  box.append(h('label', { class: 'muted' }, t('myName'),
    h('input', { class: 'field', value: state.profile.name || '', onchange: (e) => { state.profile.name = e.target.value.trim(); allTasks().forEach(({ t: x }) => { if (x.shareEmail) delete x._sh; }); save(); } })));

  box.append(h('button', { class: 'btn', text: t('team') + ' (' + n((state.team || []).length) + ')', onclick: openTeam }));
  box.append(h('button', { class: 'btn', text: t('depts') + ' (' + n(state.depts.length) + ')', onclick: openDepts }));
  const trc = h('input', { type: 'checkbox', onchange: (e) => { state.profile.translate = e.target.checked; save(); render(); } });
  trc.checked = trOn();
  box.append(h('label', { class: 'check' }, trc, t('trToggle')));
  if (aiState === 'off') box.append(h('p', { class: 'muted', text: t('trOff') }));
  const ab = h('input', { type: 'checkbox', onchange: (e) => { state.profile.aiBrief = e.target.checked; save(); aiBrief(); } });
  ab.checked = state.profile.aiBrief !== false;
  box.append(h('label', { class: 'check' }, ab, t('briefToggle')));
  const dg = h('input', { type: 'checkbox', onchange: (e) => { state.profile.digest = e.target.checked; save(); } });
  dg.checked = state.profile.digest !== false;
  box.append(h('label', { class: 'check' }, dg, t('digestToggle')));

  if (LN) {
    box.append(h('button', { class: 'btn', text: t('testNotif'), onclick: async () => {
      try {
        let perm = await LN.checkPermissions(); if (perm.display !== 'granted') perm = await LN.requestPermissions();
        if (perm.display !== 'granted') { toast(t('notifOff')); return; }
        await ensureChannel();
        await LN.schedule({ notifications: [{ id: 99, title: t('appName'), body: t('notifTestBody'), channelId: 'reminders', schedule: { at: new Date(Date.now() + 5000), allowWhileIdle: true } }] });
        toast(t('notifTestToast'));
      } catch (e) { toast(t('notifErr')); }
    } }));
  } else if ('Notification' in window) {
    box.append(h('button', { class: 'btn', text: Notification.permission === 'granted' ? t('browserOn') : t('browserEnable'), onclick: async () => {
      const r = await Notification.requestPermission(); toast(r === 'granted' ? t('browserOnToast') : t('browserOffToast')); scheduleNotifs(); closeSheet();
    } }));
  }
  box.append(h('button', { class: 'btn', text: t('importBtn'), onclick: () => $('importFile').click() }));
  if (!isNative) box.append(h('button', { class: 'btn', text: t('exportBtn'), onclick: exportData }));
  if (cloud && cloud.user) box.append(h('button', { class: 'btn danger', text: t('logout'), onclick: async () => { closeSheet(); await cloud.signOut(); } }));
  box.append(h('button', { class: 'btn ghost', text: t('close'), onclick: closeSheet }));
  openSheet(box);
}
$('menuBtn').addEventListener('click', openSettings);
$('langBtn').addEventListener('click', () => { const o = ['ar', 'en', 'me']; setLang(o[(o.indexOf(lang) + 1) % 3]); toast(t('langName')); });

function openTeam(fresh) {
  if (fresh !== false && cloud) { loadMemberStatus().then(() => { if ($('sheetRoot').querySelector('[data-team]')) openTeam(false); }); }
  const box = h('div', { class: 'box', role: 'dialog', 'aria-label': t('team'), 'data-team': '1' });
  box.append(h('h2', { text: t('team') }), h('p', { class: 'muted', text: t('teamHint') }));
  const withEmail = (state.team || []).filter((m) => m.email);
  if (cloud && withEmail.length) {
    const inst = withEmail.filter((m) => memberStatus[m.email.trim().toLowerCase()]).length;
    box.append(h('p', { class: 'next', text: t('installedSum', n(inst), n(withEmail.length)) }));
  }
  box.append(h('button', { class: 'btn', type: 'button', text: t('copyLink'), onclick: async () => {
    try { await navigator.clipboard.writeText(APK_URL); toast(t('copied')); } catch (e) { toast(APK_URL); }
  } }));
  const changed = () => { allTasks().forEach(({ t: x }) => { const m = member(x.who); if (x.shareEmail && (!m || (m.email || '').trim().toLowerCase() !== x.shareEmail)) unshare(x); }); save(); render(); syncOrgIndex(); };
  (state.team || []).forEach((m) => {
    const card = h('div', { class: 'member' },
      h('input', { class: 'field', value: m.name || '', placeholder: t('name'), onchange: (e) => {
        const old = m.name; m.name = e.target.value.trim();
        allTasks().forEach(({ t: x }) => { if (old && norm(x.who) === norm(old)) x.who = m.name; });
        changed();
      } }),
      h('div', { class: 'row' },
        h('input', { class: 'field', value: m.phone || '', placeholder: t('phone'), dir: 'ltr', inputmode: 'tel', onchange: (e) => { m.phone = e.target.value.trim(); save(); } }),
        h('input', { class: 'field', value: m.email || '', placeholder: t('emailOpt'), dir: 'ltr', type: 'email', onchange: (e) => { m.email = e.target.value.trim().toLowerCase(); changed(); } })),
      (() => { const sel = h('select', { class: 'field', 'aria-label': t('depts'), onchange: (e) => { m.dept = e.target.value; save(); syncOrgIndex(); } });
        sel.append(h('option', { value: '', text: t('noDept') }));
        state.depts.forEach((d) => { const o = h('option', { value: d.id, text: d.icon + ' ' + d.name }); if (m.dept === d.id) o.selected = true; sel.append(o); });
        return sel; })(),
      selectEl(['staff', 'head', 'manager'].map((r, i) => [r, '🎖 ' + t('roles')[i]]), m.role || 'staff', (v) => { m.role = v; save(); syncOrgIndex(); }),
      (() => { const c = h('input', { type: 'checkbox', onchange: (e) => { m.kitchen = e.target.checked; save(); syncOrgIndex(); } }); c.checked = !!m.kitchen; return h('label', { class: 'check' }, c, t('k_access')); })(),
      (() => { const sel = h('select', { class: 'field', 'aria-label': t('language'), onchange: (e) => { m.lang = e.target.value; save(); } });
        ['ar', 'en', 'me'].forEach((l) => { const o = h('option', { value: l, text: '🌐 ' + window.L[l].langName }); if ((m.lang || lang) === l) o.selected = true; sel.append(o); });
        return sel; })(),
      (() => {
        if (!m.email) return h('span', { class: 'kind', text: t('needEmail') });
        const st = memberStatus[m.email.trim().toLowerCase()];
        const line = st ? t('installed', rel(st.lastSeen)) + (st.platform === 'web' ? ' · 💻' : ' · 📱') : st === null ? t('notInstalled') : '…';
        return h('div', { class: 'shareline' }, h('span', { class: 'kind' + (st ? ' ok' : ''), text: line }),
          h('button', { class: 'btn wa', type: 'button', text: t('invite'), onclick: () => openExternal(inviteLink(m)) }));
      })(),
      h('button', { class: 'btn ghost', type: 'button', text: t('remove'), onclick: () => { state.team = state.team.filter((y) => y !== m); changed(); openTeam(false); } }));
    box.append(card);
  });
  box.append(h('button', { class: 'btn', text: t('addMember'), onclick: () => { state.team.push({ id: uid(), name: '', phone: '', email: '', lang }); save(); openTeam(false); const ins = $('sheetRoot').querySelectorAll('.member input'); if (ins.length) ins[ins.length - 3].focus(); } }));
  box.append(h('button', { class: 'btn ghost', text: t('close'), onclick: () => { state.team = state.team.filter((m) => m.name || m.phone || m.email); save(); render(); openSettings(); } }));
  openSheet(box);
}

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
    if (Array.isArray(d.team)) d.team.forEach((m) => { if (m && m.name && !member(m.name)) state.team.push(m); });
    save(); render(); closeSheet(); toast(added ? t('imported', n(added)) : t('importExists'));
  } catch (err) { toast(t('importBad')); }
});

/* ---------------- auth & startup ---------------- */
function showApp() { $('login').classList.add('hidden'); $('app').classList.remove('hidden'); }
function showLogin() { $('app').classList.add('hidden'); $('login').classList.remove('hidden'); }
function loadLocal() { try { const raw = localStorage.getItem(LKEY); if (raw) { const d = JSON.parse(raw); if (valid(d)) state = d; } } catch (e) {} normalizeState(); }

const AUTH_ERR = {
  'auth/invalid-credential': 'errInvalid', 'auth/wrong-password': 'errWrongPass', 'auth/user-not-found': 'errNoUser',
  'auth/email-already-in-use': 'errInUse', 'auth/weak-password': 'errWeak', 'auth/invalid-email': 'errEmail',
  'auth/network-request-failed': 'errNet', 'auth/too-many-requests': 'errMany', 'auth/operation-not-allowed': 'errNotAllowed',
};
const authMsg = (e) => AUTH_ERR[e.code] ? t(AUTH_ERR[e.code]) : t('errGeneric', e.code || e.message);

async function startCloud() {
  let A, F, app;
  try {
    const [core, a, f] = await Promise.all([import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-firestore.js')]);
    A = a; F = f; app = core.initializeApp(CFG); fbApp = app;
  } catch (e) {
    console.warn(e); loadLocal(); showApp(); render(); setSync('offline');
    setBanner('bannerNoServer'); return;
  }
  const auth = A.initializeAuth(app, { persistence: [A.indexedDBLocalPersistence, A.browserLocalPersistence] });
  let db;
  try { db = F.initializeFirestore(app, { localCache: F.persistentLocalCache() }); } catch (e) { db = F.getFirestore(app); }

  const err = $('loginErr');
  const run = async (fn) => {
    err.textContent = ''; $('loginBtn').disabled = true;
    try { await fn(auth, $('email').value.trim(), $('pass').value); } catch (e) { err.textContent = authMsg(e); }
    $('loginBtn').disabled = false;
  };
  $('loginForm').addEventListener('submit', (e) => { e.preventDefault(); run(A.signInWithEmailAndPassword); });
  $('signupBtn').addEventListener('click', () => { if (!$('loginForm').reportValidity()) return; run(A.createUserWithEmailAndPassword); });
  $('resetBtn').addEventListener('click', async () => {
    const em = $('email').value.trim(); if (!em) { err.textContent = t('emailFirst'); return; }
    try { await A.sendPasswordResetEmail(auth, em); err.textContent = t('resetSent'); } catch (e) { err.textContent = authMsg(e); }
  });

  let unsub = null, unsubShared = null;
  A.onAuthStateChanged(auth, (user) => {
    if (unsub) { unsub(); unsub = null; }
    if (unsubShared) { unsubShared(); unsubShared = null; }
    toMe = []; ownerSharedReady = false;
    if (!user) { kStop(); myOrg = null; orgResolved = false; cloud = null; state = { projects: [], team: [], profile: {} }; showLogin(); return; }
    const ref = F.doc(db, 'users', user.uid, 'data', 'board');
    cloud = { db, F, ref, user, signOut: () => { try { localStorage.removeItem(LKEY); } catch (e) {} return A.signOut(auth); } };
    loadLocal(); showApp(); render();
    unsub = F.onSnapshot(ref, { includeMetadataChanges: true }, (snap) => {
      setSync(snap.metadata.fromCache && !navigator.onLine ? 'offline' : 'ok');
      if (snap.metadata.hasPendingWrites || dirty) return;
      const d = snap.exists() ? snap.data() : null;
      if (valid(d)) applyRemote(d);
      else if (!snap.metadata.fromCache && state.projects.length) save();
    }, (e) => { console.warn(e); setSync('err'); });
    unsubShared = startShared(F, db, user);
    announce(); resolveOrg(); loadMemberStatus();
  });
}

window.addEventListener('online', () => { if (cloud) setSync('ok'); });
window.addEventListener('offline', () => setSync('offline'));
setInterval(() => { const a = document.activeElement; if (!(a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'))) renderList(); }, 60000);

/* =====================================================================
   🍽 تشغيل المطبخ: الموردين، الأصناف، الطلبيات، الاستلام، الصلاحية، الهالك
   ===================================================================== */
const K = { on: false, kid: '', tab: 'stock', items: [], suppliers: [], orders: [], batches: [], waste: [], unsubs: [], open: null, cat: '', q: '' };
const KCOLS = ['items', 'suppliers', 'orders', 'batches', 'waste'];
const kAccess = () => !!(cloud && myOrg && (isGM() || myOrg.kitchen));
const kRef = (col, id) => cloud.F.doc(cloud.db, 'kitchens', K.kid, col, id);
const kCol = (col) => cloud.F.collection(cloud.db, 'kitchens', K.kid, col);
const kItem = (id) => K.items.find((x) => x.id === id);
const kSup = (id) => K.suppliers.find((x) => x.id === id);
const money = (v) => (v || v === 0) && !isNaN(v) ? (Math.round(v * 100) / 100).toLocaleString(loc()) + ' ' + (state.profile.currency || '€') : '';
const KCATS = ['veg', 'meat', 'fish', 'dairy', 'dry', 'drinks', 'clean', 'pack'];
const KSTOR = ['fridge', 'freezer', 'dry'];
const KUNITS = ['kg', 'g', 'L', 'pcs', 'box', 'pack'];
const KWASTE = ['expired', 'damaged', 'overprod', 'dropped', 'other'];
const kl = (group, id) => (t('k_' + group) || {})[id] || id;
function kErr(e) { console.warn('kitchen', e); toast(t('syncErr')); }

function kStart() {
  if (!kAccess() || K.kid) return;
  K.kid = myOrg.orgUid;
  const { F } = cloud;
  const since = Date.now() - 60 * DAY;
  KCOLS.forEach((c) => {
    const q = c === 'orders' ? F.query(kCol(c), F.where('createdAt', '>=', since))
      : c === 'waste' ? F.query(kCol(c), F.where('at', '>=', since))
      : c === 'batches' ? F.query(kCol(c), F.where('status', '==', 'in')) : kCol(c);
    K.unsubs.push(F.onSnapshot(q, (snap) => {
      K[c] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (K.on) kRender();
      if (c === 'batches') scheduleNotifs();
    }, kErr));
  });
  $('kitchenBtn').hidden = false;
}
function kStop() { K.unsubs.forEach((f) => f()); K.unsubs = []; K.kid = ''; K.on = false; document.body.classList.remove('kmode'); $('kitchenBtn').hidden = true; }

function kOpen() { K.on = true; document.body.classList.add('kmode'); kRender(); window.scrollTo({ top: 0 }); }
function kClose() { K.on = false; K.open = null; document.body.classList.remove('kmode'); render(); }

const expDays = (b) => Math.round((new Date(b.exp + 'T12:00') - new Date(todayStr() + 'T12:00')) / DAY);
function expClass(b) { const d = expDays(b); return d < 0 ? 'bad' : d <= 1 ? 'warn' : d <= 3 ? 'soon' : ''; }
function expText(b) {
  const d = expDays(b);
  if (d < 0) return t('k_expired', n(-d));
  if (d === 0) return t('k_expToday');
  if (d === 1) return t('k_expTomorrow');
  return t('k_expIn', n(d));
}
const lowItems = () => K.items.filter((x) => (x.par || 0) > 0 && (x.stock || 0) < x.par);

function kRender() {
  const el = $('kitchen'); el.replaceChildren();
  el.append(h('div', { class: 'khead' },
    h('button', { class: 'btn ghost', onclick: kClose, text: t('back') }),
    h('h2', { text: t('k_title') })));
  const expSoon = K.batches.filter((b) => b.exp && expDays(b) <= 1).length;
  const tabs = [['stock', '📦 ' + t('k_stock'), lowItems().length], ['orders', '🧾 ' + t('k_orders'), K.orders.filter((o) => o.status === 'draft').length],
    ['receive', '📥 ' + t('k_receive'), K.orders.filter((o) => o.status === 'sent').length], ['expiry', '⏳ ' + t('k_expiry'), expSoon],
    ['waste', '🗑 ' + t('k_waste'), 0], ['suppliers', '🚚 ' + t('k_suppliers'), 0]];
  const tb = h('div', { class: 'people ktabs' });
  tabs.forEach(([id, l, c]) => tb.append(h('button', { class: 'chip', 'aria-pressed': K.tab === id ? 'true' : 'false', onclick: () => { K.tab = id; K.open = null; kRender(); } }, l, c ? h('b', { text: n(c) }) : null)));
  el.append(tb);
  const body = h('div', { class: 'kbody' });
  ({ stock: kStock, orders: kOrders, receive: kReceive, expiry: kExpiry, waste: kWaste, suppliers: kSuppliers })[K.tab](body);
  el.append(body);
}

/* ---------- 📦 المخزون ---------- */
function kStock(body) {
  const low = lowItems();
  if (low.length) body.append(h('div', { class: 'next' }, h('span', { text: t('k_lowN', n(low.length)) }),
    h('button', { class: 'btn solid', type: 'button', text: t('k_makeOrders'), onclick: kAutoOrders })));
  const top = h('div', { class: 'shareline' },
    h('input', { class: 'field', style: 'flex:1;min-width:140px', type: 'search', placeholder: t('k_search'), value: K.q, oninput: (e) => { K.q = e.target.value; const f = body.querySelector('.klist'); if (f) f.replaceWith(list()); } }),
    selectEl([['', t('allDepts')], ...KCATS.map((c) => [c, kl('cats', c)])], K.cat, (v) => { K.cat = v; kRender(); }),
    h('button', { class: 'btn solid', type: 'button', text: '+ ' + t('k_item'), onclick: async () => {
      const r = await cloud.F.addDoc(kCol('items'), { name: '', unit: 'kg', cat: K.cat || 'veg', storage: 'fridge', par: 0, stock: 0, shelf: 3, price: 0, supplierId: '' }).catch(kErr);
      if (r) { K.open = r.id; }
    } }));
  body.append(top);
  const list = () => {
    const ul = h('ul', { class: 'klist' });
    const q = norm(K.q);
    K.items.filter((x) => (!K.cat || x.cat === K.cat) && (!q || norm(x.name).includes(q)))
      .sort((a, b) => ((b.par && b.stock < b.par) - (a.par && a.stock < a.par)) || (a.name || '').localeCompare(b.name || ''))
      .forEach((x) => ul.append(kItemRow(x)));
    if (!ul.firstChild) ul.append(h('li', { class: 'muted', text: t('k_noItems') }));
    return ul;
  };
  body.append(list());
}
function kItemRow(x) {
  const isLow = x.par > 0 && (x.stock || 0) < x.par, isOpen = K.open === x.id;
  const upd = (f) => cloud.F.updateDoc(kRef('items', x.id), f).catch(kErr);
  const step = x.unit === 'g' ? 100 : x.unit === 'kg' || x.unit === 'L' ? 0.5 : 1;
  const li = h('li', { class: 'krow' + (isLow ? ' low' : '') },
    h('div', { class: 'kmain', onclick: () => { K.open = isOpen ? null : x.id; kRender(); } },
      h('div', null, h('b', { text: x.name || '—' }), h('small', { class: 'from', text: ' ' + kl('stor', x.storage).split(' ')[0] + (kSup(x.supplierId) ? ' · ' + kSup(x.supplierId).name : '') })),
      h('span', { class: 'kqty' + (isLow ? ' bad' : ''), text: n(+(x.stock || 0)) + ' / ' + n(+(x.par || 0)) + ' ' + kl('units', x.unit) })),
    h('div', { class: 'kstep' },
      h('button', { class: 'btn', type: 'button', text: '−', 'aria-label': '−', onclick: () => upd({ stock: Math.max(0, Math.round(((x.stock || 0) - step) * 100) / 100) }) }),
      h('button', { class: 'btn', type: 'button', text: '+', 'aria-label': '+', onclick: () => upd({ stock: Math.round(((x.stock || 0) + step) * 100) / 100 }) })));
  if (isOpen) {
    const num = (k, label) => h('label', null, label, h('input', { class: 'field', type: 'number', inputmode: 'decimal', step: 'any', value: x[k] || 0, onchange: (e) => upd({ [k]: +e.target.value || 0 }) }));
    li.append(h('div', { class: 'tedit' },
      h('label', null, t('k_name'), h('input', { class: 'field', value: x.name || '', onchange: (e) => upd({ name: e.target.value.trim() }) })),
      h('div', { class: 'row' }, num('stock', t('k_inStock')), num('par', t('k_par'))),
      h('div', { class: 'row' },
        prop(t('k_unit'), selectEl(KUNITS.map((u) => [u, kl('units', u)]), x.unit || 'kg', (v) => upd({ unit: v }))),
        prop(t('k_cat'), selectEl(KCATS.map((c) => [c, kl('cats', c)]), x.cat || 'veg', (v) => upd({ cat: v })))),
      h('div', { class: 'row' },
        prop(t('k_storage'), selectEl(KSTOR.map((c) => [c, kl('stor', c)]), x.storage || 'fridge', (v) => upd({ storage: v }))),
        prop(t('k_supplier'), selectEl([['', '—'], ...K.suppliers.map((sp) => [sp.id, sp.name])], x.supplierId || '', (v) => upd({ supplierId: v })))),
      h('div', { class: 'row' }, num('shelf', t('k_shelf')), num('price', t('k_price', state.profile.currency || '€'))),
      h('button', { class: 'btn danger', type: 'button', text: t('remove'), onclick: () => { if (confirmTwice(li)) cloud.F.deleteDoc(kRef('items', x.id)).catch(kErr); } })));
  }
  return li;
}
function confirmTwice(el) { if (el.dataset.arm) return true; el.dataset.arm = '1'; toast(t('sure')); setTimeout(() => delete el.dataset.arm, 3500); return false; }

async function kAutoOrders() {
  const bySup = {};
  lowItems().forEach((x) => { const k = x.supplierId || ''; (bySup[k] = bySup[k] || []).push(x); });
  const { F } = cloud;
  let made = 0;
  for (const [sid, items] of Object.entries(bySup)) {
    const existing = K.orders.find((o) => o.status === 'draft' && (o.supplierId || '') === sid);
    const lines = items.map((x) => ({ itemId: x.id, name: x.name, unit: x.unit, qty: Math.ceil(((x.par || 0) - (x.stock || 0)) * 100) / 100, price: x.price || 0 }));
    if (existing) {
      const ids = new Set(existing.lines.map((l) => l.itemId));
      await F.updateDoc(kRef('orders', existing.id), { lines: [...existing.lines, ...lines.filter((l) => !ids.has(l.itemId))] }).catch(kErr);
    } else {
      await F.addDoc(kCol('orders'), { supplierId: sid, lines, status: 'draft', createdAt: Date.now(), by: myName(), note: '', deliver: '' }).catch(kErr);
    }
    made++;
  }
  toast(t('k_ordersMade', n(made))); K.tab = 'orders'; kRender();
}

/* ---------- 🧾 الطلبيات ---------- */
const orderTotal = (o) => (o.lines || []).reduce((a, l) => a + (+l.qty || 0) * (+l.price || 0), 0);
function kOrders(body) {
  body.append(h('div', { class: 'shareline' },
    selectEl([['', '+ ' + t('k_newOrder')], ...K.suppliers.map((sp) => [sp.id, '🚚 ' + sp.name])], '', async (sid) => {
      if (!sid) return;
      const lines = K.items.filter((x) => x.supplierId === sid).map((x) => ({ itemId: x.id, name: x.name, unit: x.unit, qty: x.par && x.stock < x.par ? Math.ceil((x.par - (x.stock || 0)) * 100) / 100 : 0, price: x.price || 0 }));
      const r = await cloud.F.addDoc(kCol('orders'), { supplierId: sid, lines, status: 'draft', createdAt: Date.now(), by: myName(), note: '', deliver: '' }).catch(kErr);
      if (r) { K.open = r.id; kRender(); }
    }),
    lowItems().length ? h('button', { class: 'btn', type: 'button', text: t('k_makeOrders'), onclick: kAutoOrders }) : null));
  const groups = [['draft', t('k_drafts')], ['sent', t('k_sent')], ['partial', t('k_partial')], ['received', t('k_received')]];
  groups.forEach(([st, label]) => {
    const list = K.orders.filter((o) => o.status === st).sort((a, b) => b.createdAt - a.createdAt);
    if (!list.length) return;
    body.append(h('div', { class: 'subhead', text: label + ' (' + n(list.length) + ')' }));
    const ul = h('ul', { class: 'klist' });
    list.slice(0, st === 'received' ? 15 : 50).forEach((o) => ul.append(kOrderRow(o)));
    body.append(ul);
  });
  if (!K.orders.length) body.append(h('p', { class: 'muted', text: t('k_noOrders') }));
}
function kOrderRow(o) {
  const sp = kSup(o.supplierId), isOpen = K.open === o.id, tot = orderTotal(o);
  const upd = (f) => cloud.F.updateDoc(kRef('orders', o.id), f).catch(kErr);
  const li = h('li', { class: 'krow' },
    h('div', { class: 'kmain', onclick: () => { K.open = isOpen ? null : o.id; kRender(); } },
      h('div', null, h('b', { text: (sp ? sp.name : t('k_noSupplier')) }), h('small', { class: 'from', text: ' · ' + n((o.lines || []).filter((l) => +l.qty > 0).length) + ' ' + t('k_lines') + ' · ' + fmtTs(o.sentAt || o.createdAt, false) })),
      h('span', { class: 'kqty', text: money(tot) })));
  if (!isOpen) return li;
  const box = h('div', { class: 'tedit' });
  const editable = o.status === 'draft';
  (o.lines || []).forEach((l, i) => box.append(h('div', { class: 'kline' },
    h('span', { text: l.name }),
    editable ? h('input', { class: 'field', type: 'number', inputmode: 'decimal', step: 'any', value: l.qty, onchange: (e) => { const lines = o.lines.slice(); lines[i] = { ...l, qty: +e.target.value || 0 }; upd({ lines }); } }) : h('span', { text: n(+l.qty) }),
    h('small', { text: kl('units', l.unit) }),
    editable ? h('button', { class: 'del', type: 'button', text: '×', onclick: () => upd({ lines: o.lines.filter((_, j) => j !== i) }) }) : h('small', { text: l.rec != null ? '📥 ' + n(+l.rec) + (l.ok === false ? ' ✗' : '') : '' }))));
  if (editable) {
    const avail = K.items.filter((x) => !(o.lines || []).some((l) => l.itemId === x.id));
    box.append(selectEl([['', '+ ' + t('k_addLine')], ...avail.map((x) => [x.id, x.name])], '', (v) => { const x = kItem(v); if (x) upd({ lines: [...(o.lines || []), { itemId: x.id, name: x.name, unit: x.unit, qty: 1, price: x.price || 0 }] }); }));
    box.append(h('div', { class: 'row' },
      h('label', null, t('k_deliver'), h('input', { class: 'field', type: 'date', value: o.deliver || '', onchange: (e) => upd({ deliver: e.target.value }) })),
      h('label', null, t('k_note'), h('input', { class: 'field', value: o.note || '', onchange: (e) => upd({ note: e.target.value.trim() }) }))));
    box.append(h('div', { class: 'shareline' },
      h('button', { class: 'btn wa', type: 'button', text: t('k_sendWA'), onclick: () => { openExternal(kOrderWA(o)); upd({ status: 'sent', sentAt: Date.now(), sentBy: myName() }); } }),
      h('button', { class: 'btn', type: 'button', text: t('k_markSent'), onclick: () => upd({ status: 'sent', sentAt: Date.now(), sentBy: myName() }) }),
      h('button', { class: 'btn danger', type: 'button', text: t('remove'), onclick: () => { if (confirmTwice(box)) cloud.F.deleteDoc(kRef('orders', o.id)).catch(kErr); } })));
  } else if (o.status === 'sent') {
    box.append(h('div', { class: 'shareline' },
      h('button', { class: 'btn solid', type: 'button', text: '📥 ' + t('k_receiveNow'), onclick: () => { K.tab = 'receive'; K.open = o.id; kRender(); } }),
      h('button', { class: 'btn wa', type: 'button', text: t('k_sendWA'), onclick: () => openExternal(kOrderWA(o)) })));
  } else {
    box.append(h('p', { class: 'muted', text: t('k_recBy', o.recBy || '', fmtTs(o.recAt || o.createdAt)) }));
    const key = 'k:' + o.id; galCtx[key] = { mode: 'k', x: o }; watchFiles(key); box.append(gallery(key));
  }
  li.append(box);
  return li;
}
function kOrderWA(o) {
  const sp = kSup(o.supplierId);
  const L = window.L[(sp && sp.lang) || lang] || window.L[lang];
  const lines = (o.lines || []).filter((l) => +l.qty > 0).map((l) => '• ' + l.name + ': ' + l.qty + ' ' + ((L.k_units || {})[l.unit] || l.unit));
  const msg = [L.k_waHead(state.profile.business || state.profile.name || ''), ...lines,
    o.deliver ? L.k_waDeliver(new Date(o.deliver + 'T12:00').toLocaleDateString(L.locale, { weekday: 'long', day: 'numeric', month: 'long' })) : '',
    o.note ? '📝 ' + o.note : '', L.k_waThanks].filter(Boolean).join('\n');
  const digits = sp && sp.phone ? sp.phone.replace(/\D/g, '').replace(/^00/, '') : '';
  return 'https://wa.me/' + digits + '?text=' + encodeURIComponent(msg);
}

/* ---------- 📥 الاستلام ---------- */
function kReceive(body) {
  const pending = K.orders.filter((o) => o.status === 'sent').sort((a, b) => (a.deliver || '9').localeCompare(b.deliver || '9'));
  body.append(h('button', { class: 'btn', type: 'button', text: '+ ' + t('k_adhoc'), onclick: async () => {
    const r = await cloud.F.addDoc(kCol('orders'), { supplierId: '', lines: [], status: 'sent', createdAt: Date.now(), sentAt: Date.now(), by: myName(), adhoc: true }).catch(kErr);
    if (r) { K.open = r.id; kRender(); }
  } }));
  if (!pending.length) body.append(h('p', { class: 'muted', text: t('k_noPending') }));
  const ul = h('ul', { class: 'klist' });
  pending.forEach((o) => {
    const sp = kSup(o.supplierId), isOpen = K.open === o.id;
    const li = h('li', { class: 'krow' }, h('div', { class: 'kmain', onclick: () => { K.open = isOpen ? null : o.id; kRender(); } },
      h('div', null, h('b', { text: sp ? sp.name : (o.adhoc ? t('k_adhoc') : t('k_noSupplier')) }), h('small', { class: 'from', text: ' · ' + n((o.lines || []).length) + ' ' + t('k_lines') + (o.deliver ? ' · ' + fmtTs(new Date(o.deliver + 'T09:00').getTime(), false) : '') })),
      h('span', { class: 'kqty', text: '📥' })));
    if (isOpen) li.append(kReceiveForm(o));
    ul.append(li);
  });
  body.append(ul);
}
function kReceiveForm(o) {
  const box = h('div', { class: 'tedit' });
  const rows = (o.lines || []).map((l) => {
    const x = kItem(l.itemId) || {};
    const exp = new Date(); exp.setDate(exp.getDate() + (+x.shelf || 3));
    return { l, rec: l.qty, exp: dstr(exp), ok: true };
  });
  const draw = () => {
    box.replaceChildren();
    rows.forEach((r) => {
      const ok = h('input', { type: 'checkbox', onchange: (e) => { r.ok = e.target.checked; } }); ok.checked = r.ok;
      box.append(h('div', { class: 'krec' },
        h('div', { class: 'shareline' }, h('label', { class: 'check' }, ok, h('b', { text: r.l.name })), h('small', { class: 'from', text: t('k_ordered') + ' ' + n(+r.l.qty) + ' ' + kl('units', r.l.unit) })),
        h('div', { class: 'row' },
          h('label', null, t('k_recQty'), h('input', { class: 'field', type: 'number', inputmode: 'decimal', step: 'any', value: r.rec, onchange: (e) => { r.rec = +e.target.value || 0; } })),
          h('label', null, t('k_expDate'), h('input', { class: 'field', type: 'date', value: r.exp, onchange: (e) => { r.exp = e.target.value; } })))));
    });
    const avail = K.items.filter((x) => !rows.some((r) => r.l.itemId === x.id));
    box.append(selectEl([['', '+ ' + t('k_addLine')], ...avail.map((x) => [x.id, x.name])], '', (v) => {
      const x = kItem(v); if (!x) return;
      const exp = new Date(); exp.setDate(exp.getDate() + (+x.shelf || 3));
      rows.push({ l: { itemId: x.id, name: x.name, unit: x.unit, qty: 0, price: x.price || 0 }, rec: 1, exp: dstr(exp), ok: true }); draw();
    }));
    const key = 'k:' + o.id; galCtx[key] = { mode: 'k', x: o }; watchFiles(key);
    box.append(h('div', { class: 'subhead', text: '🧾 ' + t('k_invoice') }), gallery(key));
    box.append(h('div', { class: 'shareline' }, h('button', { class: 'btn solid', type: 'button', text: '✓ ' + t('k_confirmRec'), onclick: () => kConfirm(o, rows) })));
  };
  draw();
  return box;
}
async function kConfirm(o, rows) {
  const { F, db } = cloud;
  const b = F.writeBatch(db), now = Date.now();
  let short = [];
  rows.forEach((r) => {
    const got = r.ok ? +r.rec || 0 : 0;
    if (got < (+r.l.qty || 0)) short.push(r.l.name + ': ' + n(got) + '/' + n(+r.l.qty));
    if (got > 0) {
      b.set(F.doc(kCol('batches')), { itemId: r.l.itemId, name: r.l.name, unit: r.l.unit, qty: got, exp: r.exp || '', recAt: now, orderId: o.id, storage: (kItem(r.l.itemId) || {}).storage || '', status: 'in', by: myName() });
      if (kItem(r.l.itemId)) b.update(kRef('items', r.l.itemId), { stock: F.increment(got) });
    }
  });
  const lines = rows.map((r) => ({ ...r.l, rec: r.ok ? +r.rec || 0 : 0, ok: r.ok, exp: r.exp }));
  b.update(kRef('orders', o.id), { lines, status: short.length ? 'partial' : 'received', recAt: now, recBy: myName() });
  try { await b.commit(); toast(short.length ? t('k_short', short.join('، ')) : t('k_recDone')); K.open = null; kRender(); } catch (e) { kErr(e); }
}

/* ---------- ⏳ الصلاحية ---------- */
function kExpiry(body) {
  const list = K.batches.filter((b) => b.exp).sort((a, b) => a.exp.localeCompare(b.exp));
  const exp = list.filter((b) => expDays(b) < 0).length, soon = list.filter((b) => expDays(b) >= 0 && expDays(b) <= 1).length;
  const tiles = h('div', { class: 'tiles' });
  tiles.append(h('div', { class: 'tile' + (exp ? ' bad' : '') }, h('b', { text: n(exp) }), h('span', { text: t('k_tExpired') })),
    h('div', { class: 'tile' + (soon ? ' warn' : '') }, h('b', { text: n(soon) }), h('span', { text: t('k_tSoon') })),
    h('div', { class: 'tile' }, h('b', { text: n(list.length) }), h('span', { text: t('k_tBatches') })));
  body.append(tiles);
  if (!list.length) { body.append(h('p', { class: 'muted', text: t('k_noBatches') })); return; }
  const firstOf = {};
  list.forEach((b) => { if (!(b.itemId in firstOf)) firstOf[b.itemId] = b.id; });
  const ul = h('ul', { class: 'klist' });
  list.forEach((b) => {
    const isOpen = K.open === b.id;
    const li = h('li', { class: 'krow ' + expClass(b) }, h('div', { class: 'kmain', onclick: () => { K.open = isOpen ? null : b.id; kRender(); } },
      h('div', null, h('b', { text: b.name }), h('small', { class: 'from', text: ' · ' + n(+b.qty) + ' ' + kl('units', b.unit) + (b.storage ? ' · ' + kl('stor', b.storage).split(' ')[0] : '') + (firstOf[b.itemId] === b.id && list.filter((y) => y.itemId === b.itemId).length > 1 ? ' · ' + t('k_fifo') : '') })),
      h('span', { class: 'kqty ' + expClass(b), text: expText(b) })));
    if (isOpen) li.append(kBatchActions(b));
    ul.append(li);
  });
  body.append(ul);
}
function kBatchActions(b) {
  const { F, db } = cloud;
  const qty = h('input', { class: 'field', type: 'number', inputmode: 'decimal', step: 'any', value: b.qty });
  const reason = selectEl(KWASTE.map((r) => [r, kl('wr', r)]), expDays(b) < 0 ? 'expired' : 'damaged', () => {});
  return h('div', { class: 'tedit' },
    h('p', { class: 'muted', text: t('k_expDate') + ': ' + fmtTs(new Date(b.exp + 'T12:00').getTime(), false) + ' · ' + t('k_recOn', fmtTs(b.recAt, false)) }),
    h('div', { class: 'row' }, h('label', null, t('k_qty'), qty), h('label', null, t('k_reason'), reason)),
    h('div', { class: 'shareline' },
      h('button', { class: 'btn solid', type: 'button', text: '✓ ' + t('k_used'), onclick: async () => {
        const q = Math.min(+qty.value || 0, +b.qty), wb = F.writeBatch(db);
        if (q >= +b.qty) wb.update(kRef('batches', b.id), { status: 'used', usedAt: Date.now() }); else wb.update(kRef('batches', b.id), { qty: Math.round((b.qty - q) * 100) / 100 });
        if (kItem(b.itemId)) wb.update(kRef('items', b.itemId), { stock: F.increment(-q) });
        await wb.commit().catch(kErr); K.open = null;
      } }),
      h('button', { class: 'btn danger', type: 'button', text: '🗑 ' + t('k_toWaste'), onclick: async () => {
        const q = Math.min(+qty.value || 0, +b.qty), wb = F.writeBatch(db), it = kItem(b.itemId);
        wb.set(F.doc(kCol('waste')), { itemId: b.itemId, name: b.name, unit: b.unit, qty: q, reason: reason.value, at: Date.now(), by: myName(), cost: it && it.price ? q * it.price : 0 });
        if (q >= +b.qty) wb.update(kRef('batches', b.id), { status: 'waste', wasteAt: Date.now() }); else wb.update(kRef('batches', b.id), { qty: Math.round((b.qty - q) * 100) / 100 });
        if (it) wb.update(kRef('items', b.itemId), { stock: F.increment(-q) });
        await wb.commit().catch(kErr); K.open = null; toast(t('k_wasteSaved'));
      } })));
}

/* ---------- 🗑 الهالك ---------- */
function kWaste(body) {
  const { F, db } = cloud;
  const itemSel = selectEl([['', t('k_pickItem')], ...K.items.map((x) => [x.id, x.name])], '', () => {});
  const qty = h('input', { class: 'field', type: 'number', inputmode: 'decimal', step: 'any', placeholder: t('k_qty') });
  const reason = selectEl(KWASTE.map((r) => [r, kl('wr', r)]), 'damaged', () => {});
  body.append(h('div', { class: 'tedit' }, h('div', { class: 'subhead', text: '+ ' + t('k_logWaste') }), itemSel, h('div', { class: 'row' }, qty, reason),
    h('button', { class: 'btn solid', type: 'button', text: t('add'), onclick: async () => {
      const it = kItem(itemSel.value), q = +qty.value || 0; if (!it || !q) return;
      const wb = F.writeBatch(db);
      wb.set(F.doc(kCol('waste')), { itemId: it.id, name: it.name, unit: it.unit, qty: q, reason: reason.value, at: Date.now(), by: myName(), cost: it.price ? q * it.price : 0 });
      wb.update(kRef('items', it.id), { stock: F.increment(-q) });
      await wb.commit().catch(kErr); toast(t('k_wasteSaved'));
    } })));
  const wk = Date.now() - 7 * DAY, list = K.waste.slice().sort((a, b) => b.at - a.at);
  const cost7 = list.filter((w) => w.at >= wk).reduce((a, w) => a + (w.cost || 0), 0);
  const tiles = h('div', { class: 'tiles' });
  tiles.append(h('div', { class: 'tile' }, h('b', { text: n(list.filter((w) => w.at >= wk).length) }), h('span', { text: t('k_wasteWeek') })),
    h('div', { class: 'tile' + (cost7 ? ' bad' : '') }, h('b', { text: money(cost7) || '—' }), h('span', { text: t('k_wasteCost') })));
  body.append(tiles);
  const ul = h('ul', { class: 'klist' });
  list.slice(0, 60).forEach((w) => ul.append(h('li', { class: 'krow' }, h('div', { class: 'kmain' },
    h('div', null, h('b', { text: w.name }), h('small', { class: 'from', text: ' · ' + kl('wr', w.reason) + ' · ' + (w.by || '') + ' · ' + fmtTs(w.at) })),
    h('span', { class: 'kqty', text: n(+w.qty) + ' ' + kl('units', w.unit) + (w.cost ? ' · ' + money(w.cost) : '') })))));
  if (!list.length) ul.append(h('li', { class: 'muted', text: t('k_noWaste') }));
  body.append(ul);
}

/* ---------- 🚚 الموردين ---------- */
function kSuppliers(body) {
  body.append(h('div', { class: 'row' },
    h('label', null, t('k_business'), h('input', { class: 'field', value: state.profile.business || '', onchange: (e) => { state.profile.business = e.target.value.trim(); save(); } })),
    h('label', null, t('k_currency'), h('input', { class: 'field', value: state.profile.currency || '€', onchange: (e) => { state.profile.currency = e.target.value.trim() || '€'; save(); kRender(); } }))));
  body.append(h('button', { class: 'btn solid', type: 'button', text: '+ ' + t('k_supplier'), onclick: async () => {
    const r = await cloud.F.addDoc(kCol('suppliers'), { name: '', phone: '', days: '', lang }).catch(kErr); if (r) { K.open = r.id; kRender(); }
  } }));
  const ul = h('ul', { class: 'klist' });
  K.suppliers.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '')).forEach((sp) => {
    const isOpen = K.open === sp.id, upd = (f) => cloud.F.updateDoc(kRef('suppliers', sp.id), f).catch(kErr);
    const cnt = K.items.filter((x) => x.supplierId === sp.id).length;
    const li = h('li', { class: 'krow' }, h('div', { class: 'kmain', onclick: () => { K.open = isOpen ? null : sp.id; kRender(); } },
      h('div', null, h('b', { text: sp.name || '—' }), h('small', { class: 'from', text: ' · ' + n(cnt) + ' ' + t('k_itemsN') + (sp.days ? ' · ' + sp.days : '') })),
      sp.phone ? h('button', { class: 'iconbtn', type: 'button', text: '💬', onclick: (e) => { e.stopPropagation(); openExternal('https://wa.me/' + sp.phone.replace(/\D/g, '').replace(/^00/, '')); } }) : null));
    if (isOpen) li.append(h('div', { class: 'tedit' },
      h('input', { class: 'field', value: sp.name || '', placeholder: t('name'), onchange: (e) => upd({ name: e.target.value.trim() }) }),
      h('div', { class: 'row' },
        h('input', { class: 'field', value: sp.phone || '', placeholder: t('phone'), dir: 'ltr', inputmode: 'tel', onchange: (e) => upd({ phone: e.target.value.trim() }) }),
        h('input', { class: 'field', value: sp.days || '', placeholder: t('k_days'), onchange: (e) => upd({ days: e.target.value.trim() }) })),
      selectEl(['ar', 'en', 'me'].map((l) => [l, '🌐 ' + window.L[l].langName]), sp.lang || lang, (v) => upd({ lang: v })),
      h('button', { class: 'btn danger', type: 'button', text: t('remove'), onclick: () => { if (confirmTwice(li)) cloud.F.deleteDoc(kRef('suppliers', sp.id)).catch(kErr); } })));
    ul.append(li);
  });
  if (!K.suppliers.length) ul.append(h('li', { class: 'muted', text: t('k_noSuppliers') }));
  body.append(ul);
}

$('kitchenBtn').addEventListener('click', () => (K.on ? kClose() : kOpen()));

applyLang();
if (CFG) startCloud();
else {
  loadLocal(); showApp(); render(); setSync('local'); scheduleNotifs();
  setBanner('bannerDemo');
}
