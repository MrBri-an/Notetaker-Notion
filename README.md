# Notetaker — Notion-style AI meeting notes, on your Groq key

A local, zero-dependency clone of **Notion AI Meeting Notes**: record a meeting → live
transcript streams in → stop → Notetaker writes the title, summary, action items,
decisions and next steps, with citations that jump back to the transcript.

```
node server.js        →  http://127.0.0.1:4174
```

No `npm install`. Requires Node 18+ (uses built-in `fetch`, `FormData`, `Blob`).

## What you get

- **Start meeting note** — consent check, agenda box (the AI reads it), live timestamped
  transcript, mic waveform, pause/resume, in-meeting skills (*Catch me up · Suggest
  questions · Recap decisions*).
- **Accurate live transcription** — audio is cut at natural speech pauses (never
  mid-word), captured at 64 kbps from the raw mic signal, and transcribed by
  **Whisper large v3** (measured 0% word error on a spoken fixture; turbo is ~4%).
  Windows without speech are discarded, so Groq requests aren't wasted.
- **Stop & summarize** — the same post-meeting doc Notion produces: AI callout summary,
  to-do action items you can tick off, decisions, next steps. Click a `[n]` citation to
  jump to that transcript line (and the audio moment).
- **Upload audio** — AAC / M4A / MP3 / WAV / OGG / WebM up to 25 MB → same pipeline.
- **Ask AI** — chat about the meeting, grounded in the transcript, answers cited.
- **Search** (`Ctrl/⌘+K`), plain **Notes** pages, light/dark theme, 17 languages.

## Your Groq key

- Uses **Whisper large v3** for transcription (accuracy-first; switch to the faster
  turbo in Settings) and **Llama-class / GPT-OSS models via Groq** for notes and chat.
- The key lives in `data/db.json` (gitignored). On first boot the app imports it
  automatically from the sibling **AEO Radar** app's config if present; otherwise you
  paste it once in **Settings**. It is sent only to `api.groq.com`.

## Files

```
server.js             zero-dep Node server (API, Groq proxy, static)
lib/groq.js           transcription + streaming chat, 429/5xx backoff retry
lib/db.js             JSON file store (data/db.json)
lib/multipart.js      multipart/form-data parser
public/               the app (vanilla JS, Notion look, light+dark)
test/pipeline.test.js end-to-end test against a running server (real Groq)
test/accuracy.test.js WER comparison of Whisper models on a spoken fixture
SPEC.md               the reverse-engineered Notion behavior spec + decisions
data/                 gitignored: key, notes, audio   ← never commit
```

## Honest differences vs Notion

Browser pages can only capture your microphone — so **no speaker labels** (Notion's
desktop app diarizes by capturing call audio), and no Zoom/Meet auto-join or calendar
sync. Everything else follows Notion's flow. Details in `SPEC.md`.
