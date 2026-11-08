'use strict';
/* Notetaker — Notion-style AI meeting notes (frontend, vanilla JS).
   Flows: start meeting (consent → live transcript → stop → AI summary w/ citations),
   upload audio, plain notes, Ask AI, in-meeting skills, search, settings. */

/* ---------------------------------------------------------------- utils */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(9)) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
}
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
function fmtClock(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
function fmtDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}
function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/* ---------------------------------------------------------------- icons */
const I = {
  search: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="9" cy="9" r="5.5"/><path d="m13.5 13.5 3.5 3.5" stroke-linecap="round"/></svg>',
  home: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3.5 8.5 10 3l6.5 5.5V16a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V8.5Z" stroke-linejoin="round"/></svg>',
  plus: '<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M10 4v12M4 10h12" stroke-linecap="round"/></svg>',
  gear: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="10" r="2.6"/><path d="M10 2.8v2.1M10 15.1v2.1M3.3 6.6l1.8 1M14.9 12.4l1.8 1M3.3 13.4l1.8-1M14.9 7.6l1.8-1" stroke-linecap="round"/></svg>',
  close: '<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m5 5 10 10M15 5 5 15" stroke-linecap="round"/></svg>',
  trash: '<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 6h12M8 6V4.5A1.5 1.5 0 0 1 9.5 3h1A1.5 1.5 0 0 1 12 4.5V6m3 0-.7 9.2a1.5 1.5 0 0 1-1.5 1.3H7.2a1.5 1.5 0 0 1-1.5-1.3L5 6" stroke-linecap="round"/></svg>',
  send: '<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3.5 10 16.5 3.8 12.8 16.5l-2.6-4.9-6.7-1.6Z" stroke-linejoin="round"/></svg>',
  mic: '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="7.5" y="2.8" width="5" height="9" rx="2.5"/><path d="M5 9.5a5 5 0 0 0 10 0M10 14.5V17" stroke-linecap="round"/></svg>',
  upload: '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M10 13V3.5M6.5 7 10 3.5 13.5 7M4 13.5V15a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 16 15v-1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  clock: '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="10" r="6.5"/><path d="M10 6.5V10l2.4 1.6" stroke-linecap="round"/></svg>',
  timer: '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="11" r="6"/><path d="M10 8v3l1.8 1.4M8 2.5h4" stroke-linecap="round"/></svg>',
  pause: '<svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><rect x="5.5" y="4" width="3.2" height="12" rx="1"/><rect x="11.3" y="4" width="3.2" height="12" rx="1"/></svg>',
  play: '<svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path d="M6.5 4.2v11.6c0 .8.9 1.3 1.6.9l9-5.8c.6-.4.6-1.4 0-1.8l-9-5.8c-.7-.4-1.6.1-1.6.9Z"/></svg>',
  task: '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3.5" y="3.5" width="13" height="13" rx="3"/><path d="m7 10.2 2.2 2.2L13.5 8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  stop: '<svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor"><rect x="4.5" y="4.5" width="11" height="11" rx="2"/></svg>',
  chev: '<svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="m7 4.5 6 5.5-6 5.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  check: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m4 10.5 4.2 4L16 5.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  page: '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5.5 3h6L15 6.5V16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" stroke-linejoin="round"/><path d="M7.5 10h5M7.5 13h5" stroke-linecap="round"/></svg>',
  spark: '<svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2.2 11.9 8l5.9 2-5.9 2L10 17.8 8.1 12l-5.9-2 5.9-2L10 2.2Z"/></svg>',
  refresh: '<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M16 10a6 6 0 1 1-1.8-4.3M16 3.5V7h-3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
function icon(name) { const s = el('span'); s.innerHTML = I[name] || ''; return s; }

/* ---------------------------------------------------------------- state */
const S = {
  notes: [],            // sidebar metas
  current: null,        // full note object
  settings: null,
  theme: localStorage.getItem('nt.theme') || 'system',
  lang: localStorage.getItem('nt.lang') || 'auto',
  view: { kind: 'home' },
};
const LANGS = [
  ['auto', 'Auto-detect'], ['en', 'English'], ['zh', 'Chinese'], ['es', 'Spanish'], ['fr', 'French'],
  ['de', 'German'], ['ja', 'Japanese'], ['ko', 'Korean'], ['pt', 'Portuguese'], ['ru', 'Russian'],
  ['th', 'Thai'], ['vi', 'Vietnamese'], ['da', 'Danish'], ['fi', 'Finnish'], ['no', 'Norwegian'],
  ['nl', 'Dutch'], ['sv', 'Swedish'],
];

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body instanceof FormData ? opts.body : opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function streamSSE(path, body, onEvent) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { const j = await res.json(); if (j.error) msg = j.error; } catch { /* */ }
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const raw = buf.slice(0, i);
      buf = buf.slice(i + 2);
      for (const line of raw.split('\n')) {
        if (line.startsWith('data:')) {
          try { onEvent(JSON.parse(line.slice(5).trim())); } catch { /* skip */ }
        }
      }
    }
  }
}

