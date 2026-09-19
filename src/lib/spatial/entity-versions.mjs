/** Persistent-state observations, distinct from immutable message/event history.
 * A new arrival may observe a current public object, never its older versions.
 * Leaving retains the last observed payload, including after unseen edits/deletion.
 * Callers authorize the real domain mutation before writing a new version.
 */
export const ENTITY_SCOPE_SCHEMA = `
CREATE TABLE IF NOT EXISTS spatial_object_scopes (
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  scope_json TEXT NOT NULL,
  PRIMARY KEY(campaign_id,object_type,object_id)
);`;
const parse = raw => JSON.parse(raw);
const explicitUser = (scope, actor) => (scope.userIds ?? []).includes(actor.userId);
function currentAccess(scope, actor) {
  if (!actor.member) return false;
  if (actor.isDm && scope.dmCanRead !== false) return true;
  if (explicitUser(scope, actor)) return true;
  if (scope.restricted) return false;
  return scope.kind === 'global' || (scope.kind === 'room' && scope.roomId === actor.roomId);
}
export function createEntityVersions(db, { nextSeq }) {
  db.exec(ENTITY_SCOPE_SCHEMA);
  const one = (sql, ...params) => db.prepare(sql).get(...params);
  const latest = (campaignId, type, id) => one(`SELECT * FROM spatial_object_versions
    WHERE campaign_id=? AND object_type=? AND object_id=? ORDER BY version DESC LIMIT 1`, campaignId, type, id);
  function scopeFor(campaignId, type, id) {
    const row = one('SELECT scope_json FROM spatial_object_scopes WHERE campaign_id=? AND object_type=? AND object_id=?', campaignId, type, id);
    return row ? parse(row.scope_json) : null;
  }
  function observe(campaignId, type, id, actor, row) {
    db.prepare(`INSERT INTO spatial_object_receipts(campaign_id,user_id,object_type,object_id,version,observed_seq)
      VALUES(?,?,?,?,?,?) ON CONFLICT(campaign_id,user_id,object_type,object_id)
      DO UPDATE SET version=excluded.version,observed_seq=excluded.observed_seq`).run(campaignId, actor.userId, type, id, row.version, row.seq);
  }
  function validate(campaignId, scope, actors) {
    if (!scope || !['room', 'global', 'users'].includes(scope.kind)) throw new Error('Invalid object scope.');
    if (scope.kind === 'room' && !one('SELECT id FROM spatial_rooms WHERE campaign_id=? AND id=?', campaignId, scope.roomId)) throw new Error('Object location does not belong to this campaign.');
    if (scope.userIds !== undefined && (!Array.isArray(scope.userIds) || scope.userIds.some(id => !actors.some(actor => actor.member && actor.userId === id)))) throw new Error('Object recipient is not a campaign member.');
  }
  return {
    scope: scopeFor,
    latestPayload(campaignId, type, id) { const row = latest(campaignId, type, id); return row ? parse(row.payload_json) : null; },
    write(campaignId, type, id, payload, scope, actors) {
      validate(campaignId, scope, actors);
      if (typeof type !== 'string' || !type || typeof id !== 'string' || !id || payload === undefined) throw new Error('Invalid domain object.');
      const json = JSON.stringify(payload);
      if (json === undefined || Buffer.byteLength(json) > 2 * 1024 * 1024) throw new Error('Domain object exceeds the version budget.');
      return db.transaction(() => {
        const prior = latest(campaignId, type, id), version = (prior?.version ?? 0) + 1, seq = nextSeq(campaignId);
        db.prepare(`INSERT INTO spatial_object_versions(campaign_id,object_type,object_id,version,room_id,payload_json,seq)
          VALUES(?,?,?,?,?,?,?)`).run(campaignId, type, id, version, scope.kind === 'room' ? scope.roomId : null, json, seq);
        db.prepare(`INSERT INTO spatial_object_scopes(campaign_id,object_type,object_id,scope_json) VALUES(?,?,?,?)
          ON CONFLICT(campaign_id,object_type,object_id) DO UPDATE SET scope_json=excluded.scope_json`).run(campaignId, type, id, JSON.stringify(scope));
        for (const actor of actors) {
          if (!currentAccess(scope, actor)) continue;
          // A DM seat does not permanently grant itself all player history.
          if (actor.isDm && !explicitUser(scope, actor)) continue;
          observe(campaignId, type, id, actor, { version, seq });
        }
        return { version, seq };
      })();
    },
    read(campaignId, type, id, actor, { discover = true } = {}) {
      if (!actor?.member) throw new Error('Campaign access revoked.');
      const scope = scopeFor(campaignId, type, id);
      if (!scope) return null;
      if (currentAccess(scope, actor) && (actor.isDm || discover && scope.discover !== false)) {
        const row = latest(campaignId, type, id);
        if (!row) return null;
        if (!actor.isDm || explicitUser(scope, actor)) observe(campaignId, type, id, actor, row);
        return { payload: parse(row.payload_json), version: row.version, seq: row.seq, roomId: row.room_id };
      }
      const row = one(`SELECT v.* FROM spatial_object_receipts r JOIN spatial_object_versions v
        ON v.campaign_id=r.campaign_id AND v.object_type=r.object_type AND v.object_id=r.object_id AND v.version=r.version
        WHERE r.campaign_id=? AND r.user_id=? AND r.object_type=? AND r.object_id=?`, campaignId, actor.userId, type, id);
      return row ? { payload: parse(row.payload_json), version: row.version, seq: row.seq, roomId: row.room_id } : null;
    },
    list(campaignId, type, actor, options) {
      if (!actor?.member) throw new Error('Campaign access revoked.');
      // Candidate identifiers contain no prose; permission projection happens
      // before paging/sorting at the caller, including archived deleted objects.
      const ids = db.prepare('SELECT object_id FROM spatial_object_scopes WHERE campaign_id=? AND object_type=?').all(campaignId, type);
      return ids.map(row => this.read(campaignId, type, row.object_id, actor, options)).filter(Boolean);
    },
    audience(campaignId, type, id, actors) {
      const scope = scopeFor(campaignId, type, id);
      return scope ? actors.filter(actor => currentAccess(scope, actor)).map(actor => actor.userId) : [];
    },
  };
}
