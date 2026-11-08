'use strict';
/* Transcription accuracy check: speaks a known paragraph with Windows SAPI,
   transcribes it with both Whisper models on Groq, and reports word error rate.
   Run: node test/accuracy.test.js */

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const store = require('../lib/db');
const groq = require('../lib/groq');

const GROUND_TRUTH = 'Welcome to the weekly product sync. Today we are covering the pricing page redesign, the onboarding checklist, and the Q4 launch timeline. Maya will submit the beta build on Thursday morning, and Daniel owns the changelog and the press list. Please remember the announcement moves to Tuesday because of weekend email engagement.';

function wer(refStr, hypStr) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  const r = norm(refStr), h = norm(hypStr);
  if (!r.length) return h.length ? 1 : 0;
  const dp = Array.from({ length: r.length + 1 }, (_, i) => [i, ...new Array(h.length).fill(0)]);
  for (let j = 1; j <= h.length; j++) dp[0][j] = j;
  for (let i = 1; i <= r.length; i++) {
    for (let j = 1; j <= h.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
    }
  }
  return dp[r.length][h.length] / r.length;
}

async function main() {
  const cfg = store.config;
  if (!cfg.groqKey) { console.error('No Groq key configured'); process.exit(1); }

  // 1. speak the fixture (slow-ish, natural pauses at punctuation)
  const wavPath = path.join(__dirname, 'fixture-accuracy.wav');
  const spoken = GROUND_TRUTH;
  const ps = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate = -1; $s.SetOutputToWaveFile('${wavPath.replace(/\//g, '\\')}'); $s.Speak('${spoken}'); $s.Dispose();`;
  execSync(`powershell -NoProfile -Command "${ps}"`, { stdio: 'pipe' });
  const wav = fs.readFileSync(wavPath);
  console.log(`fixture: ${(wav.length / 1024).toFixed(0)} KB WAV\n`);

  // 2. transcribe with both models
  const results = {};
  for (const model of ['whisper-large-v3', 'whisper-large-v3-turbo']) {
    const t0 = Date.now();
    const out = await groq.transcribe({ apiKey: cfg.groqKey, model, fileBuffer: wav, filename: 'fixture.wav', contentType: 'audio/wav' });
    const ms = Date.now() - t0;
    results[model] = { text: out.text, wer: wer(GROUND_TRUTH, out.text), ms, segments: out.segments.length };
    console.log(`--- ${model} (${ms} ms, ${out.segments.length} segments) — WER ${(results[model].wer * 100).toFixed(1)}%`);
    console.log(`    ${out.text.slice(0, 160)}\n`);
  }

  const a = results['whisper-large-v3'].wer, b = results['whisper-large-v3-turbo'].wer;
  console.log(a <= b ? `WINNER: whisper-large-v3 (WER ${(a * 100).toFixed(1)}% vs ${(b * 100).toFixed(1)}%)` : `WINNER: whisper-large-v3-turbo (WER ${(b * 100).toFixed(1)}% vs ${(a * 100).toFixed(1)}%)`);

  fs.unlinkSync(wavPath);
  process.exit(0);
}

main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
