// Vercel serverless function — NOT IMPLEMENTED. Mixing needs ffmpeg and
// real compute time, which doesn't fit a serverless function's limits.
//
// Recommended: a small always-on worker (Railway/Fly.io/Render) that:
//   1. downloads the source clip + all recordings for this lobby from
//      Supabase Storage
//   2. for each clip_line, overlays the matching recording's audio at
//      line.start_ms, replacing the original character's audio there
//   3. re-muxes with ffmpeg and uploads the result to the `mixes` bucket
//   4. inserts a `mixes` row, then broadcasts "mix_ready" on the lobby's
//      Supabase Realtime channel so every client starts playback together
//
// This endpoint exists so the frontend has a stable place to call once
// that worker is wired up — right now it just explains what's missing.
export default async function handler(req, res) {
  return res.status(501).json({
    error:
      "Mixing not implemented yet. See comments in api/mix.js for the recommended approach (external ffmpeg worker).",
  });
}