function toast(msg, isErr = false) {
  const t = el('div', { class: 'toast' + (isErr ? ' err' : '') }, msg);
  $('#toasts').append(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 200ms'; }, 2600);
  setTimeout(() => t.remove(), 2900);
}

/* ---------------------------------------------------------------- theme */
function applyTheme() {
  const dark = S.theme === 'dark' || (S.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

/* ---------------------------------------------------------------- citations & markdown-lite */
function renderRich(text) {
  // Escape, then markdown-lite: **bold**, "- " bullets, [n] citations.
  const frag = document.createDocumentFragment();
  const lines = String(text).split('\n');
  let list = null;
  const flush = () => { if (list) { frag.append(list); list = null; } };
  for (const line of lines) {
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    let content = bullet ? bullet[1] : line;
    if (!bullet) flush();
    const span = el(bullet ? 'span' : 'span');
    const parts = content.split(/(\[\d{1,4}\])/g);
    for (const p of parts) {
      const m = /^\[(\d{1,4})\]$/.exec(p);
      if (m) {
        span.append(el('span', {
          class: 'cite', title: 'Jump to transcript', onclick: () => jumpToSegment(+m[1]),
        }, m[1]));
      } else if (p) {
        const b = document.createElement('span');
        // **bold**
        let rest = p;
        while (rest.length) {
          const bi = rest.indexOf('**');
          if (bi === -1) { b.append(rest); break; }
          b.append(rest.slice(0, bi));
          rest = rest.slice(bi + 2);
          const bi2 = rest.indexOf('**');
          if (bi2 === -1) { b.append('**' + rest); rest = ''; break; }
          const strong = el('strong', {}, rest.slice(0, bi2));
          b.append(strong);
          rest = rest.slice(bi2 + 2);
        }
        span.append(b);
      }
    }
    if (bullet) {
      if (!list) list = el('ul');
      const li = el('li');
      li.append(span);
      list.append(li);
    } else {
      frag.append(span);
    }
    frag.append(document.createTextNode('\n'));
  }
  flush();
  return frag;
}

/* ---------------------------------------------------------------- data */
async function loadNotes() {
  const d = await api('/api/notes');
  S.notes = d.notes;
  renderSidebar();
}
function meta(id) { return S.notes.find((n) => n.id === id); }
async function openNote(id) {
  try {
    const n = await api(`/api/notes/${id}`);
    S.current = n;
    S.view = { kind: 'note', id };
    closeChat();
    render();
    renderSidebar();
  } catch (e) { toast(e.message, true); }
}
async function goHome() {
  S.view = { kind: 'home' };
  S.current = null;
  closeChat();
  render();
  renderSidebar();
}

/* ---------------------------------------------------------------- sidebar */
function renderSidebar() {
  const meetings = $('#meetingsList');
  const notes = $('#notesList');
  meetings.textContent = '';
  notes.textContent = '';
  for (const n of S.notes) {
    const isMeeting = n.type === 'meeting';
    const item = el('button', {
      class: 'side-item is-page' + (S.view.kind === 'note' && S.view.id === n.id ? ' current' : ''),
      onclick: () => openNote(n.id),
    },
      el('span', { class: 'si-icon' }, isMeeting ? icon('mic') : icon('page')),
      el('span', {}, n.title || 'Untitled'),
      el('span', {
        class: 'icon-btn del', role: 'button', title: 'Delete', 'aria-label': 'Delete ' + (n.title || 'note'),
        onclick: (e) => { e.stopPropagation(); confirmDelete(n); },
      }, icon('trash')),
    );
    (isMeeting ? meetings : notes).append(el('li', {}, item));
  }
  if (!meetings.children.length) meetings.append(el('li', { class: 't-empty' }, 'No meetings yet'));
  if (!notes.children.length) notes.append(el('li', { class: 't-empty' }, 'No notes yet'));
}

/* ---------------------------------------------------------------- main render */
function render() {
  const main = $('#main');
  main.textContent = '';
  const v = S.view;
  if (v.kind === 'home') renderHome(main);
  else if (v.kind === 'note') {
    const n = S.current;
    if (!n) return goHome();
    if (n.type === 'note') renderPlainNote(main, n);
    else renderMeeting(main, n);
  }
}

function renderHome(main) {
  const hero = el('div', { class: 'hero' },
    el('h1', { class: 'big' }, 'AI Note Taker'),
    el('p', {}, 'Record a meeting and Notetaker transcribes it live, then writes the summary, action items and next steps — like Notion AI meeting notes, running on your own Groq key.'),
    el('div', { class: 'hero-actions' },
      el('button', { class: 'btn primary', onclick: openNewMeetingModal }, icon('mic'), 'Start meeting note'),
      el('button', { class: 'btn', onclick: () => openNewMeetingModal('upload') }, icon('upload'), 'Upload audio'),
      el('button', { class: 'linkish', onclick: loadExample }, 'See an example meeting'),
    ),
  );
  main.append(hero);
}

/* ---------------------------------------------------------------- meeting note view */
function renderMeeting(main, n) {
  const page = el('div', { class: 'note-page narrow-pad' });

  // title
  const title = el('h1', {
    class: 'page-title', contenteditable: 'plaintext-only', spellcheck: 'false',
    dataset: { ph: n.status === 'recording' ? 'Meeting notes' : 'Untitled' },
    oninput: debounce(() => saveTitle(n, title), 500),
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } },
  }, n.title === 'Meeting notes' || n.title === 'Untitled' ? '' : n.title);
  if (n.title !== 'Meeting notes' && n.title !== 'Untitled') title.textContent = n.title;

  // properties
  const props = el('div', { class: 'props' },
    propRow('clock', 'Created', `${fmtDate(n.createdAt)} · ${fmtTime(n.createdAt)}`),
    propRow('timer', 'Duration', n.status === 'recording' ? liveDurationLabel() : fmtClock(n.durationSec || 0) + (n.durationSec ? ' min' : '')),
    el('div', { class: 'prop' }, el('b', {}, 'Status'),
      n.status === 'recording' ? el('span', { class: 'chip rec', id: 'statusChip' }, '● Recording')
        : n.status === 'processing' ? el('span', { class: 'chip proc', id: 'statusChip' }, 'Summarizing…')
        : n.status === 'failed' ? el('span', { class: 'chip', style: 'color:var(--red)' }, 'Failed')
        : el('span', { class: 'chip' }, n.source === 'example' ? 'Example' : 'Ready')),
  );
  page.append(title, props);

  if (n.status === 'recording') renderRecording(page, n);
  else if (n.status === 'processing') renderProcessing(page, n);
  else if (n.status === 'failed') renderFailed(page, n);
  else renderReady(page, n);

  main.append(page);

  if (n.status === 'recording' && !Rec.active(n.id) && sessionStorage.getItem('nt.live') !== n.id) {
    // Reloaded mid-recording (not a fresh start): show recovery options.
    showInterrupted(n);
  }
}

function propRow(iconName, label, value) {
  return el('div', { class: 'prop' }, el('span', { class: 'pi' }, icon(iconName)), el('b', {}, label), el('span', {}, value));
}

function saveTitle(n, titleNode) {
  const t = titleNode.textContent.trim();
  n.title = t || (n.type === 'meeting' ? 'Meeting notes' : 'Untitled');
  api(`/api/notes/${n.id}`, { method: 'PATCH', body: { title: n.title } }).then(loadNotes);
}

/* ----- recording state ----- */
function renderRecording(page, n) {
  // recording card
  const wave = el('div', { class: 'wave', id: 'wave' });
  for (let i = 0; i < 7; i++) wave.append(el('i'));
  const timer = el('span', { class: 'rec-timer', id: 'recTimer' }, '0:00');
  const pauseBtn = el('button', { class: 'btn small', id: 'pauseBtn', onclick: () => Rec.togglePause() }, icon('pause'), 'Pause');
  const stopBtn = el('button', { class: 'btn small primary', style: 'background:var(--red);border-color:var(--red)', onclick: () => stopAndSummarize(n) }, icon('stop'), 'Stop & summarize');
  page.append(el('div', { class: 'rec-card' },
    el('span', { class: 'rec-dot', title: 'Recording' }),
    timer, wave,
    el('div', { class: 'rec-actions' }, pauseBtn, stopBtn),
  ));

  // skills
  const skills = el('div', { class: 'skills-row' },
    skillChip('catchup', '✦ Catch me up', n),
    skillChip('questions', '✦ Suggest questions', n),
    skillChip('decisions', '✦ Recap decisions', n),
  );
  page.append(skills);

  // agenda
  const agenda = el('textarea', {
    placeholder: 'Agenda & context (optional) — the AI reads this when writing the summary',
    oninput: debounce((e) => api(`/api/notes/${n.id}`, { method: 'PATCH', body: { agenda: e.target.value } }), 600),
  });
  agenda.value = n.agenda || '';
  agenda.style.cssText = 'width:100%;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text-2);font:inherit;font-size:14px;padding:10px 12px;min-height:52px;resize:vertical';
  page.append(agenda);

  // transcript
  const count = el('span', { class: 'count', id: 'tCount' }, `${(n.transcript || []).length} lines`);
  const head = el('div', { class: 'toggle-head open', id: 'tHead', onclick: () => toggleTranscript() },
    el('span', { class: 'chev' }, icon('chev')), 'Transcript', count);
  const body = el('div', { class: 'transcript', id: 'transcript' });
  page.append(head, body);
  renderTranscriptInto(body, n);

  Rec.start(n).catch((e) => {
    toast(e.message || 'Microphone unavailable', true);
    showNotice(page, 'warn', 'Microphone unavailable',
      'Allow microphone access in your browser and reload this page to record. You can also upload an audio file instead.', [
      ['Upload audio', () => openNewMeetingModal('upload')],
    ]);
  });
}

function skillChip(skill, label, n) {
  return el('button', {
    class: 'skill-chip', dataset: { skill },
    onclick: () => runSkill(n, skill),
  }, label);
}

function liveDurationLabel() {
  return el('span', { id: 'durLive' }, fmtClock(Rec.elapsedSec()));
}

function toggleTranscript(forceOpen) {
  const head = $('#tHead'), body = $('#transcript');
  if (!head || !body) return;
  const open = forceOpen != null ? forceOpen : !head.classList.contains('open');
  head.classList.toggle('open', open);
  body.style.display = open ? '' : 'none';
}

function renderTranscriptInto(container, n, keepScroll) {
  container.textContent = '';
  const segs = n.transcript || [];
  if (!segs.length) {
    container.append(el('div', { class: 't-empty' }, 'Listening… speech appears here line by line.'));
    return;
  }
  segs.forEach((s, i) => {
    container.append(tLine(s, i, !!s._pending));
  });
  if (!keepScroll) autoscrollTranscript();
}

function tLine(s, i, pending) {
  return el('div', {
    class: 't-line' + (pending ? ' pending' : ''),
    dataset: { i: String(i + 1) },
  },
    el('span', {
      class: 't-time', title: 'Jump to this moment',
      onclick: () => seekAudio(s.start),
    }, fmtClock(s.start)),
    el('span', { class: 't-text' }, s.text || '…'),
  );
}

function autoscrollTranscript() {
  const t = $('#transcript'), main = $('#main');
  if (!t || !main) return;
  const r = t.getBoundingClientRect();
  if (r.bottom < main.clientHeight + 200) main.scrollTop = main.scrollHeight;
}

function jumpToSegment(n_) {
  toggleTranscript(true);
  const line = document.querySelector(`.t-line[data-i="${n_}"]`);
  if (!line) return;
  line.scrollIntoView({ block: 'center', behavior: 'smooth' });
  line.classList.add('flash');
  setTimeout(() => line.classList.remove('flash'), 1400);
  const seg = (S.current.transcript || [])[n_ - 1];
  if (seg) seekAudio(seg.start, false);
}

function seekAudio(startSec, play = false) {
  const a = $('#noteAudio');
  if (!a) return;
  try { a.currentTime = Math.max(0, startSec); if (play) a.play().catch(() => {}); } catch { /* */ }
}

function showNotice(page, kind, bold, text, actions = []) {
  const box = el('div', { class: 'notice ' + (kind || '') },
    el('div', {}, el('b', {}, bold + ' — '), text,
      actions.length ? el('div', { class: 'n-actions' }, actions.map(([label, fn, cls]) => el('button', { class: 'btn small ' + (cls || ''), onclick: fn }, label))) : null,
    ));
  page.prepend(box);
  return box;
}

function showInterrupted(n) {
  const page = $('.note-page');
  showNotice(page, 'warn', 'Recording was interrupted',
    'This page was reloaded while recording, so capture stopped. You can summarize the transcript you already have, or delete this meeting.', [
    ['Summarize what you have', () => finishNote(n), 'primary'],
    ['Delete meeting', () => confirmDelete(n), 'danger'],
  ]);
}

/* ----- processing state ----- */
function renderProcessing(page, n) {
  const stage = Rec.stageLabel || 'Writing summary';
  page.append(el('div', { class: 'gen-card' },
    el('div', { class: 'gen-label' }, el('span', { class: 'spark', style: 'color:var(--blue)' }, '✦'), `${stage}…`),
    el('div', { class: 'gen-line' }), el('div', { class: 'gen-line' }),
    el('div', { class: 'gen-line' }), el('div', { class: 'gen-line' }),
  ));
  // Poll until ready (covers reload during processing).
  const poll = setInterval(async () => {
    if (S.view.kind !== 'note' || S.view.id !== n.id) return clearInterval(poll);
    try {
      const fresh = await api(`/api/notes/${n.id}`);
      if (fresh.status !== 'processing') {
        clearInterval(poll);
        S.current = fresh;
        render();
        loadNotes();
      }
    } catch { /* keep polling */ }
  }, 3000);
}

/* ----- failed state ----- */
function renderFailed(page, n) {
  showNotice(page, 'warn', 'Summarization failed', n.error || 'Unknown error', [
    ['Try again', () => finishNote(n), 'primary'],
    ['Delete meeting', () => confirmDelete(n), 'danger'],
  ]);
  renderTranscriptSectionStatic(page, n);
}

/* ----- ready state ----- */
function renderReady(page, n) {
  // player
  if (n.audioFile) {
    page.append(el('div', { class: 'player' },
      el('span', { class: 'pl-label' }, 'Audio'),
      el('audio', { id: 'noteAudio', controls: true, src: `/api/notes/${n.id}/audio`, preload: 'metadata' }),
    ));
  }

  // actions row
  page.append(el('div', { style: 'display:flex;gap:8px;margin:14px 0 4px' },
    el('button', { class: 'btn small primary', onclick: () => openChat() }, icon('spark'), 'Ask AI'),
    el('button', { class: 'btn small', onclick: () => regenerate(n) }, icon('refresh'), 'Regenerate summary'),
    n.source === 'example' ? el('span', { class: 'chip', style: 'align-self:center;margin-left:6px' }, 'Example — no key needed') : null,
  ));

  const sum = n.summary;
  if (!sum) {
    page.append(el('div', { class: 't-empty', style: 'margin-top:16px' },
      'No summary yet. ', el('button', { class: 'linkish', onclick: () => regenerate(n) }, 'Summarize now'), ''));
  } else {
    // callout
    const callout = el('div', { class: 'callout' },
      el('div', { class: 'co-icon' }, '✨'),
      el('div', { class: 'co-body' },
        el('div', { style: 'font-weight:600;margin-bottom:6px' }, 'AI summary'),
        el('div', { class: 'blocks', id: 'sumBody' }, summaryBullets(sum.summary)),
      ));
    page.append(callout);

    if (sum.actions && sum.actions.length) {
      page.append(blockHead('task', 'Action items', `${sum.actions.filter((a) => a.done).length}/${sum.actions.length} done`));
      sum.actions.forEach((a, i) => {
        const todo = el('div', { class: 'todo' + (a.done ? ' done' : '') },
          el('span', {
            class: 'cb', role: 'checkbox', 'aria-checked': String(!!a.done), tabindex: '0', title: 'Toggle done',
            onclick: () => toggleAction(n, i, !a.done),
            onkeydown: (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleAction(n, i, !a.done); } },
          }, icon('check')),
          el('span', { class: 't' }, renderRich(a.text)),
        );
        page.append(todo);
      });
    }
    if (sum.decisions && sum.decisions.length) {
      page.append(blockHead('spark', 'Decisions'));
      page.append(el('ul', { class: 'bullets' }, sum.decisions.map((d) => el('li', {}, el('span', {}, renderRich(d))))));
    }
    if (sum.nextSteps && sum.nextSteps.length) {
      page.append(blockHead('chev', 'Next steps'));
      page.append(el('ul', { class: 'bullets' }, sum.nextSteps.map((d) => el('li', {}, el('span', {}, renderRich(d))))));
    }
  }

  renderTranscriptSectionStatic(page, n);

  if (n.chat && n.chat.length) {
    // restore previous conversation silently into panel
    renderChatHistory(n);
  }
}

