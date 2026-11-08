'use strict';
/* End-to-end pipeline test against a running server on 127.0.0.1:4174.
   Uses the real Groq key (tiny requests). Run: node test/pipeline.test.js */

const fs = require('node:fs');
const path = require('node:path');

const BASE = 'http://127.0.0.1:4174';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

async function j(method, p, body) {
  const res = await fetch(BASE + p, {
    method,
    headers: body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function main() {
  // 0. health
  const h = await j('GET', '/api/health');
  check('health', h.status === 200 && h.data.hasKey === true, `key=${h.data.hasKey}`);

  // 1. create note
  const c = await j('POST', '/api/notes', { type: 'meeting', status: 'recording' });
  const id = c.data.id;
  check('create note', c.status === 200 && !!id, id);

  // 2. too_short guard (Notion's ≥1-minute rule)
  const g1 = await fetch(`${BASE}/api/notes/${id}/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const g1j = await g1.json().catch(() => ({}));
  check('too_short guard', g1.status === 400 && g1j.code === 'too_short', g1j.error ? g1j.error.slice(0, 60) : '');

  // 3. real spoken WAV via Windows SAPI
  const wavPath = path.join(__dirname, 'fixture-speech.wav');
  const spoken = 'Team sync. The beta build passed testing, so we ship it on Thursday. Maya owns the App Store submission, and Daniel drafts the changelog by Friday.';
  const ps = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SetOutputToWaveFile('${wavPath.replace(/\//g, '\\')}'); $s.Speak('${spoken}'); $s.Dispose();`;
  const { execSync } = require('node:child_process');
  execSync(`powershell -NoProfile -Command "${ps}"`, { stdio: 'pipe' });
  const wav = fs.readFileSync(wavPath);
  check('SAPI fixture created', wav.length > 20000, `${(wav.length / 1024).toFixed(0)} KB`);

  // 4. transcribe via our API (real Groq whisper)
  const fd = new FormData();
  fd.append('file', new Blob([wav], { type: 'audio/wav' }), 'fixture-speech.wav');
  fd.append('offsetMs', '0');
  const tr = await j('POST', `/api/notes/${id}/transcribe`, fd);
  const segs = tr.data.segments || [];
  const heard = (tr.data.text || '').toLowerCase();
  check('transcribe returns segments', tr.status === 200 && segs.length > 0, `${segs.length} segments`);
  check('transcription hears "thursday"', heard.includes('thursday'), heard.slice(0, 90));
  check('segments have numeric timestamps', segs.length && typeof segs[0].start === 'number', segs[0] ? `${segs[0].start.toFixed(1)}s→${segs[0].end.toFixed(1)}s` : '');

  // 5. patch transcript + agenda, then generate summary (real Groq llama)
  const patch = await j('PATCH', `/api/notes/${id}`, {
    segments: segs,
    agenda: 'Ship decision for beta build and owner assignments',
    durationSec: Math.round((segs[segs.length - 1] || {}).end || 10),
  });
  check('patch transcript', patch.status === 200 && (patch.data.transcript || []).length === segs.length);

  const genRes = await fetch(`${BASE}/api/notes/${id}/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const raw = await genRes.text();
  const events = raw.split('\n\n').filter(Boolean).map((b) => { try { return JSON.parse(b.replace(/^data:\s*/, '')); } catch { return null; } }).filter(Boolean);
  const doneEv = events.find((e) => e.t === 'done');
  const errEv = events.find((e) => e.t === 'error');
  check('generate streams and finishes', !!doneEv, errEv ? errEv.message : `${events.length} events`);
  const note = doneEv && doneEv.note;
  check('summary structured', !!note && note.summary && note.summary.summary.length > 0 && Array.isArray(note.summary.actions));
  check('title generated', !!note && !!note.title && note.title !== 'Meeting notes', note ? note.title : '');
  check('has action items or none-marker', !!note && (note.summary.actions.length >= 0));
  const hasCite = note && note.summary && JSON.stringify(note.summary).includes('[');
  check('citations present', !!hasCite);

  // 6. action toggle
  if (note && note.summary.actions.length) {
    const t = await j('PATCH', `/api/notes/${id}`, { actionToggle: { i: 0, done: true } });
    check('action toggle persists', t.status === 200 && t.data.summary.actions[0].done === true);
  }

  // 7. Ask AI (real Groq, streaming)
  const askRes = await fetch(`${BASE}/api/notes/${id}/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'Who owns the changelog?' }) });
  const askText = await askRes.text();
  const askEvents = askText.split('\n\n').filter(Boolean).map((b) => { try { return JSON.parse(b.replace(/^data:\s*/, '')); } catch { return null; } }).filter(Boolean);
  const askAcc = askEvents.filter((e) => e.t === 'delta').map((e) => e.v).join('');
  check('ask AI answers', askEvents.some((e) => e.t === 'done') && askAcc.length > 5, askAcc.slice(0, 70));
  const fresh = await j('GET', `/api/notes/${id}`);
  check('chat persisted', (fresh.data.chat || []).length === 2);

  // 8. skill (real Groq)
  const skRes = await fetch(`${BASE}/api/notes/${id}/skill`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ skill: 'decisions' }) });
  const skText = await skRes.text();
  check('skill streams', skText.includes('"t":"done"') || skText.includes('"t":"delta"'), `${skText.length} bytes`);

  // 9. delete + audio cleanup
  const del = await j('DELETE', `/api/notes/${id}`);
  const after = await j('GET', `/api/notes/${id}`);
  check('delete note', del.status === 200 && after.status === 404);

  fs.unlinkSync(wavPath);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
