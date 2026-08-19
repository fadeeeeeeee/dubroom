// Vercel serverless function — mirrors docket's api/config.js.
// Anon key is safe to expose (RLS protects the data); URL and anon key
// live as Vercel env vars so they're not hardcoded in index.html.
export default function handler(req, res) {
  res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  });
}
