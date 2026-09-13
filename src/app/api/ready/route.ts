import { getDatabase } from '@/lib/db/core';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Database-aware readiness, deliberately independent of paid/cloud LLM services.
// The public response has no account, campaign, model or secret information.
export async function GET() {
  try {
    const db = getDatabase();
    db.prepare('SELECT count(*) AS n FROM sqlite_master').get();
    db.prepare('SELECT id FROM users LIMIT 1').get();
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
