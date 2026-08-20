// NOT IMPLEMENTED. Choicer Voicer lets you export the finished dub as a
// downloadable MP4 — right now this app only plays the dub back live in
// the browser (muted original video + your recordings scheduled to their
// line timestamps, see watchFinishedDub() in index.html). That in-browser
// playback needs no server work at all.
//
// A real "download as MP4" button needs actual muxing: burn each
// recording into the video's audio track at the right timestamp and
// produce one file. Same constraint as before — ffmpeg + real compute,
// which doesn't fit a Vercel serverless function well. Options if you
// want this later:
//   1. A small always-on worker (Railway/Fly/Render) running ffmpeg.
//   2. Do it client-side with ffmpeg.wasm — slower and heavier on the
//      user's device, but needs no server at all.
export default async function handler(req, res) {
  return res.status(501).json({
    error: "Export not implemented yet. See comments in api/export.js.",
  });
}
