# Notetaker — reverse-engineered spec (Notion AI Meeting Notes → Groq)

Product truth extracted from Notion's official docs (notion.com/help/ai-meeting-notes)
and product page (notion.com/product/ai-meeting-notes), plus the established decisions
for this local build. Sources are listed at the bottom.

## 1. Observed Notion behavior (what we replicated)

| # | Notion behavior | Our implementation |
|---|---|---|
| 1 | Entry points: `/meet` in a page, sidebar **Meetings** tab, compose button, upload audio | Sidebar **Meetings** section with **+** button → modal; **Upload audio** tab; Home hero buttons |
| 2 | Consent: "confirm everyone has consented" before **Start transcribing** | Consent checkbox gates the Start button in the new-meeting modal; recording toast repeats it |
| 3 | Agenda/context notes written **before** the meeting are factored into the summary | Agenda textarea on the recording page; included in the summarization prompt |
| 4 | Live transcript streams in as the meeting happens; new line per utterance | Mic → fresh `MediaRecorder` per window (each a standalone valid WebM) → windows rotate **at natural speech pauses** (6 s floor, 18 s cap, 900 ms quiet detection) so words are never chopped mid-utterance; 64 kbps opus from the raw mic signal (echo cancellation off); Groq `whisper-large-v3` (`verbose_json`, measured 0% WER on a spoken fixture vs 3.8% for turbo) → lines append with timestamps; silence-only windows are discarded without a request; failed windows retry with backoff |
| 5 | In-meeting skills: **Catch me up**, **Suggest questions**, **Recap decisions** | Same three skills; LLM on the partial transcript, results in a popover |
| 6 | Stop requires ≥ ~1 minute (~300 transcribed characters) before summarizing | Same rule server-side (`too_short` error with Notion-style message) |
| 7 | Stop → auto-generates: title, summary (key points), **action items**, decisions, next steps | Groq Llama writes exactly that structure; parsed into Notion-style blocks: AI callout, to-do checkboxes (state persists), bullets |
| 8 | Summary items carry **citations** to transcript lines; click jumps to the line | `[n]` citations render as chips; click scrolls + flashes the transcript line and seeks the audio |
| 9 | Meeting notes auto-titled | First utterance becomes the live title; the AI title replaces it after summarizing |
| 10 | Uploaded audio (AAC, M4A, MP3, WAV) → same transcript + summary pipeline | Same via the Upload tab (also WebM/OGG); ≤25 MB (Groq limit); audio kept for playback |
| 11 | Language setting (17 Notion languages) | Same language list; passed to Whisper; auto-detect default |
| 12 | Notion workspace shell: sidebar, Search (⌘K), pages | Sidebar with Meetings/Notes sections, Ctrl/⌘+K palette searching titles/agenda/summaries, plain note pages |
| 13 | Ask AI about the meeting | Right-side chat panel grounded in the transcript + summary, with citations; history persisted |

## 2. Adapted honestly (documented differences)

- **Speaker labels**: Notion desktop diarizes speakers by capturing mic + system audio.
  A browser page only has the mic — no diarization. Transcript lines are timestamped,
  unlabeled. (Whisper itself infers "Speaker 1/2" text sometimes; we do not fake it.)
- **Engine**: Groq `whisper-large-v3-turbo` (transcription) + Llama 3.3 70B (notes/chat)
  instead of Notion's sub-processors. Free tier; your key stays on this machine.
- **Auto-join Zoom/Meet and calendar sync**: desktop-app-only Notion features; out of
  scope for a local web app.
- **Auto-stop when you leave the call**: Notion uses app presence signals; we require a
  manual Stop (Pause available).
- **Auto-stop / mobile capture**: skipped; noted as non-goals.
- **Branding**: visual language is Notion's; the product name is neutral ("Notetaker").

## 3. Decision register

| Decision | Status |
|---|---|
| Zero-dependency Node server + vanilla JS (same stack as the user's AEO Radar app) | LOCKED |
| Port 4174 (4173 is AEO Radar), bound to 127.0.0.1 only | LOCKED |
| Groq key stored in gitignored `data/db.json`; auto-imported from sibling AEO Radar config on first boot | APPROVED (user: "I will use my groq key") |
| Defaults: `whisper-large-v3-turbo`, `llama-3.3-70b-versatile`; selectable in Settings | ASSUMED |
| 429/5xx retry with backoff on all Groq calls | APPROVED (learned from AEO Radar free-tier 429s) |
| Transcript persisted incrementally during recording (crash-safe); interrupted-recording recovery notice on reload | ASSUMED |
| No speaker diarization (browser mic limitation), stated in UI copy | ASSUMED |
| Example meeting fixture (no API cost) for demo/review | ASSUMED |

## 4. Flows (actor: the single local user)

- **F1 Start meeting** — modal (consent → agenda → Start) → recording page (timer, waveform, live transcript, skills, pause/stop).
- **F2 Stop → summary** — ≥1 min rule → streaming generation with progressive render → ready note.
- **F3 Ready note** — summary callout, action-item to-dos (persisted toggles), decisions, next steps, citations, audio player, transcript toggle, Ask AI, regenerate.
- **F4 Upload audio** — file → stored → transcribed → summarized.
- **F5 Ask AI** — chat panel, streaming, persisted per note, citations.
- **F6 Skills** — Catch me up / Suggest questions / Recap decisions on partial transcript.
- **F7 Notes** — plain note pages (title + body, autosaved).
- **F8 Search** — Ctrl/⌘K palette over all notes.
- **F9 Settings** — Groq key (masked), models, language, appearance (light/dark/system).
- **F10 Destructive** — delete note (confirm dialog; removes audio too).

Failure states covered: no key (setup nudge + gates), mic denied (guidance notice),
transcription window failure (background retry queue, then skip with toast),
summarization failure (failed state with Try again), interrupted recording (recover/
summarize/delete), file too large, not enough speech.

## 5. Sources

- https://www.notion.com/help/ai-meeting-notes (fetched 2026-11-07)
- https://www.notion.com/product/ai-meeting-notes (fetched 2026-11-07)
