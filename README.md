# DubRoom — static + serverless (docket-style)

Same shape as The Docket: one `index.html` (all views toggled via JS, no
build step) plus a few plain serverless functions in `api/`, deployed
straight from GitHub to Vercel's free tier.

## Files
- `index.html` — the whole app: landing, login/signup, browse, upload,
  lobby (character claim, live sync, recording, playback).
- `api/config.js` — hands the browser your Supabase URL + anon key.
- `api/process-clip.js` — after upload, runs Groq Whisper (chop into
  timed lines) + Llama Guard (NSFW/18+ check) on the clip, publishes or
  blocks it.
- `api/mix.js` — stub. Explains why mixing needs an external worker
  (ffmpeg + real compute don't fit serverless limits) — same limitation
  as before, not yet solved here either.
- `supabase-schema.sql` — run this once in the Supabase SQL editor.

## Setup

1. **Supabase**: new project → SQL editor → run `supabase-schema.sql` →
   Storage → create buckets `clips` (public), `recordings` (private),
   `mixes` (public). Under each bucket's policies, allow authenticated
   users to `insert` into their own folder (`auth.uid()` prefix) and
   allow public `select` on `clips`/`mixes`.
2. **Groq**: get an API key from console.groq.com.
3. **Vercel env vars** (Project Settings → Environment Variables):
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `GROQ_API_KEY`
4. Push to GitHub, import into Vercel, deploy. No build command needed —
   it's static files + functions.

## What's different from the Next.js version

- No queue/worker for clip processing — the browser calls
  `/api/process-clip` directly right after upload finishes. Simpler, but
  means the uploader's tab has to stay open until it's done (transcription
  usually takes a few seconds for a short clip). If uploads get heavy,
  this is the first thing to move to a real queue.
- Upstash isn't wired in yet. It's not required for anything to work, but
  if you want upload rate-limiting or a "trending clips" feed later, that's
  a small addition following the same pattern as `api/process-clip.js`
  (plain `fetch` calls to Upstash's REST API, no SDK needed).
- Character assignment (which character said which line) still isn't
  built — Whisper transcribes and chops lines but doesn't know who's
  speaking. `clip_lines.character_id` stays `null` until that UI exists.

## Known gaps (same as before, still true)
- **Mixing**: `api/mix.js` is a stub — wire up an external ffmpeg worker
  (Railway/Fly/Render) or a hosted API (Shotstack) to actually produce the
  final mixed video.
- **Copyright**: this scaffold assumes you'll add a real ownership
  attestation + takedown flow before any public launch. Not legal advice.
