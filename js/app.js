import { Repo } from './github.js';

/* ================= Hilfsfunktionen ================= */

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('np.' + key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem('np.' + key, JSON.stringify(value));
    } catch {
      /* Speicher voll oder gesperrt: dann eben ohne Zwischenspeicher */
    }
  },
  del(key) {
    try {
      localStorage.removeItem('np.' + key);
    } catch {}
  },
};

const DEVICE = /iPhone|iPad|iPod/.test(navigator.userAgent)
  ? 'iPhone'
  : /Android/.test(navigator.userAgent) ? 'Handy' : 'PC';

const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });
const mobileQuery = window.matchMedia('(max-width: 700px)');
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const isMobile = () => mobileQuery.matches;

const NOTE_EXT = /\.(md|txt)$/i;
const isNotePath = (p) => NOTE_EXT.test(p) && !baseName(p).startsWith('.') && p.toLowerCase() !== 'readme.md';
const baseName = (p) => p.slice(p.lastIndexOf('/') + 1);
const dirName = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const noteName = (p) => baseName(p).replace(NOTE_EXT, '');
const noteExt = (p) => (p.match(NOTE_EXT) || ['.md'])[0];
const joinPath = (dir, name) => (dir ? dir + '/' + name : name);
const folderLabel = (p) => (p ? baseName(p) : 'Ordner');