function blockHead(iconName, label, extra) {
  return el('div', { class: 'block-h' }, el('span', { class: 'bh-icon' }, icon(iconName)), label,
    extra ? el('span', { style: 'font-size:13px;color:var(--text-3);font-weight:400' }, extra) : null);
}

function summaryBullets(lines) {
  const wrap = el('div');
  let para = [];
  const flushPara = () => { if (para.length) { wrap.append(el('p', {}, renderRich(para.join(' ')))); para = []; } };
  for (const line of lines) {
    if (/^\s*-\s+/.test(line)) { flushPara(); wrap.append(el('ul', { class: 'bullets' }, el('li', {}, el('span', {}, renderRich(line.replace(/^\s*-\s+/, '')))))); }
    else if (line.trim()) para.push(line.trim());
  }
  flushPara();
  return wrap;
}

function renderTranscriptSectionStatic(page, n) {
  const segs = n.transcript || [];
  const count = el('span', { class: 'count' }, `${segs.length} lines`);
  const head = el('div', { class: 'toggle-head', id: 'tHead', onclick: (e) => { const h = e.currentTarget; h.classList.toggle('open'); body.style.display = h.classList.contains('open') ? '' : 'none'; } },
    el('span', { class: 'chev' }, icon('chev')), 'Transcript', count);
  const body = el('div', { class: 'transcript', id: 'transcript', style: 'display:none' });
  segs.forEach((s, i) => body.append(tLine(s, i)));
  page.append(head, body);
}

