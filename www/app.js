/* مشاريعي: خطط المشاريع، الفريق، المتابعات، المعاملات، المشاركة والتذكيرات */
const CFG = window.FIREBASE_CONFIG;
const CAP = window.Capacitor;
const isNative = !!(CAP && CAP.isNativePlatform && CAP.isNativePlatform());
const LN = isNative && CAP.registerPlugin ? CAP.registerPlugin('LocalNotifications') : null;
const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
const LKEY = 'mashari3-board', LANGKEY = 'mashari3-lang';

let state = { projects: [], team: [], profile: {} };
let selected = null, openTask = null, openAssigned = null, query = '';
let cloud = null;           // {db, F, ref, user, signOut}
let writing = false, pending = false, timer = null, dirty = false, lastWritten = '';
let toMe = [];              // مهام متبعتالي من ناس تانية
let ownerSharedReady = false;
let filesCache = {}, fileSub = { key: '', unsub: null };
const NKEY = 'mashari3-notified';
let notified = new Set(); try { notified = new Set(JSON.parse(localStorage.getItem(NKEY) || '[]')); } catch (e) {}
function markNotified(k) { notified.add(k); try { localStorage.setItem(NKEY, JSON.stringify([...notified].slice(-300))); } catch (e) {} }

const $ = (id) => document.getElementById(id);
const plist = $('plist'), detail = $('detail'), nowEl = $('now');