function nameProblem(name) {
  if (!name) return 'Bitte einen Namen eingeben.';
  if (/[\\/:*?"<>|]/.test(name)) return 'Diese Zeichen gehen nicht: \\ / : * ? " < > |';
  if (name.startsWith('.')) return 'Der Name darf nicht mit einem Punkt beginnen.';
  if (/[. ]$/.test(name)) return 'Der Name darf nicht mit Punkt oder Leerzeichen enden.';
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(name)) return 'Dieser Name ist unter Windows reserviert.';
  if (name.length > 120) return 'Der Name ist zu lang.';
  return null;
}

function stamp(withYear = true) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${withYear ? d.getFullYear() : ''}`;
}
function timeStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function errorText(e) {
  switch (e && e.status) {
    case 0: return 'Keine Verbindung zum Internet.';
    case 401: return 'Der Token ist ungültig oder abgelaufen.';
    case 403: return 'Der Token hat dafür keine Berechtigung (nötig: Contents – Lesen und Schreiben).';
    case 404: return 'Repo oder Datei nicht gefunden. Stimmen Konto und Repo-Name, und darf der Token auf das Repo zugreifen?';
    default: return (e && e.message) || 'Unbekannter Fehler.';
  }
}

/* ================= Zustand ================= */

const settings = Object.assign(
  { theme: 'system', zoom: 100, wrap: true, sidebar: true, statusbar: true },
  store.get('settings', {})
);

const state = {
  repo: null,
  entries: new Map(), // Pfad -> sha, alle Dateien im Repo
  notes: new Map(), // Pfad -> sha, nur Notizen
  folders: new Set(), // alle Ordnerpfade
  expanded: new Set(store.get('expanded', [])),
  selectedFolder: '',
  current: null, // { path, sha, saved }
  dirty: false,
  saving: null, // laufender Speichervorgang (Promise)
  saveAgain: false,
  saveTimer: null,
  retryTimer: null,
  lastError: null,
  conflict: null, // { remoteText, remoteSha, deleted }
  offline: false,
  mobileFolder: store.get('mobileFolder', ''),
  lastRefresh: 0,
  busy: false,
};

const cache = new Map(Object.entries(store.get('cache', {}))); // sha -> Text
const drafts = store.get('drafts', {}); // Pfad -> { base, text }

function cachePut(sha, text) {
  cache.set(sha, text);
  persistCache();
}
let cacheTimer = null;
function persistCache() {
  clearTimeout(cacheTimer);
  cacheTimer = setTimeout(() => {
    const keep = new Set(state.entries.values());
    const obj = {};
    for (const [sha, text] of cache) if (keep.size === 0 || keep.has(sha)) obj[sha] = text;
    store.set('cache', obj);
  }, 500);
}

function saveDraft() {
  const cur = state.current;
  if (!cur) return;
  if (editor.value === cur.saved) delete drafts[cur.path];
  else drafts[cur.path] = { base: cur.sha, text: editor.value };
  store.set('drafts', drafts);
}
function dropDraft(path) {
  if (drafts[path]) {
    delete drafts[path];
    store.set('drafts', drafts);
  }
}

/* ================= Elemente ================= */

const editor = $('#editor');
const treeEl = $('#tree');
const resultsEl = $('#results');
const searchEl = $('#search');
const popup = $('#popup');

/* ================= Einstellungen ================= */

function applySettings() {
  const theme = settings.theme === 'system' ? (darkQuery.matches ? 'dark' : 'light') : settings.theme;
  document.documentElement.dataset.theme = theme;
  const bar = getComputedStyle(document.documentElement).getPropertyValue('--bar-bg').trim();
  document.querySelector('meta[name="theme-color"]').setAttribute('content', bar || '#3E5285');
  const base = isMobile() ? 16 : 15;
  document.documentElement.style.setProperty('--text-size', `${Math.round((base * settings.zoom) / 10) / 10}px`);
  editor.classList.toggle('nowrap', !settings.wrap);
  editor.setAttribute('wrap', settings.wrap ? 'soft' : 'off');
  document.body.classList.toggle('no-sidebar', !settings.sidebar);
  document.body.classList.toggle('no-statusbar', !settings.statusbar);
  updateStatus();
}

function setSetting(key, value) {
  settings[key] = value;
  store.set('settings', settings);
  applySettings();
}

function zoom(step) {
  const z = step === 0 ? 100 : Math.min(300, Math.max(50, settings.zoom + step));
  setSetting('zoom', z);
}

darkQuery.addEventListener('change', applySettings);
mobileQuery.addEventListener('change', () => {
  applySettings();
  renderSidebar();
  renderChrome();
});

/* ================= Meldungen ================= */

let toastTimer;
function toast(text, ms = 3200) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

/* ================= Repo laden ================= */

function setEntries(list) {
  state.entries.clear();
  state.notes.clear();
  state.folders.clear();
  for (const item of list) {
    if (item.type === 'tree') {
      if (!item.path.split('/').some((s) => s.startsWith('.'))) state.folders.add(item.path);
    } else if (item.type === 'blob') {
      state.entries.set(item.path, item.sha);
      if (isNotePath(item.path) && !item.path.split('/').slice(0, -1).some((s) => s.startsWith('.'))) {
        state.notes.set(item.path, item.sha);
      }
    }
  }
  store.set('tree', list.map(({ path, type, sha }) => ({ path, type, sha })));
}

let refreshing = null;
function refreshTree(opts = {}) {
  if (!refreshing) refreshing = doRefresh(opts).finally(() => (refreshing = null));
  return refreshing;
}

async function doRefresh({ quiet = false } = {}) {
  state.lastRefresh = Date.now();
  let list;
  try {
    list = await state.repo.listTree();
  } catch (e) {
    if (e.status === 401) return needSetup(errorText(e));
    if (e.status === 0) {
      if (!state.offline) {
        state.offline = true;
        if (!quiet) toast('Keine Verbindung. Du siehst den zuletzt geladenen Stand.');
      }
      updateStatus();
      return;
    }
    if (!quiet) toast(errorText(e));
    return;
  }
  const wasOffline = state.offline;
  state.offline = false;
  setEntries(list);
  persistCache();
  renderSidebar();
  await checkCurrentAgainstRemote();
  if (wasOffline && state.dirty) save();
  updateStatus();
}

// Prüft, ob die offene Notiz inzwischen woanders geändert wurde.
async function checkCurrentAgainstRemote() {
  const cur = state.current;
  if (!cur) return;
  if (state.saving || state.conflict) {
    if (cur.sha) {
      state.entries.set(cur.path, cur.sha);
      state.notes.set(cur.path, cur.sha);
    }
    return;
  }
  const remoteSha = state.notes.get(cur.path);
  if (remoteSha === cur.sha) return;
  // Ein Stand, den diese Notiz hier schon einmal hatte, ist nur eine verspätete Antwort von GitHub
  if (remoteSha && cur.seen.has(remoteSha)) {
    state.entries.set(cur.path, cur.sha);
    state.notes.set(cur.path, cur.sha);
    return;
  }

  if (remoteSha === undefined) {
    if (cur.sha) {
      state.conflict = { deleted: true, remoteText: '', remoteSha: null };
      showConflict();
    }
    return;
  }
  let text;
  try {
    text = cache.get(remoteSha) ?? (await state.repo.getBlob(remoteSha));
    cachePut(remoteSha, text);
  } catch {
    return;
  }
  if (state.current !== cur) return;
  if (!state.dirty) {
    const pos = [editor.selectionStart, editor.selectionEnd, editor.scrollTop];
    cur.seen.add(cur.sha);
    cur.sha = remoteSha;
    cur.seen.add(remoteSha);
    cur.saved = text;
    editor.value = text;
    editor.setSelectionRange(Math.min(pos[0], text.length), Math.min(pos[1], text.length));
    editor.scrollTop = pos[2];
    toast('Diese Notiz wurde auf einem anderen Gerät geändert und neu geladen.');
    updateStatus();
  } else {
    state.conflict = { remoteText: text, remoteSha, deleted: false };
    showConflict();
  }
}

/* ================= Ordnerleiste ================= */

function childrenOf(folder) {
  const prefix = folder ? folder + '/' : '';
  const folders = [];
  const notes = [];
  for (const f of state.folders) {
    if (f.startsWith(prefix) && !f.slice(prefix.length).includes('/') && f !== folder) folders.push(f);
  }
  for (const n of state.notes.keys()) {
    if (dirName(n) === folder) notes.push(n);
  }
  folders.sort((a, b) => collator.compare(baseName(a), baseName(b)));
  notes.sort((a, b) => collator.compare(noteName(a), noteName(b)));
  return { folders, notes };
}

function countNotes(folder) {
  const prefix = folder + '/';
  let n = 0;
  for (const p of state.notes.keys()) if (p.startsWith(prefix)) n++;
  return n;
}

function renderSidebar() {
  if (searchEl.value.trim()) {
    runSearch();
    return;
  }
  resultsEl.hidden = true;
  treeEl.hidden = false;
  treeEl.replaceChildren();
  if (isMobile()) renderMobileList();
  else renderTree();
}

function renderTree() {
  const frag = document.createDocumentFragment();
  const walk = (folder, depth) => {
    const { folders, notes } = childrenOf(folder);
    for (const f of folders) {
      const open = state.expanded.has(f);
      const row = el('div', 'row folder');
      row.dataset.folder = f;
      row.setAttribute('role', 'treeitem');
      row.setAttribute('aria-expanded', String(open));
      row.style.paddingLeft = `${6 + depth * 16}px`;
      if (state.selectedFolder === f) row.classList.add('selected');
      row.append(el('span', 'caret', open ? '▾' : '▸'), el('span', 'name', baseName(f)));
      frag.append(row);
      if (open) walk(f, depth + 1);
    }
    for (const n of notes) {
      const row = el('div', 'row note');
      row.dataset.note = n;
      row.setAttribute('role', 'treeitem');
      row.draggable = true;
      row.style.paddingLeft = `${6 + depth * 16}px`;
      if (state.current && state.current.path === n) row.classList.add('active');
      row.append(el('span', 'caret', ''), el('span', 'name', noteName(n)));
      frag.append(row);
    }
  };
  walk('', 0);
  if (!frag.childNodes.length) {
    frag.append(el('div', 'tree-empty', 'Noch keine Notizen. Leg mit „+ Notiz“ oder „+ Ordner“ los.'));
  }
  treeEl.append(frag);
}

function renderMobileList() {
  let folder = state.mobileFolder;
  if (folder && !state.folders.has(folder)) folder = state.mobileFolder = '';
  $('#m-heading').textContent = folder ? baseName(folder) : 'Ordner';
  const { folders, notes } = childrenOf(folder);
  const frag = document.createDocumentFragment();
  for (const f of folders) {
    const row = el('div', 'row folder');
    row.dataset.folder = f;
    row.append(el('span', 'name', baseName(f)), el('span', 'count', String(countNotes(f))), el('span', 'chev-right', '›'));
    frag.append(row);
  }
  for (const n of notes) {
    const row = el('div', 'row note');
    row.dataset.note = n;
    const text = cache.get(state.notes.get(n));
    const first = text ? text.split('\n').find((l) => l.trim()) || '' : '';
    row.append(el('span', 'name', noteName(n)), el('span', 'preview', first.trim() || ' '));
    frag.append(row);
  }
  loadPreviews(notes);
  if (!frag.childNodes.length) {
    frag.append(el('div', 'tree-empty', folder ? 'Dieser Ordner ist leer. Tippe auf „+ Neu“.' : 'Noch keine Notizen. Tippe auf „+ Neu“.'));
  }
  treeEl.append(frag);
}

// Erste Zeile der Notizen für die Liste am iPhone nachladen
const previewTried = new Set();
let previewLoading = false;
async function loadPreviews(paths) {
  if (previewLoading || state.offline || !state.repo) return;
  const missing = paths
    .map((p) => state.notes.get(p))
    .filter((sha) => sha && !cache.has(sha) && !previewTried.has(sha))
    .slice(0, 30);
  if (!missing.length) return;
  previewLoading = true;
  missing.forEach((sha) => previewTried.add(sha));
  await Promise.all(missing.map(async (sha) => {
    try {
      cache.set(sha, await state.repo.getBlob(sha));
    } catch {}
  }));
  previewLoading = false;
  persistCache();
  if (isMobile() && !searchEl.value.trim()) renderSidebar();
}

treeEl.addEventListener('click', (ev) => {
  const row = ev.target.closest('.row');
  if (!row) return;
  if (row.dataset.folder !== undefined) {
    const f = row.dataset.folder;
    if (isMobile()) {
      state.mobileFolder = f;
      store.set('mobileFolder', f);
      renderSidebar();
      renderChrome();
      treeEl.scrollTop = 0;
      return;
    }
    state.selectedFolder = f;
    if (state.expanded.has(f)) state.expanded.delete(f);
    else state.expanded.add(f);
    store.set('expanded', [...state.expanded]);
    renderSidebar();
  } else if (row.dataset.note) {
    openNote(row.dataset.note);
  }
});

treeEl.addEventListener('contextmenu', (ev) => {
  if (isMobile()) return;
  ev.preventDefault();
  const row = ev.target.closest('.row');
  if (row && row.dataset.note) showMenu(noteMenu(row.dataset.note), ev.clientX, ev.clientY);
  else if (row && row.dataset.folder !== undefined) {
    state.selectedFolder = row.dataset.folder;
    renderSidebar();
    showMenu(folderMenu(row.dataset.folder), ev.clientX, ev.clientY);
  } else {
    state.selectedFolder = '';
    renderSidebar();
    showMenu(folderMenu(''), ev.clientX, ev.clientY);
  }
});

// Ziehen und Ablegen: Notiz auf einen Ordner ziehen
let dragPath = null;
treeEl.addEventListener('dragstart', (ev) => {
  const row = ev.target.closest('.row.note');
  if (!row) return;
  dragPath = row.dataset.note;
  ev.dataTransfer.effectAllowed = 'move';
  ev.dataTransfer.setData('text/plain', dragPath);
});
treeEl.addEventListener('dragover', (ev) => {
  if (!dragPath) return;
  ev.preventDefault();
  treeEl.querySelectorAll('.drop').forEach((r) => r.classList.remove('drop'));
  const row = ev.target.closest('.row.folder');
  if (row) row.classList.add('drop');
});
treeEl.addEventListener('dragleave', (ev) => {
  if (ev.target.closest) ev.target.closest('.row')?.classList.remove('drop');
});
treeEl.addEventListener('drop', (ev) => {
  ev.preventDefault();
  treeEl.querySelectorAll('.drop').forEach((r) => r.classList.remove('drop'));
  const row = ev.target.closest('.row.folder');
  const target = row ? row.dataset.folder : '';
  const src = dragPath;
  dragPath = null;
  if (src && dirName(src) !== target) moveNote(src, target);
});
treeEl.addEventListener('dragend', () => (dragPath = null));

/* ================= Suche ================= */

let searchTimer;
searchEl.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderSidebar, 200);
});
searchEl.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') {
    searchEl.value = '';
    renderSidebar();
    if (state.current) editor.focus();
  } else if (ev.key === 'Enter') {
    resultsEl.querySelector('.result')?.click();
  }
});

let loadingAll = null;
async function loadAllNotes(onProgress) {
  const missing = [...state.notes.values()].filter((sha) => !cache.has(sha));
  let done = 0;
  const work = missing.slice();
  const worker = async () => {
    while (work.length) {
      const sha = work.pop();
      try {
        cache.set(sha, await state.repo.getBlob(sha));
      } catch {
        /* einzelne Datei überspringen */
      }
      done++;
      onProgress(done, missing.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, missing.length) }, worker));
  persistCache();
}

async function runSearch() {
  const q = searchEl.value.trim();
  treeEl.hidden = true;
  resultsEl.hidden = false;
  if (isMobile()) $('#m-heading').textContent = 'Suche';
  const needsLoad = [...state.notes.values()].some((sha) => !cache.has(sha));
  if (needsLoad && !state.offline) {
    resultsEl.replaceChildren(el('div', 'tree-empty', 'Notizen werden geladen …'));
    if (!loadingAll) {
      loadingAll = loadAllNotes((d, t) => {
        const info = resultsEl.querySelector('.tree-empty');
        if (info) info.textContent = `Notizen werden geladen … ${d} von ${t}`;
      }).finally(() => (loadingAll = null));
    }
    await loadingAll;
    if (searchEl.value.trim() !== q) return;
  }
  const needle = q.toLocaleLowerCase('de');
  const hits = [];
  for (const [path, sha] of state.notes) {
    const name = noteName(path);
    const text = path === state.current?.path ? editor.value : cache.get(sha) || '';
    const inName = name.toLocaleLowerCase('de').includes(needle);
    const idx = text.toLocaleLowerCase('de').indexOf(needle);
    if (inName || idx >= 0) hits.push({ path, name, text, idx, inName });
  }
  hits.sort((a, b) => (b.inName - a.inName) || collator.compare(a.name, b.name));
  const frag = document.createDocumentFragment();
  for (const h of hits.slice(0, 200)) {
    const r = el('div', 'result');
    r.dataset.note = h.path;
    r.dataset.idx = String(h.idx);
    r.append(el('div', 'r-name', h.name), el('div', 'r-path', dirName(h.path) || 'Hauptordner'));
    if (h.idx >= 0) {
      const start = Math.max(0, h.idx - 30);
      const snip = el('div', 'r-snip');
      snip.append(
        (start > 0 ? '…' : '') + h.text.slice(start, h.idx).replace(/\s+/g, ' '),
        el('mark', '', h.text.slice(h.idx, h.idx + q.length)),
        h.text.slice(h.idx + q.length, h.idx + q.length + 60).replace(/\s+/g, ' ')
      );
      r.append(snip);
    }
    frag.append(r);
  }
  if (!hits.length) frag.append(el('div', 'tree-empty', `Nichts gefunden für „${q}“.`));
  resultsEl.replaceChildren(frag);
}

resultsEl.addEventListener('click', async (ev) => {
  const r = ev.target.closest('.result');
  if (!r) return;
  const idx = Number(r.dataset.idx);
  const len = searchEl.value.trim().length;
  await openNote(r.dataset.note);
  if (idx >= 0 && state.current?.path === r.dataset.note) {
    editor.focus();
    editor.setSelectionRange(idx, idx + len);
    // grob an die Fundstelle scrollen
    const lines = editor.value.slice(0, idx).split('\n').length;
    const lh = parseFloat(getComputedStyle(editor).lineHeight) || 22;
    editor.scrollTop = Math.max(0, (lines - 3) * lh);
  }
});

/* ================= Notiz öffnen und speichern ================= */

async function openNote(path, { keepView = false } = {}) {
  if (state.current && state.current.path === path) {
    if (isMobile() && !keepView) showMobileEditor(true);
    return;
  }
  await flushSave();
  const sha = state.notes.get(path);
  let text = cache.get(sha);
  let realSha = sha;
  if (text === undefined) {
    setSaveText('Wird geladen …', 'busy');
    try {
      const f = await state.repo.getFile(path);
      text = f.content;
      realSha = f.sha;
      cachePut(realSha, text);
    } catch (e) {
      if (e.status === 401) return needSetup(errorText(e));
      toast(e.status === 404 ? 'Diese Notiz gibt es nicht mehr.' : errorText(e));
      if (e.status === 404) refreshTree({ quiet: true });
      updateStatus();
      return;
    }
  }
  state.current = { path, sha: realSha, saved: text, seen: new Set([realSha]) };
  state.conflict = null;
  state.dirty = false;
  state.lastError = null;
  hideConflict();
  editor.value = text;
  editor.hidden = false;
  $('#empty').hidden = true;
  editor.scrollTop = 0;
  editor.setSelectionRange(0, 0);

  const d = drafts[path];
  if (d && d.text !== text) {
    editor.value = d.text;
    state.dirty = true;
    if (d.base === realSha) {
      toast('Nicht gespeicherte Änderungen wurden wiederhergestellt.');
      scheduleSave(300);
    } else {
      state.conflict = { remoteText: text, remoteSha: realSha, deleted: false };
      showConflict();
    }
  } else if (d) {
    dropDraft(path);
  }

  store.set('last', path);
  const folder = dirName(path);
  if (folder) {
    let f = folder;
    while (f) {
      state.expanded.add(f);
      f = dirName(f);
    }
    store.set('expanded', [...state.expanded]);
  }
  state.selectedFolder = folder;
  if (isMobile()) {
    state.mobileFolder = folder;
    store.set('mobileFolder', folder);
    if (!keepView) showMobileEditor(true);
  } else {
    editor.focus();
  }
  renderSidebar();
  renderChrome();
  updateStatus();
  // Beim Öffnen nachsehen, ob es inzwischen einen neueren Stand gibt
  refreshTree({ quiet: true });
}

function closeNote() {
  state.current = null;
  state.dirty = false;
  state.conflict = null;
  hideConflict();
  editor.value = '';
  editor.hidden = true;
  $('#empty').hidden = false;
  store.del('last');
  if (isMobile()) showMobileEditor(false);
  renderSidebar();
  renderChrome();
  updateStatus();
}

function scheduleSave(ms = 1200) {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(save, ms);
}

editor.addEventListener('input', () => {
  if (!state.current) return;
  state.dirty = editor.value !== state.current.saved;
  saveDraft();
  if (state.dirty && !state.conflict) scheduleSave();
  updateStatus();
  updateTitle();
});

async function save() {
  clearTimeout(state.saveTimer);
  const cur = state.current;
  if (!cur || state.conflict) return;
  if (state.saving) {
    state.saveAgain = true;
    return state.saving;
  }
  const text = editor.value;
  if (text === cur.saved && cur.sha) {
    state.dirty = false;
    dropDraft(cur.path);
    updateStatus();
    return;
  }
  const run = (async () => {
    updateStatus();
    try {
      const res = await state.repo.putFile(cur.path, text, cur.sha, `${cur.sha ? 'Notiz geändert' : 'Notiz angelegt'}: ${cur.path} (${DEVICE})`);
      if (cur.sha) cur.seen.add(cur.sha);
      cur.sha = res.sha;
      cur.seen.add(res.sha);
      cur.saved = text;
      state.entries.set(cur.path, res.sha);
      state.notes.set(cur.path, res.sha);
      cachePut(res.sha, text);
      state.lastError = null;
      state.offline = false;
      clearTimeout(state.retryTimer);
      if (state.current === cur) {
        state.dirty = editor.value !== text;
        if (!state.dirty) dropDraft(cur.path);
        else saveDraft();
      }
    } catch (e) {
      if (e.conflict) {
        await loadConflict(cur);
      } else if (e.status === 401) {
        needSetup(errorText(e));
      } else {
        state.lastError = e;
        if (e.status === 0) state.offline = true;
        clearTimeout(state.retryTimer);
        state.retryTimer = setTimeout(() => state.dirty && save(), 15000);
      }
    }
  })();
  state.saving = run;
  try {
    await run;
  } finally {
    state.saving = null;
    updateStatus();
    updateTitle();
  }
  if (state.saveAgain) {
    state.saveAgain = false;
    if (state.current === cur && state.dirty && !state.conflict) await save();
  }
}

async function flushSave() {
  clearTimeout(state.saveTimer);
  if (state.saving) await state.saving;
  if (state.current && state.dirty && !state.conflict) await save();
}

/* ================= Konflikte ================= */

async function loadConflict(cur) {
  let remoteText = '';
  let remoteSha = null;
  let deleted = false;
  try {
    const f = await state.repo.getFile(cur.path);
    remoteText = f.content;
    remoteSha = f.sha;
    cachePut(remoteSha, remoteText);
  } catch (e) {
    if (e.status === 404) deleted = true;
    else {
      state.lastError = e;
      return;
    }
  }
  if (state.current !== cur) return;
  state.conflict = { remoteText, remoteSha, deleted };
  showConflict();
}

function showConflict() {
  const c = state.conflict;
  const bar = $('#conflictbar');
  bar.hidden = false;
  $('#conflict-text').textContent = c.deleted
    ? 'Diese Notiz wurde auf einem anderen Gerät gelöscht oder verschoben. Deine Änderungen sind noch hier.'
    : 'Diese Notiz wurde auf einem anderen Gerät geändert, während du hier geschrieben hast. Welche Version soll gelten?';
  bar.querySelector('[data-conflict="mine"]').textContent = c.deleted ? 'Wieder speichern' : 'Meine Version behalten';
  bar.querySelector('[data-conflict="theirs"]').textContent = c.deleted ? 'Verwerfen' : 'Andere Version laden';
  bar.querySelector('[data-conflict="both"]').hidden = c.deleted;
  updateStatus();
}

function hideConflict() {
  $('#conflictbar').hidden = true;
}

$('#conflictbar').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('[data-conflict]');
  const cur = state.current;
  const c = state.conflict;
  if (!btn || !cur || !c) return;
  const action = btn.dataset.conflict;

  if (c.remoteSha) cur.seen.add(c.remoteSha);
  if (action === 'mine') {
    cur.sha = c.remoteSha;
    state.conflict = null;
    hideConflict();
    state.dirty = true;
    await save();
  } else if (action === 'theirs') {
    state.conflict = null;
    hideConflict();
    dropDraft(cur.path);
    if (c.deleted) {
      closeNote();
      await refreshTree({ quiet: true });
      return;
    }
    cur.sha = c.remoteSha;
    cur.saved = c.remoteText;
    editor.value = c.remoteText;
    state.dirty = false;
  } else if (action === 'both') {
    const mine = editor.value;
    const copyPath = uniquePath(dirName(cur.path), `${noteName(cur.path)} (${DEVICE} ${stamp(false)} ${timeStamp().replace(':', '-')})`, noteExt(cur.path));
    try {
      const res = await state.repo.putFile(copyPath, mine, null, `Konfliktkopie angelegt: ${copyPath} (${DEVICE})`);
      state.entries.set(copyPath, res.sha);
      state.notes.set(copyPath, res.sha);
      cachePut(res.sha, mine);
    } catch (e) {
      toast(errorText(e));
      return;
    }
    state.conflict = null;
    hideConflict();
    dropDraft(cur.path);
    cur.sha = c.remoteSha;
    cur.saved = c.remoteText;
    editor.value = c.remoteText;
    state.dirty = false;
    toast(`Deine Version liegt jetzt in „${noteName(copyPath)}“.`);
    renderSidebar();
  }
  updateStatus();
  updateTitle();
});

/* ================= Anlegen, Umbenennen, Verschieben, Löschen ================= */

function pathTaken(path) {
  const low = path.toLowerCase();
  for (const p of state.entries.keys()) if (p.toLowerCase() === low) return true;
  for (const f of state.folders) if (f.toLowerCase() === low) return true;
  return false;
}

function noteTaken(folder, name, except) {
  const low = joinPath(folder, name).toLowerCase();
  for (const p of state.notes.keys()) {
    if (p !== except && p.replace(NOTE_EXT, '').toLowerCase() === low) return true;
  }
  return false;
}

function uniquePath(folder, name, ext) {
  let candidate = name;
  let i = 2;
  while (noteTaken(folder, candidate) || pathTaken(joinPath(folder, candidate + ext))) candidate = `${name} ${i++}`;
  return joinPath(folder, candidate + ext);
}

// Wenn durch eine Änderung ein Ordner leer würde, bleibt er mit einer leeren .gitkeep erhalten.
// gone = Ordner, der absichtlich gelöscht wird.
function keepFolders(changes, gone = null) {
  const removed = new Set(changes.filter((c) => c.sha === null).map((c) => c.path));
  const remaining = [...state.entries.keys()]
    .filter((p) => !removed.has(p))
    .concat(changes.filter((c) => c.sha !== null).map((c) => c.path));
  const candidates = new Set();
  for (const p of removed) {
    for (let f = dirName(p); f; f = dirName(f)) candidates.add(f);
  }
  const extra = [];
  const covered = new Set();
  for (const f of [...candidates].sort((a, b) => b.length - a.length)) {
    if (gone && (f === gone || f.startsWith(gone + '/'))) continue;
    if (!state.folders.has(f) || covered.has(f)) continue;
    if (remaining.some((p) => p.startsWith(f + '/'))) continue;
    extra.push({ path: f + '/.gitkeep', content: '' });
    for (let a = dirName(f); a; a = dirName(a)) covered.add(a);
  }
  return changes.concat(extra);
}

async function withBusy(label, fn) {
  if (state.busy) return;
  state.busy = true;
  setSaveText(label, 'busy');
  try {
    await fn();
  } catch (e) {
    if (e.status === 401) needSetup(errorText(e));
    else toast(errorText(e));
  } finally {
    state.busy = false;
    updateStatus();
  }
}

function targetFolder() {
  if (isMobile()) return state.mobileFolder;
  return state.selectedFolder || (state.current ? dirName(state.current.path) : '');
}

async function newNote(folder = targetFolder()) {
  const where = folder ? `Ordner „${folderLabel(folder)}“` : 'Hauptordner';
  const name = await ask({
    title: 'Neue Notiz',
    text: `Wird im ${where} angelegt.`,
    value: noteName(uniquePath(folder, 'Neue Notiz', '.md')),
    ok: 'Anlegen',
    validate: (v) => nameProblem(v) || (noteTaken(folder, v) ? 'Eine Notiz mit diesem Namen gibt es hier schon.' : null),
  });
  if (name === null) return;
  const path = joinPath(folder, name + '.md');
  await flushSave();
  await withBusy('Wird angelegt …', async () => {
    const res = await state.repo.putFile(path, '', null, `Notiz angelegt: ${path} (${DEVICE})`);
    state.entries.set(path, res.sha);
    state.notes.set(path, res.sha);
    cachePut(res.sha, '');
    const gk = joinPath(folder, '.gitkeep');
    if (folder && state.entries.has(gk)) {
      // leere Platzhalterdatei wird nicht mehr gebraucht
      state.repo.commit([{ path: gk, sha: null }], `Platzhalter entfernt: ${gk} (${DEVICE})`)
        .then(() => state.entries.delete(gk))
        .catch(() => {});
    }
  });
  if (state.notes.has(path)) {
    await openNote(path);
    editor.focus();
  }
}

async function newFolder(parent = targetFolder()) {
  const where = parent ? `in „${folderLabel(parent)}“` : 'im Hauptordner';
  const name = await ask({
    title: 'Neuer Ordner',
    text: `Wird ${where} angelegt.`,
    value: '',
    ok: 'Anlegen',
    validate: (v) => nameProblem(v) || (pathTaken(joinPath(parent, v)) ? 'Diesen Namen gibt es hier schon.' : null),
  });
  if (name === null) return;
  const path = joinPath(parent, name);
  await withBusy('Ordner wird angelegt …', async () => {
    const res = await state.repo.putFile(path + '/.gitkeep', '', null, `Ordner angelegt: ${path} (${DEVICE})`);
    state.entries.set(path + '/.gitkeep', res.sha);
    state.folders.add(path);
    let f = parent;
    while (f) {
      state.expanded.add(f);
      f = dirName(f);
    }
    state.expanded.add(path);
    store.set('expanded', [...state.expanded]);
    state.selectedFolder = path;
    if (isMobile()) {
      state.mobileFolder = path;
      store.set('mobileFolder', path);
    }
  });
  renderSidebar();
  renderChrome();
}

async function renameNote(path) {
  if (!path) return;
  const folder = dirName(path);
  const name = await ask({
    title: 'Notiz umbenennen',
    value: noteName(path),
    ok: 'Umbenennen',
    validate: (v) => nameProblem(v) || (noteTaken(folder, v, path) ? 'Eine Notiz mit diesem Namen gibt es hier schon.' : null),
  });
  if (name === null || name === noteName(path)) return;
  await relocateNote(path, joinPath(folder, name + noteExt(path)), 'Notiz umbenannt');
}

async function moveNote(path, target) {
  if (!path) return;
  if (target === undefined) {
    const options = [{ value: '', label: 'Hauptordner' }].concat(
      [...state.folders].sort(collator.compare).map((f) => ({ value: f, label: f.split('/').join(' › ') }))
    );
    target = await ask({
      title: 'Notiz verschieben',
      text: `„${noteName(path)}“ verschieben nach:`,
      select: options,
      value: dirName(path),
      ok: 'Verschieben',
    });
    if (target === null) return;
  }
  if (target === dirName(path)) return;
  if (noteTaken(target, noteName(path))) {
    toast(`In „${folderLabel(target)}“ gibt es schon eine Notiz „${noteName(path)}“.`);
    return;
  }
  await relocateNote(path, joinPath(target, baseName(path)), 'Notiz verschoben');
}

async function relocateNote(from, to, verb) {
  if (state.current?.path === from) await flushSave();
  const sha = state.current?.path === from && state.current.sha ? state.current.sha : state.entries.get(from);
  if (!sha) return;
  await withBusy('Wird gespeichert …', async () => {
    let changes = [{ path: to, sha }, { path: from, sha: null }];
    const gk = joinPath(dirName(to), '.gitkeep');
    if (dirName(to) && state.entries.has(gk)) changes.push({ path: gk, sha: null });
    changes = keepFolders(changes);
    await state.repo.commit(changes, `${verb}: ${from} → ${to} (${DEVICE})`);
    if (state.current?.path === from) {
      state.current.path = to;
      store.set('last', to);
    }
    if (drafts[from]) {
      drafts[to] = drafts[from];
      delete drafts[from];
      store.set('drafts', drafts);
    }
    let f = dirName(to);
    while (f) {
      state.expanded.add(f);
      f = dirName(f);
    }
    store.set('expanded', [...state.expanded]);
    await refreshTree({ quiet: true });
  });
  renderChrome();
  updateTitle();
}

async function deleteNote(path) {
  if (!path) return;
  const ok = await ask({
    title: 'Notiz löschen',
    text: `„${noteName(path)}“ wirklich löschen? Im Verlauf auf GitHub bleibt sie erhalten und lässt sich zurückholen.`,
    ok: 'Löschen',
    danger: true,
  });
  if (ok === null) return;
  if (state.current?.path === path) {
    clearTimeout(state.saveTimer);
    if (state.saving) await state.saving;
  }
  await withBusy('Wird gelöscht …', async () => {
    await state.repo.commit(keepFolders([{ path, sha: null }]), `Notiz gelöscht: ${path} (${DEVICE})`);
    dropDraft(path);
    if (state.current?.path === path) closeNote();
    await refreshTree({ quiet: true });
  });
}

async function renameFolder(path) {
  if (!path) return;
  const parent = dirName(path);
  const name = await ask({
    title: 'Ordner umbenennen',
    value: baseName(path),
    ok: 'Umbenennen',
    validate: (v) => {
      const p = nameProblem(v);
      if (p) return p;
      if (v.toLowerCase() !== baseName(path).toLowerCase() && pathTaken(joinPath(parent, v))) return 'Diesen Namen gibt es hier schon.';
      return null;
    },
  });
  if (name === null || name === baseName(path)) return;
  const to = joinPath(parent, name);
  if (state.current && state.current.path.startsWith(path + '/')) await flushSave();
  await withBusy('Ordner wird umbenannt …', async () => {
    const prefix = path + '/';
    const changes = [];
    for (const [p, sha] of state.entries) {
      if (p.startsWith(prefix)) {
        changes.push({ path: to + '/' + p.slice(prefix.length), sha });
        changes.push({ path: p, sha: null });
      }
    }
    await state.repo.commit(changes, `Ordner umbenannt: ${path} → ${to} (${DEVICE})`);
    const swap = (p) => (p === path ? to : p.startsWith(prefix) ? to + '/' + p.slice(prefix.length) : p);
    state.expanded = new Set([...state.expanded].map(swap));
    store.set('expanded', [...state.expanded]);
    state.selectedFolder = swap(state.selectedFolder);
    state.mobileFolder = swap(state.mobileFolder);
    store.set('mobileFolder', state.mobileFolder);
    if (state.current) {
      const np = swap(state.current.path);
      if (np !== state.current.path) {
        if (drafts[state.current.path]) {
          drafts[np] = drafts[state.current.path];
          delete drafts[state.current.path];
          store.set('drafts', drafts);
        }
        state.current.path = np;
        store.set('last', np);
      }
    }
    await refreshTree({ quiet: true });
  });
  renderChrome();
  updateTitle();
}

async function deleteFolder(path) {
  if (!path) return;
  const n = countNotes(path);
  const ok = await ask({
    title: 'Ordner löschen',
    text: n
      ? `Ordner „${baseName(path)}“ mit ${n} ${n === 1 ? 'Notiz' : 'Notizen'} löschen? Im Verlauf auf GitHub bleibt alles erhalten.`
      : `Den leeren Ordner „${baseName(path)}“ löschen?`,
    ok: 'Löschen',
    danger: true,
  });
  if (ok === null) return;
  const prefix = path + '/';
  if (state.current && state.current.path.startsWith(prefix)) {
    clearTimeout(state.saveTimer);
    if (state.saving) await state.saving;
  }
  await withBusy('Ordner wird gelöscht …', async () => {
    const changes = [...state.entries.keys()].filter((p) => p.startsWith(prefix)).map((p) => ({ path: p, sha: null }));
    if (changes.length) await state.repo.commit(keepFolders(changes, path), `Ordner gelöscht: ${path} (${DEVICE})`);
    for (const p of Object.keys(drafts)) if (p.startsWith(prefix)) delete drafts[p];
    store.set('drafts', drafts);
    if (state.current && state.current.path.startsWith(prefix)) closeNote();
    if (state.mobileFolder === path || state.mobileFolder.startsWith(prefix)) {
      state.mobileFolder = dirName(path);
      store.set('mobileFolder', state.mobileFolder);
    }
    state.selectedFolder = dirName(path);
    await refreshTree({ quiet: true });
  });
  renderChrome();
}

async function disconnect() {
  const open = Object.keys(drafts).length;
  const ok = await ask({
    title: 'Verbindung trennen',
    text: open
      ? `Es gibt noch ${open} nicht gespeicherte Änderung(en). Wenn du trennst, gehen sie verloren. Der Token wird von diesem Gerät entfernt.`
      : 'Der Token wird von diesem Gerät entfernt. Deine Notizen bleiben auf GitHub.',
    ok: 'Trennen',
    danger: true,
  });
  if (ok === null) return;
  ['cfg', 'cache', 'drafts', 'tree', 'last'].forEach(store.del);
  location.reload();
}

/* ================= Menüs ================= */

function noteMenu(path) {
  return [
    { label: 'Öffnen', action: () => openNote(path) },
    '-',
    { label: 'Umbenennen …', key: 'F2', action: () => renameNote(path) },
    { label: 'Verschieben …', action: () => moveNote(path) },
    { label: 'Löschen …', danger: true, action: () => deleteNote(path) },
  ];
}

function folderMenu(folder) {
  const items = [
    { label: 'Neue Notiz hier', action: () => newNote(folder) },
    { label: folder ? 'Neuer Unterordner …' : 'Neuer Ordner …', action: () => newFolder(folder) },
  ];
  if (folder) {
    items.push('-',
      { label: 'Ordner umbenennen …', action: () => renameFolder(folder) },
      { label: 'Ordner löschen …', danger: true, action: () => deleteFolder(folder) });
  }
  return items;
}

const themeItems = () => [
  { label: 'Design wie System', checked: settings.theme === 'system', action: () => setSetting('theme', 'system') },
  { label: 'Hell', checked: settings.theme === 'light', action: () => setSetting('theme', 'light') },
  { label: 'Dunkel', checked: settings.theme === 'dark', action: () => setSetting('theme', 'dark') },
];

const menus = {
  datei: () => {
    const p = state.current?.path;
    return [
      { label: 'Neue Notiz …', key: 'Strg+Alt+N', action: () => newNote() },
      { label: 'Neuer Ordner …', action: () => newFolder() },
      '-',
      { label: 'Speichern', key: 'Strg+S', disabled: !p, action: () => save() },
      { label: 'Umbenennen …', key: 'F2', disabled: !p, action: () => renameNote(p) },
      { label: 'Verschieben …', disabled: !p, action: () => moveNote(p) },
      { label: 'Löschen …', disabled: !p, danger: true, action: () => deleteNote(p) },
      '-',
      { label: 'Aktualisieren', action: () => refreshTree() },
      { label: 'Verbindung trennen …', action: () => disconnect() },
    ];
  },
  bearbeiten: () => {
    const has = !!state.current;
    return [
      { label: 'Rückgängig', key: 'Strg+Z', disabled: !has, action: () => { editor.focus(); document.execCommand('undo'); } },
      { label: 'Wiederholen', key: 'Strg+Y', disabled: !has, action: () => { editor.focus(); document.execCommand('redo'); } },
      '-',
      { label: 'Alles markieren', key: 'Strg+A', disabled: !has, action: () => { editor.focus(); editor.select(); } },
      { label: 'Uhrzeit/Datum einfügen', key: 'F5', disabled: !has, action: insertDate },
      '-',
      { label: 'In allen Notizen suchen', key: 'Strg+Umschalt+F', action: focusSearch },
    ];
  },
  ansicht: () => [
    { label: 'Vergrößern', key: 'Strg+Plus', action: () => zoom(10) },
    { label: 'Verkleinern', key: 'Strg+Minus', action: () => zoom(-10) },
    { label: 'Standardgröße', key: 'Strg+0', action: () => zoom(0) },
    '-',
    { label: 'Zeilenumbruch', checked: settings.wrap, action: () => setSetting('wrap', !settings.wrap) },
    { label: 'Ordnerleiste', key: 'Strg+B', checked: settings.sidebar, action: () => setSetting('sidebar', !settings.sidebar) },
    { label: 'Statusleiste', checked: settings.statusbar, action: () => setSetting('statusbar', !settings.statusbar) },
    '-',
    ...themeItems(),
  ],
};

let menuOwner = null;
function showMenu(items, x, y, owner = null) {
  popup.replaceChildren();
  for (const it of items) {
    if (it === '-') {
      popup.append(el('div', 'sep'));
      continue;
    }
    const b = el('button', 'item' + (it.disabled ? ' disabled' : '') + (it.danger ? ' danger' : ''));
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.append(el('span', 'check', it.checked ? '✓' : ''), el('span', 'label', it.label), el('span', 'key', it.key || ''));
    b.addEventListener('click', () => {
      hideMenu();
      it.action();
    });
    popup.append(b);
  }
  popup.hidden = false;
  const r = popup.getBoundingClientRect();
  popup.style.left = `${Math.max(4, Math.min(x, window.innerWidth - r.width - 4))}px`;
  popup.style.top = `${Math.max(4, Math.min(y, window.innerHeight - r.height - 4))}px`;
  menuOwner = owner;
  document.querySelectorAll('#menubar button').forEach((b) => b.classList.toggle('open', b === owner));
}

function hideMenu() {
  popup.hidden = true;
  menuOwner = null;
  document.querySelectorAll('#menubar button.open').forEach((b) => b.classList.remove('open'));
}

$('#menubar').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-menu]');
  if (!b) return;
  if (menuOwner === b) return hideMenu();
  const r = b.getBoundingClientRect();
  showMenu(menus[b.dataset.menu](), r.left, r.bottom + 2, b);
});
$('#menubar').addEventListener('mouseover', (ev) => {
  const b = ev.target.closest('button[data-menu]');
  if (b && menuOwner && menuOwner !== b) {
    const r = b.getBoundingClientRect();
    showMenu(menus[b.dataset.menu](), r.left, r.bottom + 2, b);
  }
});
document.addEventListener('mousedown', (ev) => {
  if (!popup.hidden && !popup.contains(ev.target) && !ev.target.closest('#menubar') && !ev.target.closest('#m-more')) hideMenu();
});
window.addEventListener('blur', hideMenu);
window.addEventListener('resize', hideMenu);

/* ================= Dialog ================= */

function ask({ title, text = '', value = '', ok = 'OK', danger = false, select = null, validate = null }) {
  return new Promise((resolve) => {
    const back = $('#dialog-backdrop');
    const form = $('#dialog');
    const input = $('#dialog-input');
    const sel = $('#dialog-select');
    const err = $('#dialog-error');
    const okBtn = $('#dialog-ok');
    const isPrompt = !select && validate;
    $('#dialog-title').textContent = title;
    $('#dialog-text').textContent = text;
    $('#dialog-text').hidden = !text;
    input.hidden = !isPrompt;
    sel.hidden = !select;
    err.hidden = true;
    okBtn.textContent = ok;
    okBtn.className = 'btn ' + (danger ? 'danger' : 'primary');
    if (isPrompt) input.value = value;
    if (select) {
      sel.replaceChildren(...select.map((o) => {
        const opt = el('option', '', o.label);
        opt.value = o.value;
        return opt;
      }));
      sel.value = value;
    }
    back.hidden = false;
    hideMenu();
    setTimeout(() => {
      if (isPrompt) {
        input.focus();
        input.select();
      } else if (select) sel.focus();
      else okBtn.focus();
    }, 20);

    const done = (result) => {
      back.hidden = true;
      form.removeEventListener('submit', onSubmit);
      $('#dialog-cancel').removeEventListener('click', onCancel);
      back.removeEventListener('mousedown', onBack);
      document.removeEventListener('keydown', onKey, true);
      input.removeEventListener('input', onInput);
      resolve(result);
    };
    const onSubmit = (ev) => {
      ev.preventDefault();
      if (isPrompt) {
        const v = input.value.trim();
        const problem = validate(v);
        if (problem) {
          err.textContent = problem;
          err.hidden = false;
          input.focus();
          return;
        }
        done(v);
      } else if (select) done(sel.value);
      else done(true);
    };
    const onCancel = () => done(null);
    const onBack = (ev) => ev.target === back && done(null);
    const onKey = (ev) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        done(null);
      }
    };
    const onInput = () => (err.hidden = true);
    form.addEventListener('submit', onSubmit);
    $('#dialog-cancel').addEventListener('click', onCancel);
    back.addEventListener('mousedown', onBack);
    document.addEventListener('keydown', onKey, true);
    input.addEventListener('input', onInput);
  });
}

/* ================= Statusleiste und Titel ================= */

function setSaveText(text, cls) {
  const s = $('#st-save');
  s.textContent = text;
  s.className = cls || '';
  const t2 = $('#m-title .t2');
  if (t2) t2.textContent = text;
}

function saveStatus() {
  if (!state.current) return state.offline ? ['Offline', 'bad'] : ['', ''];
  if (state.conflict) return ['Konflikt', 'bad'];
  if (state.saving) return ['Wird gespeichert …', 'busy'];
  if (state.lastError) {
    return state.lastError.status === 0
      ? ['Offline – auf diesem Gerät zwischengespeichert', 'bad']
      : ['Nicht gespeichert: ' + errorText(state.lastError), 'bad'];
  }
  if (state.dirty) return ['Ungespeichert', 'busy'];
  return ['Gespeichert', 'ok'];
}

function updateStatus() {
  if (state.busy) return;
  const [text, cls] = saveStatus();
  setSaveText(text, cls);
  $('#st-zoom').textContent = `${settings.zoom} %`;
  $('#st-wrap').textContent = settings.wrap ? 'Umbruch an' : 'Umbruch aus';
  updatePos();
}

function updatePos() {
  if (!state.current) {
    $('#st-pos').textContent = '';
    return;
  }
  const i = editor.selectionStart;
  const before = editor.value.slice(0, i);
  const line = before.split('\n').length;
  const col = i - before.lastIndexOf('\n');
  $('#st-pos').textContent = `Zeile ${line}, Spalte ${col}`;
}

function updateTitle() {
  const cur = state.current;
  const name = cur ? noteName(cur.path) : '';
  document.title = cur ? `${state.dirty ? '● ' : ''}${name} – Notepad` : 'Notepad';
  $('#doc-title').textContent = cur ? `${state.dirty ? '● ' : ''}${name}${dirName(cur.path) ? '  ·  ' + dirName(cur.path) : ''}` : '';
}

['keyup', 'click', 'select', 'focus'].forEach((e) => editor.addEventListener(e, updatePos));
document.addEventListener('selectionchange', () => document.activeElement === editor && updatePos());
$('#st-zoom').addEventListener('click', () => zoom(0));
$('#st-wrap').addEventListener('click', () => setSetting('wrap', !settings.wrap));

/* ================= iPhone-Ansicht ================= */

function showMobileEditor(on) {
  document.body.classList.toggle('m-editor', on);
  if (!on) {
    editor.blur();
    renderSidebar();
  }
  renderChrome();
}

function renderChrome() {
  updateTitle();
  const back = $('#m-back');
  const title = $('#m-title');
  title.replaceChildren();
  const inEditor = document.body.classList.contains('m-editor') && state.current;
  if (inEditor) {
    back.hidden = false;
    $('#m-back-label').textContent = folderLabel(dirName(state.current.path));
    title.append(el('span', 't1', noteName(state.current.path)));
    const t2 = el('span', 't2', $('#st-save').textContent);
    title.append(t2);
    $('#m-new').hidden = true;
  } else {
    const f = state.mobileFolder;
    back.hidden = !f;
    $('#m-back-label').textContent = f ? folderLabel(dirName(f)) : '';
    $('#m-new').hidden = false;
  }
}

$('#m-back').addEventListener('click', async () => {
  if (document.body.classList.contains('m-editor')) {
    await flushSave();
    showMobileEditor(false);
  } else if (state.mobileFolder) {
    state.mobileFolder = dirName(state.mobileFolder);
    store.set('mobileFolder', state.mobileFolder);
    searchEl.value = '';
    renderSidebar();
    renderChrome();
  }
});

$('#m-new').addEventListener('click', () => newNote(state.mobileFolder));

$('#m-more').addEventListener('click', (ev) => {
  if (!popup.hidden) return hideMenu();
  const r = ev.currentTarget.getBoundingClientRect();
  let items;
  if (document.body.classList.contains('m-editor') && state.current) {
    const p = state.current.path;
    items = [
      { label: 'Umbenennen …', action: () => renameNote(p) },
      { label: 'Verschieben …', action: () => moveNote(p) },
      { label: 'Uhrzeit/Datum einfügen', action: insertDate },
      '-',
      { label: 'Schrift größer', action: () => zoom(10) },
      { label: 'Schrift kleiner', action: () => zoom(-10) },
      { label: 'Zeilenumbruch', checked: settings.wrap, action: () => setSetting('wrap', !settings.wrap) },
      '-',
      { label: 'Löschen …', danger: true, action: () => deleteNote(p) },
    ];
  } else {
    const f = state.mobileFolder;
    items = [{ label: f ? 'Neuer Unterordner …' : 'Neuer Ordner …', action: () => newFolder(f) }];
    if (f) {
      items.push(
        { label: 'Ordner umbenennen …', action: () => renameFolder(f) },
        { label: 'Ordner löschen …', danger: true, action: () => deleteFolder(f) }
      );
    }
    items.push('-', { label: 'Aktualisieren', action: () => refreshTree() }, '-', ...themeItems(), '-',
      { label: 'Verbindung trennen …', action: () => disconnect() });
  }
  showMenu(items, r.right - 250, r.bottom + 4, null);
});

/* ================= Tastatur ================= */

function insertText(text) {
  editor.focus();
  if (!document.execCommand('insertText', false, text)) {
    editor.setRangeText(text, editor.selectionStart, editor.selectionEnd, 'end');
    editor.dispatchEvent(new Event('input'));
  }
}

function insertDate() {
  if (!state.current) return;
  insertText(`${timeStamp()} ${stamp()}`);
}

function focusSearch() {
  if (!settings.sidebar && !isMobile()) setSetting('sidebar', true);
  if (isMobile()) showMobileEditor(false);
  searchEl.focus();
  searchEl.select();
}

editor.addEventListener('keydown', (ev) => {
  if (ev.key === 'Tab' && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
    ev.preventDefault();
    insertText('\t');
  }
});

document.addEventListener('keydown', (ev) => {
  const ctrl = ev.ctrlKey || ev.metaKey;
  const k = ev.key.toLowerCase();
  if (!$('#dialog-backdrop').hidden) return;
  if (ev.key === 'Escape' && !popup.hidden) return hideMenu();
  if (ctrl && !ev.altKey && k === 's') {
    ev.preventDefault();
    save();
  } else if (ctrl && ev.altKey && k === 'n') {
    ev.preventDefault();
    newNote();
  } else if (ctrl && ev.shiftKey && k === 'f') {
    ev.preventDefault();
    focusSearch();
  } else if (ctrl && !ev.shiftKey && k === 'b') {
    ev.preventDefault();
    setSetting('sidebar', !settings.sidebar);
  } else if (ctrl && (ev.key === '+' || ev.key === '=' || ev.code === 'NumpadAdd')) {
    ev.preventDefault();
    zoom(10);
  } else if (ctrl && (ev.key === '-' || ev.code === 'NumpadSubtract')) {
    ev.preventDefault();
    zoom(-10);
  } else if (ctrl && (ev.key === '0' || ev.code === 'Numpad0')) {
    ev.preventDefault();
    zoom(0);
  } else if (ev.key === 'F2' && state.current) {
    ev.preventDefault();
    renameNote(state.current.path);
  } else if (ev.key === 'F5' && state.current) {
    ev.preventDefault();
    insertDate();
  }
});

editor.addEventListener('wheel', (ev) => {
  if (ev.ctrlKey) {
    ev.preventDefault();
    zoom(ev.deltaY < 0 ? 10 : -10);
  }
}, { passive: false });

$('#btn-new-note').addEventListener('click', () => newNote());
$('#btn-new-folder').addEventListener('click', () => newFolder());

/* ================= Abgleich mit anderen Geräten ================= */

function maybeRefresh() {
  if (!state.repo || document.hidden) return;
  if (Date.now() - state.lastRefresh < 5000) return;
  refreshTree({ quiet: true });
}
window.addEventListener('focus', maybeRefresh);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // Beim Wegwechseln (z. B. iPhone-Homebutton) sofort speichern
    if (state.dirty) save();
  } else maybeRefresh();
});
window.addEventListener('online', () => refreshTree({ quiet: true }));
setInterval(() => {
  if (!document.hidden && state.repo && Date.now() - state.lastRefresh > 60000) refreshTree({ quiet: true });
}, 15000);

window.addEventListener('beforeunload', (ev) => {
  if (state.dirty || state.saving) {
    if (state.dirty) save();
    ev.preventDefault();
    ev.returnValue = '';
  }
});

/* ================= Start ================= */

function needSetup(message) {
  const cfg = store.get('cfg', {});
  $('#app').hidden = true;
  $('#setup').hidden = false;
  if (cfg.owner) $('#setup-owner').value = cfg.owner;
  if (cfg.repo) $('#setup-repo').value = cfg.repo;
  const err = $('#setup-error');
  err.textContent = message || '';
  err.hidden = !message;
  setTimeout(() => $('#setup-token').focus(), 50);
}

$('#setup-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const cfg = {
    owner: $('#setup-owner').value.trim(),
    repo: $('#setup-repo').value.trim(),
    token: $('#setup-token').value.trim(),
  };
  const btn = $('#setup-submit');
  const err = $('#setup-error');
  btn.disabled = true;
  btn.textContent = 'Wird verbunden …';
  err.hidden = true;
  const repo = new Repo(cfg);
  try {
    await repo.init();
    const list = await repo.listTree();
    store.set('cfg', cfg);
    $('#setup-token').value = '';
    state.repo = repo;
    setEntries(list);
    showApp();
  } catch (e) {
    err.textContent = errorText(e);
    err.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Verbinden';
  }
});

function showApp() {
  $('#setup').hidden = true;
  $('#app').hidden = false;
  applySettings();
  renderSidebar();
  renderChrome();
  updateStatus();
}

async function start() {
  applySettings();
  const cfg = store.get('cfg', null);
  if (!cfg || !cfg.token) return needSetup('');
  state.repo = new Repo(cfg);
  setEntries(store.get('tree', []));
  showApp();
  try {
    await state.repo.init();
  } catch (e) {
    if (e.status === 401 || e.status === 404) return needSetup(errorText(e));
    if (e.status === 0) {
      state.offline = true;
      toast('Keine Verbindung. Du siehst den zuletzt geladenen Stand.');
    }
  }
  if (!state.offline) await refreshTree();
  const last = store.get('last', null);
  if (last && state.notes.has(last) && !isMobile()) await openNote(last);
  else if (last && state.notes.has(last) && drafts[last]) await openNote(last);
  updateStatus();
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

start();
