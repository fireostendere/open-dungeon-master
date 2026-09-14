import { getDatabase } from '@/lib/db/core';
import { ensureAssetPipelineSchema } from '@/lib/db/asset-pipeline';
import { ensureProgressSchema } from '@/lib/db/progress-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Database-aware readiness, deliberately independent of paid/cloud LLM services.
// Managed Docker/local installations probe this route before declaring the app
// ready, so additive feature schemas are upgraded here as part of normal startup
// rather than requiring an operator to run SQL by hand. The helpers are fully
// idempotent and are also called defensively by their domain services.
export async function GET() {
  try {
    const db = getDatabase();
    ensureAssetPipelineSchema();
    ensureProgressSchema();
    db.prepare('SELECT count(*) AS n FROM sqlite_master').get();
    db.prepare('SELECT id FROM users LIMIT 1').get();
    db.prepare('SELECT id FROM asset_packs LIMIT 1').get();
    db.prepare('SELECT library_character_id FROM character_progress_state LIMIT 1').get();
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