/* ---------------- language ---------------- */
let lang = 'ar';
try { lang = localStorage.getItem(LANGKEY) || 'ar'; } catch (e) {}
if (!window.L[lang]) lang = 'ar';
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
function save() {
  processRepeats();
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
    taskId: x.id, brief: x.brief || '', urgent: !!x.urgent,
  };
}
function shareHash(p, x) { return JSON.stringify([p.name, x.text, x.date, x.time, x.kind, x.stage, x.office, x.ref, x.s, x.shareEmail, x.who, state.profile.name, x.brief, x.urgent]); }
let pendingUnshare = [];
function unshare(x) { if (x.shareId) pendingUnshare.push(x.shareId); delete x.shareId; delete x.shareEmail; delete x._sh; delete x.seenAt; delete x.reply; }
function pushShared() {
  if (!cloud || !cloud.user) return;
  const { F, db } = cloud;
  pendingUnshare.splice(0).forEach((sid) => {
    F.deleteDoc(F.doc(db, 'shared', sid)).catch((e) => console.warn(e));
    ownerFiles((d) => F.updateDoc(d.ref, { assigneeEmail: '', shareId: '' }).catch(() => {}), ['shareId', sid]);
  });
  if (!ownerSharedReady) return;
  allTasks().forEach(({ p, t: x }) => {
    if (!x.shareEmail) return;
    if (!x.shareId) x.shareId = cloud.user.uid.slice(0, 8) + '_' + uid() + uid();
    const hsh = shareHash(p, x);
    if (hsh === x._sh) return;
    if (!x._sh) linkFiles(x);
    const now = Date.now();
    x._sh = hsh; x.shAt = now;
    F.setDoc(F.doc(db, 'shared', x.shareId), { ...shareFields(p, x), updatedBy: 'owner', updatedAt: now }, { merge: true }).catch((e) => console.warn('share', e));
  });
}
function mergeFromShared(sid, d) {
  const hit = allTasks().find(({ t: x }) => x.shareId === sid); if (!hit) return;
  const { p, t: x } = hit;
  let changed = false, note = '';
  if (d.seenAt && d.seenAt !== x.seenAt) { x.seenAt = d.seenAt; changed = true; }
  if (d.updatedBy === 'assignee' && (d.updatedAt || 0) > (x.shAt || 0)) {
    if (d.s !== x.s || (x.kind === 'm' && d.stage !== x.stage)) {
      if (x.kind === 'm') setStage(x, d.stage || 0); else x.s = d.s;
      if (x.s === 2) x.follow = 0;
      note = x.kind === 'm' ? STG()[x.stage || 0] : (x.s === 2 ? t('sDone') : x.s === 1 ? t('sDoing') : t('sTodo'));
    }
    if ((d.reply || '') !== (x.reply || '')) { x.reply = d.reply || ''; note = note || (t('replyLabel') + x.reply); }
    if ((d.photoAt || 0) > (x.photoAt || 0)) { x.photoAt = d.photoAt; note = note || '📷'; if (filesCache[x.id]) delete filesCache[x.id]; }
    x.shAt = d.updatedAt; changed = true;
  }
  if (!changed) return;
  x._sh = shareHash(p, x); touch(p);
  if (note) {
    const msg = t('teamUpdate', x.who || d.assigneeName || '', x.text + ' (' + note + ')');
    toast(msg);
    const k = 'u:' + sid + ':' + d.updatedAt;
    if (!notified.has(k)) { markNotified(k); notifyNow(t('appName'), msg, { pid: p.id, tid: x.id }); }
  }
  save(); const a = document.activeElement;
  if (a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT')) renderList(); else render();
}
function updateAssigned(id, fields) {
  if (!cloud) return;
  const { F, db } = cloud;
  F.updateDoc(F.doc(db, 'shared', id), { ...fields, updatedBy: 'assignee', updatedAt: Date.now() }).catch((e) => { console.warn(e); toast(t('syncErr')); });
}
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
  (ctx.mode === 'o' ? ['before', 'after', 'doc'] : ['after', 'doc']).forEach((k) =>
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
  if (ctx.mode === 'o') {
    Object.assign(d, { ownerUid: user.uid, taskId: ctx.x.id });
    if (ctx.x.shareEmail && ctx.x.shareId) Object.assign(d, { assigneeEmail: ctx.x.shareEmail, shareId: ctx.x.shareId });
  } else {
    Object.assign(d, { ownerUid: ctx.x.ownerUid, taskId: ctx.x.taskId || '', assigneeEmail: (user.email || '').toLowerCase(), shareId: ctx.x.id });
  }
  try {
    await F.addDoc(F.collection(db, 'files'), d);
    toast(t('uploaded'));
    if (ctx.mode === 'a') updateAssigned(ctx.x.id, { photoAt: Date.now() });
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

/* ---------------- WhatsApp ---------------- */
function waLink(p, x) {
  const m = member(x.who);
  const digits = m && m.phone ? m.phone.replace(/\D/g, '').replace(/^00/, '') : '';
  const msg = t('waMsg', {
    name: x.who || '', text: x.text, project: p.name, due: x.date ? fmtDue(x) : '',
    follow: x.follow && x.follow > Date.now() ? fmtTs(x.follow) : '', from: (state.profile.name || '').trim(),
  });
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
  const main = out.sort((a, b) => a.at - b.at).slice(0, 50);
  if (state.profile.digest !== false) {
    for (let i = 0; i < 7; i++) {
      const d = new Date(); d.setDate(d.getDate() + i); d.setHours(9, 0, 0, 0);
      if (d.getTime() <= now) continue;
      const ds = dstr(d);
      let c = 0;
      allTasks().forEach(({ t: x }) => { if (x.s !== 2 && (x.date === ds || (x.follow && dstr(new Date(x.follow)) === ds))) c++; });
      toMe.forEach((x) => { if (x.s !== 2 && x.date === ds) c++; });
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
  const list = toMe.slice().sort((a, b) => (a.s === 2) - (b.s === 2) || (dueTs(a) || 9e15) - (dueTs(b) || 9e15));
  const open = list.filter((x) => x.s !== 2);
  el.hidden = !open.length && !list.some((x) => x.id === openAssigned);
  if (el.hidden) return;
  el.append(h('h3', { text: t('assignedToMe') + ' (' + n(open.length) + ')' }));
  const ul = h('ul', { class: 'assigned' });
  list.filter((x) => x.s !== 2 || x.id === openAssigned).forEach((x) => {
    const isOpen = openAssigned === x.id, dk = dueKind(x);
    const st = h('button', { class: 'st', 'data-s': x.s || 0, 'aria-label': x.kind === 'm' ? t('aStage', STG()[x.stage || 0]) : (x.s === 0 ? t('aTodo') : x.s === 1 ? t('aDoing') : t('aDone')), onclick: () => {
      if (x.kind === 'm') { const k = ((x.stage || 0) + 1) % 4; x.stage = k; x.s = k === 3 ? 2 : k === 0 ? 0 : 1; updateAssigned(x.id, { stage: x.stage, s: x.s }); }
      else { x.s = ((x.s || 0) + 1) % 3; updateAssigned(x.id, { s: x.s }); }
      renderList();
    } });
    const li = h('li', { id: 'a-' + x.id },
      h('div', { class: 'arow' }, st,
        h('div', { class: 'tbody', onclick: () => { openAssigned = isOpen ? null : x.id; renderList(); } },
          h('div', { text: (x.urgent ? '🔴 ' : '') + x.text }),
          h('div', { class: 'from', text: t('fromX', x.ownerName || x.ownerEmail) + ' · ' + x.projectName + (x.kind === 'm' ? ' · ' + STG()[x.stage || 0] : '') }),
          x.date ? h('span', { class: 'when ' + dk, text: (dk === 'over' ? t('late') : '') + fmtDue(x) }) : null)));
    if (isOpen) {
      const ta = h('textarea', { class: 'field', placeholder: t('replyPh') }); ta.value = x.reply || '';
      galCtx['a:' + x.id] = { mode: 'a', x }; watchFiles('a:' + x.id);
      const box = h('div', { class: 'areply' },
        x.brief ? h('p', { class: 'brief', text: x.brief }) : null,
        h('div', { class: 'subhead', text: t('photos') }), gallery('a:' + x.id),
        ta, h('div', { class: 'shareline' },
        h('button', { class: 'btn solid', text: t('send'), onclick: () => { x.reply = ta.value.trim(); updateAssigned(x.id, { reply: x.reply, replyAt: Date.now() }); toast('✓'); } })));
      if (x.kind === 'm') {
        const stg = h('div', { class: 'stages' });
        STG().forEach((s, k) => stg.append(h('button', { class: 'chip', 'aria-pressed': (x.stage || 0) === k ? 'true' : 'false', text: s, onclick: () => {
          x.stage = k; x.s = k === 3 ? 2 : k === 0 ? 0 : 1; updateAssigned(x.id, { stage: k, s: x.s }); renderList();
        } })));
        box.prepend(stg);
      }
      li.append(box);
    }
    ul.append(li);
  });
  el.append(ul);
}

function renderSoon() {
  const el = $('soon'); el.replaceChildren();
  const now = Date.now(), lim = now + 7 * 86400000, items = [];
  allTasks().forEach(({ p, t: x }) => {
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
    const late = type !== 'u' && at <= now;
    const label = type === 'u' ? t('urgent') : type === 'f' ? t('lblFollow', x.who || t('whoDefault')) : x.kind === 'm' ? t('lblPickup') : t('lblDue');
    const li = h('li', null, h('button', { onclick: () => { openTask = x.id; select(p.id); } },
      h('span', null, h('small', { text: label + '  |  ' + p.name }), x.text),
      h('span', { class: 'when' + (late ? ' over' : (type === 'd' && dueKind(x) === 'today') ? ' today' : ''), text: type === 'u' ? '' : (late ? t('late') : '') + (type === 'd' ? fmtDue(x) : fmtTs(at)) })));
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
    h('div', { class: 'name' }, h('span', { class: 'hl', text: p.name }), urg ? h('span', { class: 'urgc', text: ' 🔴 ' + n(urg) }) : null),
    p.note ? h('p', { class: 'line' }, h('b', { text: t('stoppedAt') }), p.note) : null,
    !p.note && nx ? h('p', { class: 'line' }, h('b', { text: t('nextShort') }), nx.text) : null,
    h('div', { class: 'bar' }, h('span', { style: 'width:' + g.pct + '%' })),
    h('div', { class: 'pfoot' },
      h('span', { text: g.t ? t('doneOf', n(g.d), n(g.t)) : t('noStepsShort') }),
      h('span', { class: stale ? 'stale' : '', text: p.updatedAt ? (stale ? t('staleAt', rel(p.updatedAt)) : t('lastEdit', rel(p.updatedAt))) : '' }))));
}
function renderList() {
  document.body.classList.toggle('show-detail', !!selected);
  renderPeople(); renderResults(); renderMine(); renderSoon();
  const doing = allTasks().filter(({ t: x }) => x.s === 1 && x.kind !== 'm');
  nowEl.hidden = !doing.length; nowEl.replaceChildren();
  if (doing.length) {
    nowEl.append(h('h3', { text: t('nowDoing') }));
    const ul = h('ul');
    doing.forEach(({ p, t: x }) => ul.append(h('li', null, h('button', { onclick: () => { openTask = x.id; select(p.id); } }, h('small', { text: p.name + (x.who ? '  |  ' + x.who : '') }), x.text))));
    nowEl.append(ul);
  }
  plist.replaceChildren();
  if (!state.projects.length) {
    plist.append(h('li', null, h('div', { class: 'empty' }, h('p', { text: t('emptyProjects') }), h('button', { class: 'btn solid', onclick: openAdd, text: t('addProjectBtn') }))));
    return;
  }
  activeProjects().forEach((p) => plist.append(projectCard(p)));
  const arch = state.projects.filter((p) => p.archived);
  if (arch.length) {
    const ul = h('ul', { class: 'plist' }); arch.forEach((p) => ul.append(projectCard(p)));
    plist.append(h('li', null, h('details', { class: 'donegrp' }, h('summary', { text: t('archivedGroup', n(arch.length)) }), ul)));
  }
}

/* ---------------- rendering: detail ---------------- */
function cycle(p, x) {
  if (x.kind === 'm') setStage(x, ((x.stage || 0) + 1) % 4);
  else x.s = (x.s + 1) % 3;
  if (x.s === 2) x.follow = 0;
  touch(p); save(); render();
}

function editPanel(p, x) {
  const upd = () => { touch(p); save(); render(); };
  const box = h('div', { class: 'tedit' });
  const who = x.who || t('whoDefault');

  box.append(h('label', null, t('whoQ'),
    h('input', { class: 'field', list: 'names', value: x.who || '', placeholder: t('whoPh'), onchange: (e) => {
      const v = e.target.value.trim();
      if (x.shareEmail && norm(v) !== norm(x.who)) unshare(x);
      x.who = v; upd();
    } })));

  // مشاركة
  if (x.who) {
    const m = member(x.who);
    const line = h('div', { class: 'shareline' }, h('span', { class: 'kind', text: t('shareHead') + ' ' + x.who + ':' }),
      h('button', { class: 'btn wa', type: 'button', text: t('shareWA'), onclick: () => openExternal(waLink(p, x)) }));
    box.append(line);
    if (cloud && m && m.email) {
      const chk = h('input', { type: 'checkbox', onchange: (e) => {
        if (e.target.checked) { x.shareEmail = m.email.trim().toLowerCase(); delete x._sh; } else unshare(x);
        upd();
      } });
      chk.checked = !!x.shareEmail;
      box.append(h('label', { class: 'check' }, chk, t('shareApp', x.who)));
    } else if (cloud && m && !m.email) box.append(h('span', { class: 'kind', text: t('noEmailHint', x.who) }));
    else if (!m) box.append(h('span', { class: 'kind', text: t('notInTeam', x.who) }));
  }

  // تفاصيل وعاجل
  const br = h('textarea', { class: 'field', placeholder: t('detailsPh'), rows: '2', onchange: (e) => { x.brief = e.target.value.trim(); upd(); } });
  br.value = x.brief || '';
  box.append(h('label', null, t('details'), br));
  const ug = h('input', { type: 'checkbox', onchange: (e) => { x.urgent = e.target.checked; upd(); } });
  ug.checked = !!x.urgent;
  box.append(h('label', { class: 'check' }, ug, t('urgent')));

  // معاملة
  const chk = h('input', { type: 'checkbox', onchange: (e) => { if (e.target.checked) { x.kind = 'm'; setStage(x, x.s === 2 ? 3 : x.s === 1 ? 1 : 0); } else { x.kind = ''; } upd(); } });
  chk.checked = x.kind === 'm';
  box.append(h('label', { class: 'check' }, chk, t('isTx')));
  if (x.kind === 'm') {
    box.append(h('div', { class: 'row' },
      h('label', null, t('office'), h('input', { class: 'field', value: x.office || '', placeholder: t('officePh'), onchange: (e) => { x.office = e.target.value.trim(); upd(); } })),
      h('label', null, t('ref'), h('input', { class: 'field', value: x.ref || '', dir: 'ltr', onchange: (e) => { x.ref = e.target.value.trim(); upd(); } }))));
    const st = h('div', { class: 'stages' });
    STG().forEach((s, k) => st.append(h('button', { class: 'chip', type: 'button', 'aria-pressed': (x.stage || 0) === k ? 'true' : 'false', text: s, onclick: () => { setStage(x, k); if (k === 3) x.follow = 0; upd(); } })));
    box.append(h('div', { class: 'subhead', text: t('whereNow') }), st);
  }

  // ميعاد
  box.append(h('div', { class: 'subhead', text: x.kind === 'm' ? t('pickupDate') : t('due') }));
  box.append(h('div', { class: 'row' },
    h('label', null, t('day'), h('input', { class: 'field', type: 'date', value: x.date || '', onchange: (e) => { x.date = e.target.value; if (!x.date) x.time = ''; upd(); } })),
    h('label', null, t('timeOpt'), h('input', { class: 'field', type: 'time', value: x.time || '', onchange: (e) => { x.time = e.target.value; if (x.time && !x.date) x.date = todayStr(); upd(); } }))));
  if (x.date) box.append(h('div', { class: 'acts' },
    h('span', { class: 'kind', text: dueTs(x) > Date.now() ? t('willRemind', fmtDue(x)) : t('dueLate', fmtDue(x)) }),
    h('button', { class: 'btn ghost', type: 'button', text: t('clearDue'), onclick: () => { x.date = ''; x.time = ''; upd(); } })));
  const rp = h('select', { class: 'field', onchange: (e) => { x.repeat = e.target.value; delete x.repeated; upd(); } });
  ['', 'd', 'w', 'm'].forEach((v, i) => { const o = h('option', { value: v, text: t('repeatOpts')[i] }); if ((x.repeat || '') === v) o.selected = true; rp.append(o); });
  box.append(h('label', null, t('repeat'), rp));

  // متابعة
  box.append(h('div', { class: 'subhead', text: t('followQ', who) }));
  const H = 3600000, D = 86400000, Q = [H, 3 * H, D, 2 * D, 3 * D, 7 * D, 14 * D];
  const quick = h('div', { class: 'quick' });
  t('quick').forEach((l, i) => quick.append(h('button', { class: 'btn', type: 'button', text: l, onclick: () => { x.follow = Date.now() + Q[i]; upd(); toast(t('followToast', who, fmtTs(x.follow))); } })));
  box.append(quick);
  const toLocal = (ts) => { const d = new Date(ts); return dstr(d) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  box.append(h('label', null, t('orPick'),
    h('input', { class: 'field', type: 'datetime-local', value: x.follow ? toLocal(x.follow) : '', onchange: (e) => { const v = e.target.value; x.follow = v ? new Date(v).getTime() : 0; upd(); } })));
  if (x.follow) box.append(h('div', { class: 'acts' },
    h('span', { class: 'kind', text: t('followAt', fmtTs(x.follow)) }),
    h('button', { class: 'btn ghost', type: 'button', text: t('cancelFollow'), onclick: () => { x.follow = 0; upd(); } })));
  if (x.lastReview) box.append(h('span', { class: 'kind', text: t('lastReview', rel(x.lastReview)) }));

  // صور وورق
  const key = 'o:' + x.id; galCtx[key] = { mode: 'o', p, x }; watchFiles(key);
  box.append(h('div', { class: 'subhead', text: t('photos') }), gallery(key));
  return box;
}

function taskRow(p, x) {
  const isOpen = openTask === x.id, dk = dueKind(x);
  const meta = [];
  if (x.urgent && x.s !== 2) meta.push(h('span', { class: 'urg', text: t('urgent') }));
  if (x.who) meta.push(h('span', { class: 'who', text: x.who }));
  if (x.shareEmail) meta.push(h('span', { class: 'shr', text: t('sharedWith', x.who || x.shareEmail) + (x.seenAt ? ' · ' + t('seen') : '') }));
  if (x.kind === 'm') meta.push(h('span', { class: 'stg' + (x.stage === 2 ? ' ready' : ''), text: STG()[x.stage || 0] + (x.office ? ' · ' + x.office : '') }));
  if (x.date) meta.push(h('span', { class: 'when ' + dk, text: (dk === 'over' ? t('late') : '') + fmtDue(x) }));
  if (x.follow && x.s !== 2) meta.push(h('span', { class: 'fol' + (x.follow <= Date.now() ? ' when over' : ''), text: t('review', fmtTs(x.follow)) }));
  if (x.reply) meta.push(h('span', { class: 'rep', text: t('replyLabel') + x.reply }));
  if (x.repeat) meta.push(h('span', { text: '♻️ ' + t('repeatOpts')[['', 'd', 'w', 'm'].indexOf(x.repeat)] }));
  if (x.photos || x.photoAt) meta.push(h('span', { text: '📷' }));
  if (x.brief) meta.push(h('span', { class: 'rep', text: '📝 ' + (x.brief.length > 40 ? x.brief.slice(0, 40) + '…' : x.brief) }));
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
    p.tasks.push({ id: uid(), text: v, s: 0 }); touch(p); save(); render();
    const f = detail.querySelector('.addt input'); if (f) f.focus();
  } }, addIn, h('button', { class: 'btn', type: 'submit', text: t('add') })));
  detail.append(h('p', { class: 'legend', text: t('legend') }));

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

function openTeam() {
  const box = h('div', { class: 'box', role: 'dialog', 'aria-label': t('team') });
  box.append(h('h2', { text: t('team') }), h('p', { class: 'muted', text: t('teamHint') }));
  const changed = () => { allTasks().forEach(({ t: x }) => { const m = member(x.who); if (x.shareEmail && (!m || (m.email || '').trim().toLowerCase() !== x.shareEmail)) unshare(x); }); save(); render(); };
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
      h('button', { class: 'btn ghost', type: 'button', text: t('remove'), onclick: () => { state.team = state.team.filter((y) => y !== m); changed(); openTeam(); } }));
    box.append(card);
  });
  box.append(h('button', { class: 'btn', text: t('addMember'), onclick: () => { state.team.push({ id: uid(), name: '', phone: '', email: '' }); save(); openTeam(); const ins = $('sheetRoot').querySelectorAll('.member input'); if (ins.length) ins[ins.length - 3].focus(); } }));
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
    A = a; F = f; app = core.initializeApp(CFG);
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
    if (!user) { cloud = null; state = { projects: [], team: [], profile: {} }; showLogin(); return; }
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
  });
}

window.addEventListener('online', () => { if (cloud) setSync('ok'); });
window.addEventListener('offline', () => setSync('offline'));
setInterval(() => { const a = document.activeElement; if (!(a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'))) renderList(); }, 60000);

applyLang();
if (CFG) startCloud();
else {
  loadLocal(); showApp(); render(); setSync('local'); scheduleNotifs();
  setBanner('bannerDemo');
}