async function toggleAction(n, i, done) {
  n.summary.actions[i].done = done;
  render(); // re-render for strikethrough
  try { await api(`/api/notes/${n.id}`, { method: 'PATCH', body: { actionToggle: { i, done } } }); }
  catch (e) { toast(e.message, true); }
}

async function regenerate(n) {
  if (n.source === 'example') { toast('This is a static example meeting', true); return; }
  try {
    await finishNote(n);
  } catch (e) { toast(e.message, true); }
}

/* ----- finish / generate ----- */
async function finishNote(n) {
  if (!n.transcript || !n.transcript.length) { toast('Nothing recorded yet', true); return; }
  Rec.stageLabel = 'Writing summary';
  if (Rec.active(n.id)) await Rec.stopCapture();
  n.status = 'processing';
  S.current = n;
  render();
  try {
    await streamSSE(`/api/notes/${n.id}/generate`, {}, (ev) => {
      if (ev.t === 'start') { /* keep shimmer */ }
      else if (ev.t === 'delta') { progressiveSummary(ev.v); }
      else if (ev.t === 'done' && ev.note) {
        S.current = ev.note;
        Rec.stageLabel = null;
        render();
        loadNotes();
        toast('Summary ready');
      } else if (ev.t === 'error') {
        S.current = Object.assign({}, n, { status: 'failed', error: ev.message });
        render();
        toast(ev.message, true);
      }
    });
  } catch (e) {
    n.status = 'failed'; n.error = e.message; render();
    toast(e.message, true);
  }
}

