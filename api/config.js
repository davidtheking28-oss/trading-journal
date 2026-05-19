export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-store');
  const url = process.env.SUPABASE_URL || '';
  const anon = process.env.SUPABASE_ANON_KEY || process.env.TJ_ANON_KEY || '';
  res.send(`window.__SB_URL='${url}';window.__SB_ANON='${anon}';`);
}
