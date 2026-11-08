#!/usr/bin/env node
'use strict';
// Notetaker — Notion-style AI meeting notes, zero-dependency Node server.
// Run: node server.js  →  http://127.0.0.1:4174

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const store = require('./lib/db');
const groq = require('./lib/groq');
const { parseMultipart } = require('./lib/multipart');

const PORT = process.env.PORT ? Number(process.env.PORT) : 4174;
const HOST = '127.0.0.1';
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const AUDIO_DIR = path.join(ROOT, 'data', 'audio');

const AUDIO_MIME = {
  '.webm': 'audio/webm', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.opus': 'audio/ogg',
};

// ---------------------------------------------------------------------------
// First boot: import the Groq key from a sibling AEO Radar config if present
// (same machine, same user, gitignored — never printed).
(function importKeyFromSibling() {
  const cfg = store.config;
  if (cfg.groqKey) return;
  const candidates = [path.join(ROOT, '..', 'aeo-radar', 'data', 'db.json')];
  for (const p of candidates) {
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      const k = j && j.config && j.config.apiKeys && j.config.apiKeys.groq;
      if (k && typeof k === 'string' && k.startsWith('gsk_')) {
        store.setConfig({ groqKey: k });
        console.log('[setup] Groq key imported from sibling AEO Radar config (stored locally, gitignored).');
        return;
      }
    } catch { /* not present — fine */ }
  }
})();

// ---------------------------------------------------------------------------
// Model validation: Groq retires models; if the stored model is gone, fall back
// to the best available one so the app keeps working.
const CHAT_PREFERENCE = ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b'];
// Accuracy first: the full Whisper model beats the turbo distillation on real speech.
const TRANSCRIBE_PREFERENCE = ['whisper-large-v3', 'whisper-large-v3-turbo'];

