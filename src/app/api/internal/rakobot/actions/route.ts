import { getDatabase } from '@/lib/db/core';
import { projectQueuedAction } from '@/lib/integrations/rakobot';
import { authorizedFeed, createActionOutbox, feedConfig, FeedConflict } from '@/lib/integrations/rakobot-outbox.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Authorization' };

// A separate, read-only, campaign-allowlisted capability. It is NOT the MCP
// control token. The bot calls this over loopback; block it at public ingress.
export async function GET(request: Request) {
  let config: ReturnType<typeof feedConfig>;
  try { config = feedConfig(); } catch {
    return Response.json({ error: 'Notification feed is not configured.' }, { status: 503, headers });
  }
  if (!config) return Response.json({ error: 'Not found.' }, { status: 404, headers });
  if (!authorizedFeed(request.headers.get('authorization'), config.token)) {
    return Response.json({ error: 'Unauthorized.' }, { status: 401, headers });
  }
  const params = new URL(request.url).searchParams;
  const known = ['stream', 'after', 'anchor'];
  if ([...params.keys()].some(key => !known.includes(key) || params.getAll(key).length !== 1)) {
    return Response.json({ error: 'Invalid cursor.' }, { status: 400, headers });
  }
  try {
    const db = getDatabase(), outbox = createActionOutbox(db);
    // One synchronous SQLite snapshot; no await can interleave publication or
    // deletion with cursor validation and privacy projection.
    const body = db.transaction(() => {
      if (params.size === 0) return outbox.head();
      const raw = params.get('after') ?? '';
      if (params.size !== 3 || !/^(0|[1-9][0-9]{0,15})$/.test(raw)) throw new FeedConflict('Invalid cursor.');
      return outbox.page({ stream: params.get('stream')!, id: Number(raw), anchor: params.get('anchor')! },
        row => projectQueuedAction(row, config!.campaigns));
    })();
    return Response.json(body, { headers });
  } catch (error) {
    if (error instanceof FeedConflict) return Response.json({ error: 'Feed changed; rebind notification topic.' }, { status: 409, headers });
    // Do not log quotes, authorization headers, SQL parameters or tokens.
    console.error('[rakobot-feed] Read failed:', error instanceof Error ? error.name : 'UnknownError');
    return Response.json({ error: 'Notification feed unavailable.' }, { status: 503, headers });
  }
}
