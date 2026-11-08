'use strict';
// Groq API client (zero-dependency, Node 18+ global fetch/FormData/Blob).
// Retries 429 / 5xx / network errors with backoff (free-tier rate limits are common).

const API = 'https://api.groq.com/openai/v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function errFrom(res, body) {
  let msg = `HTTP ${res.status}`;
  try {
    const j = JSON.parse(body);
    if (j && j.error) msg = (j.error.message || String(j.error)) || msg;
  } catch { /* keep default */ }
  const e = new Error(msg);
  e.status = res.status;
  return e;
}

async function withRetry(fn, { tries = 3, label = 'groq' } = {}) {
  let lastErr;
  for (let a = 0; a < tries; a++) {
    try {
      return await fn(a);
    } catch (e) {
      lastErr = e;
      const status = e.status || 0;
      const retriable = status === 429 || status >= 500 || status === 0;
      if (!retriable || a === tries - 1) throw e;
      const wait = [1200, 3000, 6000][a] + Math.random() * 500;
      console.warn(`[${label}] ${status || 'network error'} — retry ${a + 1} in ${Math.round(wait)}ms`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

// Speech-to-text. Returns { text, segments: [{start, end, text}] } with seconds.
async function transcribe({ apiKey, model, fileBuffer, filename, contentType, language, prompt }) {
  return withRetry(async () => {
    const fd = new FormData();
    fd.append('file', new Blob([fileBuffer], { type: contentType || 'application/octet-stream' }), filename || 'audio.webm');
    fd.append('model', model);
    fd.append('response_format', 'verbose_json');
    if (language) fd.append('language', language);
    if (prompt) fd.append('prompt', prompt.slice(0, 800));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 120000);
    let res;
    try {
      res = await fetch(`${API}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: fd,
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    if (!res.ok) throw errFrom(res, text);
    const j = JSON.parse(text);
    const segments = Array.isArray(j.segments)
      ? j.segments.map((s) => ({ start: s.start || 0, end: s.end || 0, text: (s.text || '').trim() }))
      : [];
    return { text: (j.text || '').trim(), segments };
  }, { label: 'transcribe' });
}

// Streaming chat completion. Returns an async generator of text deltas.
async function chatStream({ apiKey, model, system, messages, temperature = 0.4, maxTokens = 3072, signal }) {
  const payload = {
    model,
    messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
    temperature,
    max_tokens: maxTokens,
    stream: true,
  };
  const res = await fetch(`${API}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) {
    const t = await res.text();
    throw errFrom(res, t);
  }
  async function* deltas() {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const payloadLine = line.slice(5).trim();
        if (payloadLine === '[DONE]') return;
        try {
          const j = JSON.parse(payloadLine);
          const d = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
          if (d) yield d;
        } catch { /* skip malformed chunk */ }
      }
    }
  }
  return deltas();
}

module.exports = { transcribe, chatStream };
