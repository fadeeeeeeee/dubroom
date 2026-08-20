// Vercel serverless function — plain fetch calls to Supabase REST/Storage
// and Groq, no SDKs, no build step. Called by the browser right after an
// upload finishes.
//
// Env vars needed: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GROQ_API_KEY

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GROQ_KEY = process.env.GROQ_API_KEY;

function sbHeaders() {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
}

// Cuts the transcript into recordable lines. Two passes:
//   1. Never cross a Whisper SEGMENT boundary — segments come from the
//      model's own linguistic + silence detection (roughly one sentence
//      or clause each), which is a much better "natural line" signal
//      than raw word-to-word gaps.
//   2. Within a segment, still split further on: an internal pause above
//      MIN_PAUSE, or hitting MAX_LINE_MS — so one long unbroken sentence
//      still gets cut into short, recordable bits instead of becoming
//      one huge line.
// Falls back to pure pause-based grouping if Groq doesn't return segments.
function chopIntoLines(words, segments) {
  const MIN_PAUSE = 0.35; // seconds — was 0.6, now catches more natural breaks
  const MAX_LINE_MS = 6000; // force a split if a segment runs longer than this

  function splitWordsFurther(chunk) {
    const out = [];
    let current = [];
    let started = current.length ? current[0].start : null;
    for (const w of chunk) {
      const wouldExceed = current.length && (w.end - current[0].start) * 1000 > MAX_LINE_MS;
      const bigPause = current.length && w.start - current[current.length - 1].end > MIN_PAUSE;
      if (current.length && (wouldExceed || bigPause)) {
        out.push(current);
        current = [];
      }
      current.push(w);
    }
    if (current.length) out.push(current);
    return out;
  }

  function toLine(chunk) {
    return {
      text: chunk.map((w) => w.word).join(" ").trim(),
      startMs: Math.round(chunk[0].start * 1000),
      endMs: Math.round(chunk[chunk.length - 1].end * 1000),
    };
  }

  let chunks;
  if (segments.length && words.length) {
    chunks = [];
    for (const seg of segments) {
      const segWords = words.filter((w) => w.start >= seg.start - 0.05 && w.end <= seg.end + 0.05);
      if (segWords.length) {
        chunks.push(...splitWordsFurther(segWords));
      } else {
        // no word-level data landed in this segment — fall back to segment text as-is
        chunks.push([{ word: seg.text.trim(), start: seg.start, end: seg.end }]);
      }
    }
  } else {
    chunks = splitWordsFurther(words);
  }

  const lines = chunks.map(toLine).filter((l) => l.text.length > 0);

  // Merge stray sub-300ms fragments (e.g. a lone "uh") into the previous line
  const merged = [];
  for (const line of lines) {
    const prev = merged[merged.length - 1];
    if (prev && line.endMs - line.startMs < 300) {
      prev.text = (prev.text + " " + line.text).trim();
      prev.endMs = line.endMs;
    } else {
      merged.push(line);
    }
  }
  return merged;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const { clipId } = req.body || {};
  if (!clipId) return res.status(400).json({ error: "clipId required" });

  try {
    const clipRes = await fetch(
      `${SUPABASE_URL}/rest/v1/clips?id=eq.${clipId}&select=*`,
      { headers: sbHeaders() }
    );
    const [clip] = await clipRes.json();
    if (!clip) return res.status(404).json({ error: "clip not found" });

    const fileRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/clips/${clip.video_path}`,
      { headers: sbHeaders() }
    );
    if (!fileRes.ok) throw new Error("could not download clip from storage");
    const fileBuffer = await fileRes.arrayBuffer();

    // Transcribe with word-level timestamps via Groq Whisper
    const form = new FormData();
    form.append("file", new Blob([fileBuffer]), "clip.mp4");
    form.append("model", "whisper-large-v3");
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");

    const whisperRes = await fetch(
      "https://api.groq.com/openai/v1/audio/transcriptions",
      { method: "POST", headers: { Authorization: `Bearer ${GROQ_KEY}` }, body: form }
    );
    if (!whisperRes.ok) throw new Error(`Groq transcription failed: ${await whisperRes.text()}`);
    const whisperData = await whisperRes.json();
    const words = whisperData.words || [];
    const segments = whisperData.segments || [];

    const rawLines = chopIntoLines(words, segments);

    // Moderate the full transcript with Llama Guard
    const fullText = rawLines.map((l) => l.text).join(" ");
    const guardRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama-guard-3-8b",
        messages: [{ role: "user", content: fullText }],
      }),
    });
    const guardData = await guardRes.json();
    const verdict = guardData.choices?.[0]?.message?.content?.trim() || "";
    const blocked = verdict.toLowerCase().startsWith("unsafe");

    if (blocked) {
      await fetch(`${SUPABASE_URL}/rest/v1/clips?id=eq.${clipId}`, {
        method: "PATCH", headers: sbHeaders(),
        body: JSON.stringify({ status: "blocked", moderation_reason: verdict }),
      });
      return res.status(200).json({ status: "blocked", reason: verdict });
    }

    // No character_id in solo mode — one player voices every line.
    const lineRows = rawLines.map((l, i) => ({
      clip_id: clipId,
      line_index: i,
      start_ms: l.startMs,
      end_ms: l.endMs,
      transcript: l.text,
      order_in_clip: i,
    }));
    if (lineRows.length) {
      await fetch(`${SUPABASE_URL}/rest/v1/clip_lines`, {
        method: "POST", headers: { ...sbHeaders(), Prefer: "return=minimal" },
        body: JSON.stringify(lineRows),
      });
    }

    await fetch(`${SUPABASE_URL}/rest/v1/clips?id=eq.${clipId}`, {
      method: "PATCH", headers: sbHeaders(),
      body: JSON.stringify({ status: "published" }),
    });

    return res.status(200).json({ status: "published", lineCount: lineRows.length });
  } catch (err) {
    await fetch(`${SUPABASE_URL}/rest/v1/clips?id=eq.${clipId}`, {
      method: "PATCH", headers: sbHeaders(),
      body: JSON.stringify({ status: "failed", moderation_reason: String(err.message) }),
    }).catch(() => {});
    return res.status(500).json({ error: err.message });
  }
}