// Progressive rendering while the summary streams in.
let progAcc = '';
let progTimer = null;
function progressiveSummary(delta) {
  progAcc += delta;
  if (progTimer) return;
  progTimer = setTimeout(() => {
    progTimer = null;
    const main = $('#main');
    if (!main) return;
    let host = $('#progStream');
    if (!host) {
      main.querySelector('.note-page').append(el('div', { class: 'gen-card', id: 'progStream' },
        el('div', { class: 'gen-label' }, el('span', { style: 'color:var(--blue)' }, '✦'), 'Writing summary…')));
      host = $('#progStream');
    }
    let body = $('#progBody');
    if (!body) { body = el('div', { class: 'stream-pre', id: 'progBody' }); host.append(body); }
    body.textContent = '';
    body.append(renderRich(progAcc.replace(/^##\s*[^\n]*\n?/gm, (m) => '\n◆ ' + m.replace(/^##\s*/, '').trim() + '\n')));
    main.scrollTop = main.scrollHeight;
  }, 90);
}

/* ----- skills ----- */
async function runSkill(n, skill) {
  if (!(n.transcript || []).length) { toast('Wait for some speech first', true); return; }
  const titles = { catchup: 'Catch me up', questions: 'Suggested questions', decisions: 'Decisions so far' };
  const pop = $('#skillPop');
  $('#skillTitle').textContent = '✦ ' + titles[skill];
  const body = $('#skillBody');
  body.textContent = '';
  body.append(el('span', { style: 'color:var(--text-3)' }, 'Thinking…'));
  pop.hidden = false;
  let acc = '';
  try {
    await streamSSE(`/api/notes/${n.id}/skill`, { skill }, (ev) => {
      if (ev.t === 'delta') {
        acc += ev.v;
        body.textContent = '';
        body.append(renderRich(acc));
      } else if (ev.t === 'error') {
        body.textContent = ev.message;
      }
    });
  } catch (e) { body.textContent = e.message; }
}

/* ---------------------------------------------------------------- recorder */
const Rec = {
  noteId: null, stream: null, mr: null, mime: '',
  windowBlobs: [], windowStartMs: 0, stopping: false, discardNext: false,
  startAt: 0, pausedTotal: 0, pauseAt: null, timerInt: null, rotInt: null, rafId: null,
  audioCtx: null, analyser: null, rms: 0, rmsHist: [],
  lastSpeechAt: 0, spokeInWindow: false, SPEECH_RMS: 0.02,
  pending: [], draining: false, finalWaiter: null, lastText: '', stageLabel: null,
  wakeLock: null, beforeUnload: null,

  active(id) { return this.noteId === id && !!this.mr; },
  elapsedMs() {
    if (!this.startAt) return 0;
    const now = this.pauseAt ? this.pauseAt : performance.now();
    return now - this.startAt - this.pausedTotal;
  },
  elapsedSec() { return this.elapsedMs() / 1000; },

  async start(n) {
    if (this.mr) return; // already running
    this.noteId = n.id;
    this.stopping = false; this.pending = []; this.draining = false; this.finalWaiter = null;
    this.windowBlobs = []; this.lastText = ''; this.discardNext = false;
    this.pausedTotal = 0; this.pauseAt = null;
    // Raw-ish mic signal for ASR: skip echo cancellation (distorts speech when
    // there is no echo), keep noise suppression + AGC for level consistency.
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    // A fresh MediaRecorder per window: only a recorder's own output starts with the
    // WebM header, so every window is a standalone, Groq-parseable file.
    this.mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) || '';

    // level meter (also drives silence-aware window cutting)
    try {
      this.audioCtx = new AudioContext();
      const src = this.audioCtx.createMediaStreamSource(this.stream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 512;
      src.connect(this.analyser);
    } catch { /* meter optional */ }
    this.startAt = performance.now();
    this.lastSpeechAt = this.startAt;
    this.openWindow();
    this.tickTimer();
    this.tickWave();
    // Rotate windows at natural speech pauses — cutting in a gap keeps words whole.
    // Floor 6s avoids request spam; cap 18s guarantees progress in continuous speech.
    this.rotInt = setInterval(() => {
      if (this.pauseAt || this.stopping || !this.mr) return;
      const inWindow = this.elapsedMs() - this.windowStartMs;
      const quietFor = performance.now() - (this.lastSpeechAt || this.startAt);
      if (inWindow >= 18000) { this.rotateWindow(); return; }
      if (inWindow >= 6000 && this.spokeInWindow && quietFor >= 900) { this.rotateWindow(); return; }
      // long silence with no speech at all: reset the window without a wasted request
      if (inWindow >= 4000 && !this.spokeInWindow && quietFor >= 4000) { this.rotateWindow(true); return; }
    }, 500);
    sessionStorage.removeItem('nt.live');

    try { this.wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* */ }
    this.beforeUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', this.beforeUnload);
    toast('Recording — everyone should know they are being recorded');
  },

  tickTimer() {
    clearInterval(this.timerInt);
    this.timerInt = setInterval(() => {
      const t = $('#recTimer'); const d = $('#durLive');
      if (!t) { clearInterval(this.timerInt); return; }
      t.textContent = fmtClock(this.elapsedSec());
      if (d) d.textContent = fmtClock(this.elapsedSec());
    }, 500);
  },

  tickWave() {
    const buf = new Uint8Array(this.analyser ? this.analyser.frequencyBinCount : 0);
    const loop = () => {
      if (!this.mr) return;
      const wave = $('#wave');
      if (this.analyser && wave) {
        this.analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        this.rms = Math.sqrt(sum / buf.length);
        if (this.rms > this.SPEECH_RMS) {
          this.lastSpeechAt = performance.now();
          this.spokeInWindow = true;
        }
        this.rmsHist.unshift(this.rms);
        this.rmsHist.length = 21;
        [...wave.children].forEach((bar, i) => {
          const r = this.rmsHist[Math.min(this.rmsHist.length - 1, i * 3)] || 0;
          bar.style.height = Math.max(3, Math.min(22, 3 + r * 90)) + 'px';
        });
      }
      this.rafId = requestAnimationFrame(loop);
    };
    loop();
  },

  togglePause() {
    if (!this.mr) return;
    const btn = $('#pauseBtn');
    if (this.pauseAt) {
      this.mr.resume();
      this.pausedTotal += performance.now() - this.pauseAt;
      this.pauseAt = null;
      if (btn) { btn.textContent = ''; btn.append(icon('pause'), 'Pause'); }
      toast('Resumed');
    } else {
      this.mr.pause();
      this.pauseAt = performance.now();
      if (btn) { btn.textContent = ''; btn.append(icon('play'), 'Resume'); }
      toast('Paused — timer stopped');
    }
  },

  openWindow() {
    this.mr = new MediaRecorder(this.stream, this.mime ? { mimeType: this.mime, audioBitsPerSecond: 64000 } : undefined);
    this.windowBlobs = [];
    this.windowStartMs = this.elapsedMs();
    this.spokeInWindow = false;
    this.mr.ondataavailable = (e) => { if (e.data && e.data.size) this.windowBlobs.push(e.data); };
    this.mr.onstop = () => {
      const blob = new Blob(this.windowBlobs, { type: (this.mime || 'audio/webm').split(';')[0] });
      const job = { blob, offsetMs: this.windowStartMs };
      this.windowBlobs = [];
      if (this.finalWaiter) {
        const resolve = this.finalWaiter;
        this.finalWaiter = null;
        resolve(job);
        return;
      }
      if (this.discardNext) {
        this.discardNext = false; // silence-only window — chain on, send nothing
      } else {
        this.enqueue(job);
      }
      if (!this.stopping) this.openWindow(); // chain the next window immediately
    };
    this.mr.start();
  },

  rotateWindow(discard = false) {
    if (!this.mr || this.mr.state !== 'recording') return;
    this.discardNext = !!discard;
    try { this.mr.stop(); } catch { this.openWindow(); }
  },

  enqueue(job) {
    if (!job.blob || job.blob.size < 1200) return; // silence-only window
    this.pending.push(job);
    this.drain();
  },

  async drain() {
    if (this.draining) return;
    this.draining = true;
    while (this.pending.length) {
      const job = this.pending.shift();
      await this.sendWindow(job);
    }
    this.draining = false;
  },

  async sendWindow(job, maxTries = 4) {
    for (let attempt = 1; attempt <= maxTries; attempt++) {
      try {
        await this.transcribeWindow(job);
        return true;
      } catch (e) {
        if (attempt === maxTries) {
          console.warn('[rec] window dropped:', e.message);
          toast('A window of audio could not be transcribed — it was skipped', true);
          return false;
        }
        await new Promise((r) => setTimeout(r, 1200 * attempt));
      }
    }
    return false;
  },

  async transcribeWindow(job) {
    const fd = new FormData();
    fd.append('file', job.blob, 'chunk.webm');
    fd.append('offsetMs', String(Math.round(job.offsetMs)));
    fd.append('language', S.lang);
    if (this.lastText) fd.append('prompt', this.lastText.slice(-180));
    const out = await api(`/api/notes/${this.noteId}/transcribe`, { method: 'POST', body: fd });
    this.applySegments(out);
  },

  applySegments(out) {
    const n = S.current;
    if (!n || n.id !== this.noteId) return;
    const fresh = (out.segments || []).filter((s) => s.text && s.text.trim());
    if (!fresh.length) return;
    // dedupe overlap with the tail of existing transcript
    const last = n.transcript[n.transcript.length - 1];
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
    let startIdx = 0;
    if (last && fresh.length) {
      const a = norm(last.text), b = norm(fresh[0].text);
      if (a && b && (a.endsWith(b) || b.startsWith(a) || a.includes(b))) startIdx = 1;
    }
    const add = fresh.slice(startIdx);
    if (!add.length) return;
    n.transcript.push(...add);
    this.lastText = add[add.length - 1].text;
    // UI: append lines
    const body = $('#transcript');
    const empty = body && body.querySelector('.t-empty');
    if (empty) empty.remove();
    if (body) {
      const from = n.transcript.length - add.length;
      add.forEach((s, i) => body.append(tLine(s, from + i)));
      autoscrollTranscript();
      const c = $('#tCount'); if (c) c.textContent = `${n.transcript.length} lines`;
    }
    // first words → auto title (Notion behavior)
    if ((n.title === 'Meeting notes' || !n.title) && add[0].text.length > 8) {
      const words = add[0].text.split(/\s+/).slice(0, 6).join(' ');
      n.title = words.replace(/[,.]$/, '');
      const t = $('.page-title');
      if (t) t.textContent = n.title;
      api(`/api/notes/${n.id}`, { method: 'PATCH', body: { title: n.title } }).then(loadNotes);
    }
    // persist incrementally (crash-safe)
    api(`/api/notes/${n.id}`, { method: 'PATCH', body: { segmentsAppend: add } }).catch(() => { /* local copy remains */ });
    // enable skill chips
    document.querySelectorAll('.skill-chip').forEach((b) => (b.disabled = false));
  },

  stopCapture() {
    return new Promise((resolve) => {
      this.stopping = true;
      if (!this.mr) return resolve(null);
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; resolve(v); } };
      this.finalWaiter = (job) => done(job);
      try {
        if (this.mr.state === 'inactive') { this.finalWaiter = null; done(null); }
        else this.mr.stop();
      } catch { this.finalWaiter = null; done(null); }
      setTimeout(() => { this.finalWaiter = null; done(null); }, 3000);
    });
  },

  cleanup() {
    clearInterval(this.timerInt);
    clearInterval(this.rotInt);
    cancelAnimationFrame(this.rafId);
    this.mr = null;
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.audioCtx) { this.audioCtx.close().catch(() => {}); this.audioCtx = null; }
    if (this.wakeLock) { this.wakeLock.release().catch(() => {}); this.wakeLock = null; }
    if (this.beforeUnload) window.removeEventListener('beforeunload', this.beforeUnload);
  },

  async stopAndFinish(n) {
    const job = await this.stopCapture();
    const durationSec = Math.round(this.elapsedSec());
    this.cleanup();
    // let any in-flight windows finish before the final flush keeps order
    for (let i = 0; i < 100 && (this.draining || this.pending.length); i++) {
      await new Promise((r) => setTimeout(r, 150));
    }
    if (job && job.blob && job.blob.size >= 1200) await this.sendWindow(job);
    this.noteId = null;
    await api(`/api/notes/${n.id}`, { method: 'PATCH', body: { durationSec, status: 'processing' } });
    n.durationSec = durationSec;
    await finishNote(n);
  },
};