async function ensureModelsValid() {
  const cfg = store.config;
  if (!cfg.groqKey) return;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${cfg.groqKey}` },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return;
    const j = await res.json();
    const available = new Set((j.data || []).map((m) => m.id));
    const pick = (current, preference) => {
      if (available.has(current)) return current;
      const fallback = preference.find((m) => available.has(m));
      return fallback || current;
    };
    const chat = pick(cfg.model, CHAT_PREFERENCE);
    const tr = pick(cfg.transcribeModel, TRANSCRIBE_PREFERENCE);
    if (chat !== cfg.model || tr !== cfg.transcribeModel) {
      store.setConfig({ model: chat, transcribeModel: tr });
      console.log(`[setup] model fallback → chat: ${chat}, transcription: ${tr}`);
    }
  } catch { /* offline or slow — keep stored values */ }
}

// ---------------------------------------------------------------------------
// Prompts — reverse-engineered from Notion AI Meeting Notes post-meeting output:
// auto title, summary with key points, action items, decisions, next steps,
// citations [n] that map to transcript lines.
const SUMMARY_SYSTEM = `You are Notetaker AI, an assistant that turns meeting transcripts into clean meeting notes like Notion's AI meeting notes.

Given a numbered meeting transcript, respond in EXACTLY this format (no extra sections, no markdown before the first heading):

## Title
A short 2-6 word meeting title (Title Case, no quotes, no brackets).

## Summary
A 2-4 sentence overview paragraph of what the meeting covered. Then 3-6 key points as lines starting with "- ". Cite the transcript by putting [n] (the segment number) right after the sentence or bullet it came from, e.g. "- Launch is planned for Q3 [4]".

## Action items
Lines starting with "- [ ] " describing each task, followed by the owner if identifiable in parentheses and its citation [n]. Example: "- [ ] Send the updated contract to legal (Maya) [7]". If there are none, write exactly "(No action items)".

## Decisions
Lines starting with "- " for each decision that was made, each ending with its citation [n]. If none, write exactly "(No decisions recorded)".

## Next steps
Lines starting with "- " for what should happen next, each ending with its citation [n]. If none, write exactly "(No next steps)".

Rules: be concise and factual; do not invent people, dates or facts; keep the exact heading spellings; no text outside the format.`;

const ASK_SYSTEM = `You are Notetaker AI answering questions about a meeting, using the numbered transcript provided. Answer only from the transcript and provided notes; if the answer is not there, say so plainly. Keep answers short (1-5 sentences or a short bullet list). Cite segments inline as [n] where they support the answer. Use markdown-lite: "- " bullets and **bold** only.`;

const SKILL_SYSTEMS = {
  catchup: `You are Notetaker AI. The user is in a live meeting and asks to be caught up. Summarize the meeting SO FAR in 3-5 short "- " bullets: what has been discussed and any decisions so far. No citations needed. Plain text only.`,
  questions: `You are Notetaker AI. Based on the live meeting transcript so far, suggest exactly 3 sharp, useful questions the user could ask next, each as a "- " bullet. Make them specific to what has been said. Plain text only.`,
  decisions: `You are Notetaker AI. List any decisions that appear to have been made so far in the meeting, each as a "- " bullet with the speaker/context if visible. If nothing has been decided yet, say so in one sentence. Plain text only.`,
};

// ---------------------------------------------------------------------------
// Small HTTP helpers
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function badRequest(res, msg) { json(res, 400, { error: msg }); }

function readJson(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function sse(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  return {
    send: (obj) => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch { /* closed */ } },
    end: () => { try { res.end(); } catch { /* closed */ } },
  };
}

function newId() { return crypto.randomUUID().replace(/-/g, '').slice(0, 12); }
function maskKey(k) {
  if (!k) return '';
  if (k.length <= 8) return '•'.repeat(k.length);
  return k.slice(0, 4) + '•'.repeat(6) + k.slice(-4);
}
function publicNote(n) {
  // Never ship the config; notes are already safe. Strip nothing — all fields are user data.
  return n;
}
function publicSettings() {
  const c = store.config;
  return { hasKey: !!c.groqKey, groqKeyMasked: maskKey(c.groqKey), model: c.model, transcribeModel: c.transcribeModel };
}

function transcriptText(note, maxChars = 60000) {
  const segs = (note.transcript || []);
  let out = '';
  let cut = false;
  segs.forEach((s, i) => {
    if (out.length >= maxChars) { cut = true; return; }
    out += `[${i + 1}] ${s.text}\n`;
  });
  return cut ? out + '\n[Transcript truncated]' : out;
}

function buildSummaryUserPrompt(note) {
  const parts = [];
  if (note.agenda && note.agenda.trim()) {
    parts.push(`Meeting agenda / context written by the user (factor this in):\n"""${note.agenda.trim().slice(0, 2000)}"""\n`);
  }
  parts.push(`Meeting transcript (numbered segments; cite as [n]):\n${transcriptText(note)}`);
  parts.push('Produce the meeting notes in the exact format.');
  return parts.join('\n');
}

// Parse the model's markdown into structured sections.
function parseSummary(md) {
  const lines = md.split(/\r?\n/);
  const out = { title: '', summary: [], actions: [], decisions: [], nextSteps: [] };
  let mode = null;
  for (let raw of lines) {
    const line = raw.trim();
    const h = /^##\s*(title|summary|action items|decisions|next steps)/i.exec(line);
    if (h) {
      const name = h[1].toLowerCase();
      mode = name === 'title' ? 'title' : name === 'summary' ? 'summary'
        : name === 'action items' ? 'actions' : name === 'decisions' ? 'decisions' : 'nextSteps';
      continue;
    }
    if (!mode) {
      if (line && !out.title) out.title = line.replace(/^["'#\s]+|["'\s]+$/g, '');
      continue;
    }
    if (!line) continue;
    if (mode === 'title') { if (!out.title) out.title = line.replace(/^["'#\s]+|["'\s]+$/g, ''); continue; }
    if (mode === 'summary') { out.summary.push(line); continue; }
    // list modes
    let text = line.replace(/^[-*]\s*(?:\[\s*[xX]?\s*\]\s*)?/, '').trim();
    if (!text) continue;
    if (/^\(no (action items|decisions recorded|next steps)\)$/i.test(text)) continue;
    if (mode === 'actions') out.actions.push({ text, done: false });
    else if (mode === 'decisions') out.decisions.push(text);
    else out.nextSteps.push(text);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Static file serving (public/ only, traversal-guarded)
function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === '/' || rel === '') rel = '/index.html';
  const abs = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!abs.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(abs, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(abs).toLowerCase();
    const mime = {
      '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
      '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2',
    }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

// ---------------------------------------------------------------------------
// AI generation endpoints (SSE)
async function requireKey(res) {
  const c = store.config;
  if (!c.groqKey) {
    json(res, 400, { error: 'No Groq API key configured. Open Settings and add your key (gsk_…).' });
    return null;
  }
  return c;
}

async function handleGenerate(req, res, note) {
  const cfg = await requireKey(res);
  if (!cfg) return;
  const segs = note.transcript || [];
  const totalChars = segs.reduce((a, s) => a + (s.text || '').length, 0);
  const durationSec = segs.length ? segs[segs.length - 1].end || 0 : 0;
  // Notion's rule: at least ~1 minute (~300 transcribed characters) of audio.
  if (totalChars < 120) {
    json(res, 400, { error: 'There is not enough speech to summarize yet. Record at least a minute of the meeting, or try again after more conversation.', code: 'too_short' });
    return;
  }
  store.updateNote(note.id, { status: 'processing', error: null });
  const s = sse(res);
  s.send({ t: 'start', status: 'processing' });
  try {
    const stream = await groq.chatStream({
      apiKey: cfg.groqKey,
      model: cfg.model,
      system: SUMMARY_SYSTEM,
      messages: [{ role: 'user', content: buildSummaryUserPrompt(note) }],
      temperature: 0.3,
      maxTokens: 3072,
    });
    let acc = '';
    for await (const d of stream) {
      acc += d;
      s.send({ t: 'delta', v: d });
    }
    const parsed = parseSummary(acc);
    const patch = {
      status: 'ready',
      processedAt: Date.now(),
      error: null,
      summary: {
        summary: parsed.summary,
        actions: parsed.actions,
        decisions: parsed.decisions,
        nextSteps: parsed.nextSteps,
        generatedBy: cfg.model,
      },
    };
    if (parsed.title) patch.title = parsed.title;
    const updated = store.updateNote(note.id, patch);
    s.send({ t: 'done', note: publicNote(updated) });
  } catch (e) {
    console.error('[generate]', e.message);
    store.updateNote(note.id, { status: 'failed', error: e.message });
    s.send({ t: 'error', message: e.message });
  } finally {
    s.end();
  }
}

async function handleAsk(req, res, note, body) {
  const cfg = await requireKey(res);
  if (!cfg) return;
  const question = String(body.question || '').trim();
  if (!question) return badRequest(res, 'Empty question');
  const history = Array.isArray(note.chat) ? note.chat.slice(-12) : [];
  const s = sse(res);
  try {
    const sys = `${ASK_SYSTEM}\n\nMeeting title: ${note.title}\nSummary so far: ${JSON.stringify(note.summary || null)}\n\nNumbered transcript:\n${transcriptText(note)}`;
    const msgs = [...history.map((m) => ({ role: m.role, content: m.content })), { role: 'user', content: question }];
    const stream = await groq.chatStream({
      apiKey: cfg.groqKey, model: cfg.model, system: sys, messages: msgs, temperature: 0.4, maxTokens: 1024,
    });
    let acc = '';
    for await (const d of stream) { acc += d; s.send({ t: 'delta', v: d }); }
    const chat = [...(note.chat || []), { role: 'user', content: question }, { role: 'assistant', content: acc }];
    store.updateNote(note.id, { chat });
    s.send({ t: 'done' });
  } catch (e) {
    console.error('[ask]', e.message);
    s.send({ t: 'error', message: e.message });
  } finally {
    s.end();
  }
}

async function handleSkill(req, res, note, body) {
  const cfg = await requireKey(res);
  if (!cfg) return;
  const skill = String(body.skill || '');
  const sys = SKILL_SYSTEMS[skill];
  if (!sys) return badRequest(res, 'Unknown skill');
  const s = sse(res);
  try {
    const stream = await groq.chatStream({
      apiKey: cfg.groqKey, model: cfg.model, system: sys,
      messages: [{ role: 'user', content: `Live meeting transcript so far:\n${transcriptText(note, 30000)}\n\nPerform the "${skill}" task now.` }],
      temperature: 0.5, maxTokens: 600,
    });
    let acc = '';
    for await (const d of stream) { acc += d; s.send({ t: 'delta', v: d }); }
    s.send({ t: 'done' });
  } catch (e) {
    console.error('[skill]', e.message);
    s.send({ t: 'error', message: e.message });
  } finally {
    s.end();
  }
}

// ---------------------------------------------------------------------------
// Note mutations via PATCH (fine-grained, validated)
function applyPatch(note, body) {
  const b = body || {};
  if (typeof b.title === 'string') note.title = b.title.slice(0, 200) || 'Untitled';
  if (typeof b.agenda === 'string') note.agenda = b.agenda.slice(0, 4000);
  if (typeof b.body === 'string') note.body = b.body.slice(0, 100000);
  if (typeof b.status === 'string' && ['recording', 'processing', 'ready', 'failed'].includes(b.status)) note.status = b.status;
  if (typeof b.durationSec === 'number' && b.durationSec >= 0) note.durationSec = Math.round(b.durationSec);
  if (Array.isArray(b.segmentsAppend)) {
    if (!Array.isArray(note.transcript)) note.transcript = [];
    for (const s of b.segmentsAppend) {
      if (s && typeof s.start === 'number' && typeof s.end === 'number' && typeof s.text === 'string') {
        note.transcript.push({ start: Math.max(0, s.start), end: Math.max(0, s.end), text: s.text.slice(0, 2000) });
      }
    }
  }
  if (Array.isArray(b.segments)) {
    note.transcript = b.segments.filter((s) => s && typeof s.text === 'string').map((s) => ({
      start: Math.max(0, Number(s.start) || 0), end: Math.max(0, Number(s.end) || 0), text: String(s.text).slice(0, 2000),
    }));
  }
  if (b.summary && typeof b.summary === 'object') {
    const s = b.summary;
    note.summary = {
      summary: Array.isArray(s.summary) ? s.summary.map(String) : [],
      actions: Array.isArray(s.actions) ? s.actions.filter((a) => a && typeof a.text === 'string').map((a) => ({ text: String(a.text).slice(0, 500), done: !!a.done })) : [],
      decisions: Array.isArray(s.decisions) ? s.decisions.map(String) : [],
      nextSteps: Array.isArray(s.nextSteps) ? s.nextSteps.map(String) : [],
      generatedBy: typeof s.generatedBy === 'string' ? s.generatedBy : '',
    };
  }
  if (b.actionToggle && note.summary && Array.isArray(note.summary.actions)) {
    const i = b.actionToggle.i;
    if (i >= 0 && i < note.summary.actions.length && typeof b.actionToggle.done === 'boolean') {
      note.summary.actions[i].done = b.actionToggle.done;
    }
  }
  if (Array.isArray(b.chatAppend) && b.chatAppend.length) {
    if (!Array.isArray(note.chat)) note.chat = [];
    for (const m of b.chatAppend) {
      if (m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string') {
        note.chat.push({ role: m.role, content: m.content.slice(0, 20000) });
      }
    }
  }
  if (b.chatClear) note.chat = [];
  if (b.summary === null) note.summary = null;
  if (typeof b.audioFile === 'string') note.audioFile = b.audioFile.replace(/[^a-zA-Z0-9._-]/g, '');
}

// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = u.pathname;
  const method = req.method || 'GET';

  try {
    if (p.startsWith('/api/')) {
      // ----- health / settings -----
      if (method === 'GET' && p === '/api/health') {
        return json(res, 200, { ok: true, ...publicSettings() });
      }
      if (method === 'GET' && p === '/api/settings') {
        return json(res, 200, publicSettings());
      }
      if (method === 'POST' && p === '/api/settings') {
        const body = await readJson(req);
        const patch = {};
        if (typeof body.groqKey === 'string') {
          const k = body.groqKey.trim();
          if (k && !k.startsWith('gsk_')) return badRequest(res, 'Groq keys start with "gsk_". Check the key and try again.');
          patch.groqKey = k;
        }
        if (typeof body.model === 'string' && body.model.trim()) patch.model = body.model.trim().slice(0, 80);
        if (typeof body.transcribeModel === 'string' && body.transcribeModel.trim()) patch.transcribeModel = body.transcribeModel.trim().slice(0, 80);
        store.setConfig(patch);
        return json(res, 200, publicSettings());
      }

      // ----- notes CRUD -----
      if (method === 'GET' && p === '/api/notes') {
        const notes = store.listNotes().map((n) => ({ ...n, transcript: undefined, chat: undefined }));
        return json(res, 200, { notes });
      }
      if (method === 'POST' && p === '/api/notes') {
        const body = await readJson(req);
        const type = body.type === 'note' ? 'note' : 'meeting';
        const note = {
          id: newId(),
          type,
          title: (typeof body.title === 'string' && body.title.trim()) || (type === 'meeting' ? 'Meeting notes' : 'Untitled'),
          status: body.status || (type === 'meeting' ? 'recording' : 'ready'),
          createdAt: Date.now(),
          processedAt: null,
          agenda: typeof body.agenda === 'string' ? body.agenda.slice(0, 4000) : '',
          body: '',
          transcript: [],
          summary: null,
          chat: [],
          durationSec: 0,
          audioFile: '',
          error: null,
          source: body.source || (type === 'meeting' ? 'live' : 'note'),
        };
        store.createNote(note);
        return json(res, 200, publicNote(note));
      }

      const noteMatch = /^\/api\/notes\/([a-z0-9-]{6,40})(\/[a-z]+)?$/.exec(p);
      if (noteMatch) {
        const id = noteMatch[1];
        const sub = noteMatch[2] || '';
        const note = store.getNote(id);
        if (!note) return json(res, 404, { error: 'Note not found' });

        if (method === 'GET' && !sub) return json(res, 200, publicNote(note));

        if (method === 'PATCH' && !sub) {
          const body = await readJson(req);
          applyPatch(note, body);
          store.updateNote(id, {});
          return json(res, 200, publicNote(note));
        }

        if (method === 'DELETE' && !sub) {
          // Remove stored audio, then the note (destructive but local + explicit).
          if (note.audioFile) { try { fs.unlinkSync(path.join(AUDIO_DIR, note.audioFile)); } catch { /* ignore */ } }
          store.deleteNote(id);
          return json(res, 200, { ok: true });
        }

        if (method === 'POST' && sub === '/transcribe') {
          const cfg = await requireKey(res);
          if (!cfg) return;
          const { parts } = await parseMultipart(req);
          const filePart = parts.find((x) => x.name === 'file');
          if (!filePart || !filePart.data.length) return badRequest(res, 'No audio file in request');
          const offsetMs = Number(parts.find((x) => x.name === 'offsetMs')?.data.toString() || 0) || 0;
          const langRaw = (parts.find((x) => x.name === 'language')?.data.toString() || '').trim();
          const language = langRaw && langRaw !== 'auto' ? langRaw.split('-')[0] : '';
          const prompt = (parts.find((x) => x.name === 'prompt')?.data.toString() || '').trim();
          const out = await groq.transcribe({
            apiKey: cfg.groqKey,
            model: cfg.transcribeModel,
            fileBuffer: filePart.data,
            filename: filePart.filename || 'audio.webm',
            contentType: filePart.contentType,
            language,
            prompt,
          });
          const segments = out.segments.map((s) => ({
            start: offsetMs / 1000 + s.start,
            end: offsetMs / 1000 + s.end,
            text: s.text,
          }));
          return json(res, 200, { text: out.text, segments });
        }

        if (method === 'POST' && sub === '/audio') {
          const { parts } = await parseMultipart(req);
          const filePart = parts.find((x) => x.name === 'file');
          if (!filePart || !filePart.data.length) return badRequest(res, 'No audio file in request');
          const ext = path.extname(filePart.filename || '.webm').toLowerCase() || '.webm';
          if (!AUDIO_MIME[ext]) return badRequest(res, 'Unsupported audio format. Use AAC, M4A, MP3, WAV, OGG or WebM.');
          fs.mkdirSync(AUDIO_DIR, { recursive: true });
          const fname = `${note.id}${ext}`;
          fs.writeFileSync(path.join(AUDIO_DIR, fname), filePart.data);
          applyPatch(note, { audioFile: fname });
          store.updateNote(id, {});
          return json(res, 200, { ok: true, audioFile: fname });
        }

        if (method === 'GET' && sub === '/audio') {
          if (!note.audioFile) return json(res, 404, { error: 'No audio stored for this note' });
          const abs = path.join(AUDIO_DIR, note.audioFile);
          if (!abs.startsWith(AUDIO_DIR) || !fs.existsSync(abs)) return json(res, 404, { error: 'Audio file missing' });
          res.writeHead(200, { 'Content-Type': AUDIO_MIME[path.extname(abs)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
          fs.createReadStream(abs).pipe(res);
          return;
        }

        if (method === 'POST' && sub === '/generate') {
          return handleGenerate(req, res, note);
        }
        if (method === 'POST' && sub === '/ask') {
          const body = await readJson(req);
          return handleAsk(req, res, note, body);
        }
        if (method === 'POST' && sub === '/skill') {
          const body = await readJson(req);
          return handleSkill(req, res, note, body);
        }
      }

      return json(res, 404, { error: 'Unknown API route' });
    }

    if (method === 'GET') return serveStatic(req, res, p);
    res.writeHead(405); res.end('Method not allowed');
  } catch (e) {
    console.error('[server]', method, p, e.message);
    if (!res.headersSent) json(res, 500, { error: e.message || 'Server error' });
    else res.end();
  }
});

process.on('SIGINT', () => { store.flush(); process.exit(0); });
process.on('SIGTERM', () => { store.flush(); process.exit(0); });

server.listen(PORT, HOST, () => {
  const hasKey = !!store.config.groqKey;
  console.log(`\n  Notetaker running →  http://127.0.0.1:${PORT}`);
  console.log(`  Groq key: ${hasKey ? 'configured ✓' : 'missing — open Settings in the app'}`);
  console.log(`  Transcription: ${store.config.transcribeModel} · Summaries: ${store.config.model}\n`);
  if (hasKey) ensureModelsValid();
});
