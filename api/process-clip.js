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

    // Group words into lines using pauses — this is the "chop into small
    // bits" step the game needs: short, individually-recordable segments.
    const PAUSE_THRESHOLD = 0.6;
    const lines = [];
    let current = [];
    for (const w of words) {
      if (current.length && w.start - current[current.length - 1].end > PAUSE_THRESHOLD) {
        lines.push(current);
        current = [];
      }
      current.push(w);
    }
    if (current.length) lines.push(current);

    const rawLines = lines.map((chunk) => ({
      text: chunk.map((w) => w.word).join(" ").trim(),
      startMs: Math.round(chunk[0].start * 1000),
      endMs: Math.round(chunk[chunk.length - 1].end * 1000),
    }));

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