function stopAndSummarize(n) { Rec.stopAndFinish(n); }

/* ---------------------------------------------------------------- new meeting modal */
function openModal(contents, { width } = {}) {
  const scrim = el('div', { class: 'scrim', onclick: (e) => { if (e.target === scrim) closeModal(); } });
  const modal = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', style: width ? `max-width:${width}px` : '' }, contents);
  scrim.append(modal);
  $('#modalRoot').append(scrim);
  const onKey = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', onKey);
  closeModal._cleanup = () => document.removeEventListener('keydown', onKey);
  setTimeout(() => { const f = modal.querySelector('input,textarea,select,button'); if (f) f.focus(); }, 30);
  return { scrim, modal };
}
function closeModal() {
  const r = $('#modalRoot');
  if (closeModal._cleanup) { closeModal._cleanup(); closeModal._cleanup = null; }
  r.textContent = '';
}

function openNewMeetingModal(initialTab) {
  let tab = initialTab === 'upload' ? 'upload' : 'record';
  const tabsWrap = el('div', { class: 'modal-tabs' });
  const body = el('div');
  const err = el('div', { class: 'form-err' });

  const draw = () => {
    tabsWrap.textContent = '';
    tabsWrap.append(
      el('button', { class: tab === 'record' ? 'on' : '', onclick: () => { tab = 'record'; draw(); } }, 'Record a meeting'),
      el('button', { class: tab === 'upload' ? 'on' : '', onclick: () => { tab = 'upload'; draw(); } }, 'Upload audio'),
    );
    body.textContent = '';
    err.textContent = '';
    if (tab === 'record') {
      const consent = el('input', { type: 'checkbox', id: 'consentCk' });
      const agenda = el('textarea', { id: 'agendaTa', placeholder: 'e.g. Standup — yesterday’s progress, blockers, today’s plan' });
      const langSel = langSelect();
      body.append(
        el('div', { class: 'check-row' }, consent, el('label', { for: 'consentCk' }, 'I confirm everyone in this meeting has consented to being recorded and transcribed.')),
        el('div', { class: 'field' }, el('label', {}, 'Agenda & context (optional — the AI uses this to write a better summary)'), agenda),
        el('div', { class: 'field' }, el('label', {}, 'Language'), langSel, el('div', { class: 'hint' }, 'Live transcription works best in Chrome or Edge, from your microphone.')),
      );
      const startBtn = el('button', { class: 'btn primary', disabled: true, onclick: startRecording }, icon('mic'), 'Start recording');
      consent.addEventListener('change', () => { startBtn.disabled = !consent.checked; });
      body.append(el('div', { class: 'modal-actions' },
        el('button', { class: 'btn', onclick: closeModal }, 'Cancel'), startBtn));
    } else {
      const fileInput = el('input', { type: 'file', id: 'fileInp', accept: '.aac,.m4a,.mp3,.wav,.webm,.ogg,audio/*', style: 'display:none' });
      const pick = el('button', { class: 'btn', onclick: () => fileInput.click() }, icon('upload'), 'Choose audio file');
      const info = el('div', { class: 'hint', style: 'margin-top:8px;color:var(--text-3);font-size:12.5px' }, 'AAC, M4A, MP3, WAV, OGG or WebM · up to 25 MB');
      const langSel = langSelect();
      let chosen = null;
      fileInput.addEventListener('change', () => {
        chosen = fileInput.files[0] || null;
        pick.textContent = '';
        pick.append(icon('upload'), chosen ? chosen.name : 'Choose audio file');
      });
      body.append(
        el('div', { class: 'field' }, pick, fileInput, info),
        el('div', { class: 'field' }, el('label', {}, 'Language'), langSel),
      );
      body.append(el('div', { class: 'modal-actions' },
        el('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
        el('button', { class: 'btn primary', onclick: () => startUpload(chosen) }, 'Transcribe & summarize'),
      ));
    }
  };
  draw();

  openModal(el('div', {},
    el('h2', {}, 'New meeting note'),
    el('p', { class: 'sub' }, 'Notetaker transcribes live, then writes the summary, action items and next steps when you stop.'),
    tabsWrap, body, err,
  ));

  async function startRecording() {
    if (!S.settings || !S.settings.hasKey) {
      err.textContent = 'Add your Groq API key in Settings first (transcription and summaries run on Groq).';
      return;
    }
    closeModal();
    try {
      const note = await api('/api/notes', { method: 'POST', body: { type: 'meeting', status: 'recording', agenda: $('#agendaTa') ? $('#agendaTa').value : '' } });
      S.notes.unshift({ ...note });
      sessionStorage.setItem('nt.live', note.id); // mark fresh start before async mic opens
      await openNote(note.id);
      // recorder starts inside renderRecording
    } catch (e) { toast(e.message, true); }
  }

  async function startUpload(file) {
    if (!S.settings || !S.settings.hasKey) {
      err.textContent = 'Add your Groq API key in Settings first.';
      return;
    }
    if (!file) { err.textContent = 'Choose an audio file first.'; return; }
    if (file.size > 25 * 1024 * 1024) { err.textContent = 'File is larger than 25 MB. Trim or compress it first.'; return; }
    closeModal();
    toast('Uploading and transcribing…');
    try {
      const note = await api('/api/notes', { method: 'POST', body: { type: 'meeting', status: 'processing' } });
      S.notes.unshift({ ...note });
      S.current = note; S.view = { kind: 'note', id: note.id };
      Rec.stageLabel = 'Transcribing audio';
      render();
      // store audio for playback
      const fd = new FormData();
      fd.append('file', file, file.name);
      await api(`/api/notes/${note.id}/audio`, { method: 'POST', body: fd });
      // transcribe
      const tfd = new FormData();
      tfd.append('file', file, file.name);
      tfd.append('offsetMs', '0');
      tfd.append('language', S.lang);
      const out = await api(`/api/notes/${note.id}/transcribe`, { method: 'POST', body: tfd });
      await api(`/api/notes/${note.id}`, { method: 'PATCH', body: { segments: out.segments || [], durationSec: Math.round((out.segments || []).slice(-1)[0]?.end || 0) } });
      const fresh = await api(`/api/notes/${note.id}`);
      S.current = fresh;
      Rec.stageLabel = 'Writing summary';
      render();
      await finishNote(fresh);
    } catch (e) {
      toast(e.message, true);
      if (S.current) { S.current.status = 'failed'; S.current.error = e.message; render(); }
    }
  }
}

function langSelect() {
  const sel = el('select', { onchange: (e) => { S.lang = e.target.value; localStorage.setItem('nt.lang', S.lang); } });
  for (const [code, label] of LANGS) sel.append(el('option', { value: code, selected: S.lang === code ? true : null }, label));
  return sel;
}

/* ---------------------------------------------------------------- chat panel */
let chatStreaming = false;
function openChat() {
  const p = $('#chatPanel');
  p.classList.add('open');
  p.setAttribute('aria-hidden', 'false');
  renderChatHistory(S.current);
  setTimeout(() => $('#chatInput').focus(), 320);
}
function closeChat() {
  const p = $('#chatPanel');
  p.classList.remove('open');
  p.setAttribute('aria-hidden', 'true');
}
function renderChatHistory(n) {
  const sc = $('#chatScroll');
  sc.textContent = '';
  if (!n || !n.chat || !n.chat.length) {
    sc.append(el('div', { class: 'chat-hint' }, 'Ask anything about this meeting — answers come from the transcript and cite the lines they come from.'));
    return;
  }
  for (const m of n.chat) sc.append(chatBubble(m.role, m.content));
  sc.scrollTop = sc.scrollHeight;
}
function chatBubble(role, content) {
  const b = el('div', { class: 'msg ' + (role === 'user' ? 'user' : 'ai') });
  if (role === 'assistant') b.append(renderRich(content));
  else b.textContent = content;
  return b;
}

async function sendChat() {
  const n = S.current;
  if (!n || chatStreaming) return;
  const input = $('#chatInput');
  const q = input.value.trim();
  if (!q) return;
  input.value = '';
  const sc = $('#chatScroll');
  const hint = sc.querySelector('.chat-hint'); if (hint) hint.remove();
  sc.append(chatBubble('user', q));
  const ai = chatBubble('assistant', '');
  sc.append(ai);
  sc.scrollTop = sc.scrollHeight;
  chatStreaming = true;
  $('#chatSendBtn').disabled = true;
  let acc = '';
  let t = null;
  const paint = () => {
    t = null;
    ai.textContent = '';
    ai.append(renderRich(acc || '…'));
    sc.scrollTop = sc.scrollHeight;
  };
  try {
    await streamSSE(`/api/notes/${n.id}/ask`, { question: q }, (ev) => {
      if (ev.t === 'delta') { acc += ev.v; if (!t) t = setTimeout(paint, 80); }
      else if (ev.t === 'error') { ai.textContent = ev.message; ai.className = 'msg err'; }
      else if (ev.t === 'done') {
        if (t) clearTimeout(t);
        paint();
        n.chat = [...(n.chat || []), { role: 'user', content: q }, { role: 'assistant', content: acc }];
      }
    });
  } catch (e) {
    ai.textContent = e.message; ai.className = 'msg err';
  }
  chatStreaming = false;
  $('#chatSendBtn').disabled = false;
}

/* ---------------------------------------------------------------- settings */
function openSettings() {
  const s = S.settings || {};
  const keyInp = el('input', { type: 'password', placeholder: s.hasKey ? s.groqKeyMasked : 'gsk_…', autocomplete: 'off' });
  const tModel = el('select', {},
    el('option', { value: 'whisper-large-v3', selected: s.transcribeModel !== 'whisper-large-v3-turbo' ? true : null }, 'Whisper large v3 (most accurate — recommended)'),
    el('option', { value: 'whisper-large-v3-turbo', selected: s.transcribeModel === 'whisper-large-v3-turbo' ? true : null }, 'Whisper large v3 turbo (fastest)'));
  const sModel = el('select', {},
    ...['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'].map((m) =>
      el('option', { value: m, selected: s.model === m ? true : null }, m + (m === 'openai/gpt-oss-120b' ? ' (recommended)' : ''))),
  );
  const theme = el('select', {},
    el('option', { value: 'system', selected: S.theme === 'system' ? true : null }, 'System'),
    el('option', { value: 'light', selected: S.theme === 'light' ? true : null }, 'Light'),
    el('option', { value: 'dark', selected: S.theme === 'dark' ? true : null }, 'Dark'));

  openModal(el('div', {},
    el('h2', {}, 'Settings'),
    el('p', { class: 'sub' }, 'Your key is stored only in this app’s local data folder (gitignored) and is sent only to Groq.'),
    el('div', { class: 'set-row' },
      el('div', { class: 'lbl' }, el('div', {}, 'Groq API key'), el('div', { class: 'hint' }, 'Free at console.groq.com → API Keys. Currently: ', el('span', { class: 'key-display' }, s.hasKey ? s.groqKeyMasked : 'not set'))),
      keyInp),
    el('div', { class: 'set-row' }, el('div', { class: 'lbl' }, el('div', {}, 'Transcription model')), tModel),
    el('div', { class: 'set-row' }, el('div', { class: 'lbl' }, el('div', {}, 'Summary & chat model')), sModel),
    el('div', { class: 'set-row' }, el('div', { class: 'lbl' }, el('div', {}, 'Appearance')), theme),
    el('div', { class: 'form-err', id: 'setErr' }),
    el('div', { class: 'modal-actions' },
      el('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
      el('button', {
        class: 'btn primary', onclick: async () => {
          const body = {};
          if (keyInp.value.trim()) body.groqKey = keyInp.value.trim();
          body.transcribeModel = tModel.value;
          body.model = sModel.value;
          try {
            S.settings = await api('/api/settings', { method: 'POST', body });
            S.theme = theme.value; localStorage.setItem('nt.theme', S.theme); applyTheme();
            closeModal();
            toast('Settings saved');
          } catch (e) { $('#setErr').textContent = e.message; }
        },
      }, 'Save'),
    ),
  ));
}

/* ---------------------------------------------------------------- delete / confirm */
function confirmDelete(n) {
  openModal(el('div', {},
    el('h2', {}, `Delete “${n.title}”?`),
    el('p', { class: 'sub' }, 'This permanently removes the note, transcript' + (n.audioFile ? ', audio' : '') + ' and chat. This cannot be undone.'),
    el('div', { class: 'modal-actions' },
      el('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
      el('button', {
        class: 'btn danger', onclick: async () => {
          closeModal();
          try {
            await api(`/api/notes/${n.id}`, { method: 'DELETE' });
            if (S.view.kind === 'note' && S.view.id === n.id) goHome();
            await loadNotes();
            toast('Deleted');
          } catch (e) { toast(e.message, true); }
        },
      }, 'Delete'),
    ),
  ), { width: 420 });
}

/* ---------------------------------------------------------------- search palette */
let palSel = 0;
function openPalette() {
  palSel = 0;
  const input = el('input', { type: 'text', placeholder: 'Search meetings and notes…', autocomplete: 'off' });
  const list = el('ul');
  const box = el('div', { class: 'palette' }, input, list);
  const scrim = el('div', { class: 'scrim', onclick: (e) => { if (e.target === scrim) closeModal(); } }, box);
  $('#modalRoot').append(scrim);
  const onKey = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', onKey);
  closeModal._cleanup = () => document.removeEventListener('keydown', onKey);
  setTimeout(() => input.focus(), 30);

  const draw = () => {
    const q = input.value.trim().toLowerCase();
    list.textContent = '';
    // Search over sidebar metas: title, agenda, body, and summary text.
    let items = S.notes.filter((n) => {
      if (!q) return true;
      const sumText = n.summary ? JSON.stringify(n.summary) : '';
      const hay = [n.title, n.agenda || '', n.body || '', sumText].join(' ').toLowerCase();
      return hay.includes(q);
    });
    items = items.slice(0, 12);
    if (!items.length) list.append(el('li', { class: 'empty' }, 'No results'));
    items.forEach((n, i) => {
      list.append(el('li', {
        class: i === palSel ? 'sel' : '',
        onclick: () => { closeModal(); openNote(n.id); },
        onmouseenter: () => { palSel = i; [...list.children].forEach((c, j) => c.classList.toggle('sel', j === i)); },
      },
        icon(n.type === 'meeting' ? 'mic' : 'page'),
        el('span', {}, n.title || 'Untitled'),
        el('span', { class: 'pgroup' }, n.type === 'meeting' ? 'Meeting' : 'Note'),
      ));
    });
  };
  input.addEventListener('input', draw);
  input.addEventListener('keydown', (e) => {
    const rows = [...list.querySelectorAll('li:not(.empty)')];
    if (e.key === 'ArrowDown') { palSel = Math.min(rows.length - 1, palSel + 1); [...rows].forEach((r, j) => r.classList.toggle('sel', j === palSel)); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { palSel = Math.max(0, palSel - 1); [...rows].forEach((r, j) => r.classList.toggle('sel', j === palSel)); e.preventDefault(); }
    else if (e.key === 'Enter') { const item = rows[palSel]; if (item) item.click(); }
  });
  draw();
}

/* ---------------------------------------------------------------- example fixture */
async function loadExample() {
  const segs = [
    ['0:00', 'Alright, it is Tuesday. Quick launch sync for the mobile app. Maya, where are we on the beta build?'],
    ['0:14', 'Beta two is uploaded to TestFlight. Crash-free sessions are at ninety-nine point two percent, so I am comfortable expanding the beta group on Thursday.'],
    ['0:29', 'Good. What about the onboarding flow? We said we would cut the sign-up form from five screens to two.'],
    ['0:41', 'That is done. Time to complete sign-up dropped from two minutes ten to forty seconds on average. Support tickets about onboarding basically stopped this week.'],
    ['1:02', 'Nice. Pricing page, Daniel?'],
    ['1:08', 'The yearly plan is now the default toggle. In the A-B test it lifted conversion about eight percent, and nobody complained in the feedback form, so I say we ship it with beta two.'],
    ['1:27', 'Agreed, ship it. One risk: App Store review can take a few days. Maya, submit Thursday morning so we have buffer before the announcement.'],
    ['1:44', 'Will do. Also I need the final screenshots from design by Wednesday, otherwise I cannot submit.'],
    ['1:56', 'I will nudge the design channel today and own that deadline. And after launch, who writes the changelog?'],
    ['2:11', 'I can draft the changelog by Friday and send it around for review.'],
    ['2:20', 'Perfect. Last thing, we decided the announcement goes out Tuesday next week, not Monday, because of the weekend email stats. Let us keep the press list to the thirty journalists Daniel already shortlisted.'],
    ['2:41', 'Sounds good. I will keep the list at thirty and add tracking links before we send.'],
  ];
  const summary = {
    summary: [
      'The team synced on the mobile app launch. The beta build is healthy (99.2% crash-free) and the beta group expands Thursday [1]. Onboarding was cut from five screens to two, dropping sign-up time to 40 seconds [2]. The yearly-plan default lifted conversion about 8% and will ship with beta two [3].',
      '- Beta two is on TestFlight; expanding the beta group Thursday pending screenshots [1]',
      '- Sign-up now completes in 40 seconds after removing three onboarding screens [2]',
      '- Yearly plan becomes the default toggle after an 8% conversion lift in testing [3]',
    ],
    actions: [
      { text: 'Submit beta two to App Store review Thursday morning (Maya) [4]', done: false },
      { text: 'Chase design for final screenshots by Wednesday (you) [5]', done: true },
      { text: 'Draft the launch changelog by Friday for review (Daniel) [6]', done: false },
      { text: 'Keep the press list at 30 contacts and add tracking links before sending (Daniel) [7]', done: false },
    ],
    decisions: [
      'Ship the yearly-plan default with beta two [3]',
      'Announce on Tuesday next week instead of Monday [7]',
    ],
    nextSteps: [
      'Expand the beta group Thursday after the App Store submission [1]',
      'Finalize tracking links with the press list before the announcement [7]',
    ],
  };
  // build segments with seconds
  const parseT = (s) => { const [m, sec] = s.split(':').map(Number); return m * 60 + sec; };
  const transcript = segs.map(([t, text], i) => {
    const start = parseT(t);
    const end = i + 1 < segs.length ? parseT(segs[i + 1][0]) : start + 12;
    return { start, end, text };
  });
  try {
    const note = await api('/api/notes', { method: 'POST', body: { type: 'meeting', status: 'ready', title: 'Mobile Launch Sync', source: 'example' } });
    await api(`/api/notes/${note.id}`, {
      method: 'PATCH',
      body: { segments: transcript, durationSec: 170, summary, title: 'Mobile Launch Sync' },
    });
    await loadNotes();
    await openNote(note.id);
  } catch (e) { toast(e.message, true); }
}

/* ---------------------------------------------------------------- wire up */
function wire() {
  // sidebar icons
  document.querySelectorAll('[data-icon]').forEach((n) => { n.innerHTML = I[n.dataset.icon] || ''; });
  $('#searchBtn').onclick = openPalette;
  $('#homeBtn').onclick = goHome;
  $('#settingsBtn').onclick = openSettings;
  $('#newMeetingBtn').onclick = () => openNewMeetingModal('record');
  $('#newNoteBtn').onclick = createPlainNote;
  $('#chatCloseBtn').onclick = closeChat;
  $('#chatClearBtn').onclick = async () => {
    if (!S.current) return;
    S.current.chat = [];
    renderChatHistory(S.current);
    await api(`/api/notes/${S.current.id}`, { method: 'PATCH', body: { chatClear: true } }).catch(() => {});
  };
  $('#skillCloseBtn').onclick = () => { $('#skillPop').hidden = true; };
  $('#chatForm').addEventListener('submit', (e) => { e.preventDefault(); sendChat(); });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (S.theme === 'system') applyTheme(); });
}

async function createPlainNote() {
  try {
    const note = await api('/api/notes', { method: 'POST', body: { type: 'note', status: 'ready' } });
    S.notes.unshift({ ...note });
    await openNote(note.id);
  } catch (e) { toast(e.message, true); }
}

function renderPlainNote(main, n) {
  const page = el('div', { class: 'note-page' });
  const title = el('h1', {
    class: 'page-title', contenteditable: 'plaintext-only', spellcheck: 'false', dataset: { ph: 'Untitled' },
    oninput: debounce(() => saveTitle(n, title), 500),
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } },
  }, n.title === 'Untitled' ? '' : n.title);
  const body = el('div', {
    class: 'note-body', contenteditable: 'plaintext-only', spellcheck: 'true',
    oninput: debounce(() => {
      n.body = body.textContent;
      api(`/api/notes/${n.id}`, { method: 'PATCH', body: { body: n.body } });
    }, 600),
  }, n.body || '');
  page.append(title, el('div', { class: 'props' }, propRow('clock', 'Created', `${fmtDate(n.createdAt)} · ${fmtTime(n.createdAt)}`)), body);
  main.append(page);
}

/* ---------------------------------------------------------------- init */
(async function init() {
  applyTheme();
  wire();
  try { S.settings = await api('/api/settings'); } catch { /* */ }
  await loadNotes();
  render();
  if (S.settings && !S.settings.hasKey) {
    // first-run nudge
    setTimeout(() => {
      openModal(el('div', {},
        el('h2', {}, 'Add your Groq API key'),
        el('p', { class: 'sub' }, 'Notetaker runs on your own Groq key: Whisper transcribes the meeting, Llama writes the summary. Get a free key at console.groq.com.'),
        el('div', { class: 'field' }, el('label', {}, 'Groq API key'), el('input', { type: 'password', id: 'firstKey', placeholder: 'gsk_…', autocomplete: 'off' })),
        el('div', { class: 'form-err', id: 'firstKeyErr' }),
        el('div', { class: 'modal-actions' },
          el('button', { class: 'btn', onclick: () => { closeModal(); openSettings(); } }, 'Open Settings'),
          el('button', {
            class: 'btn primary', onclick: async () => {
              const k = $('#firstKey').value.trim();
              try {
                S.settings = await api('/api/settings', { method: 'POST', body: { groqKey: k } });
                closeModal(); toast('Key saved — you are ready');
              } catch (e) { $('#firstKeyErr').textContent = e.message; }
            },
          }, 'Save key'),
        ),
      ), { width: 460 });
    }, 400);
  }
})();
