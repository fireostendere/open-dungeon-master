// The domain ledger uses the existing spatial object tables. Its envelope is
// server-only; player responses contain data and observed-version metadata,
// never the disclosure list. No client-supplied role or member list is trusted.
export const DOMAIN_FORMAT = 'odm.domain.v1';
export const DOMAIN_TYPES = Object.freeze(['note', 'fact', 'chapter']);
export class DomainError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'DomainError'; this.status = status; }
}
const json = value => JSON.stringify(value);
const clone = value => JSON.parse(json(value));
const identifier = value => {
  if (typeof value !== 'string' || !value || value.length > 200) throw new DomainError('Invalid entity ID.');
  return value;
};
const typeKey = type => {
  if (!DOMAIN_TYPES.includes(type)) throw new DomainError('Unknown entity type.');
  return `domain:${type}`;
};

/** All callbacks resolve authoritative, current server state synchronously. */
export function createDomainStore(db, { nextSeq, actorFor }) {
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  function actor(campaignId, userId, requireDm = false) {
    const current = actorFor(campaignId, userId);
    if (!current || !current.memberIds.includes(userId)) throw new DomainError('Campaign not found.', 404);
    if (requireDm && !current.isDm) throw new DomainError('Only the Dungeon Master can publish this entity.', 403);
    return current;
  }
  function latest(campaignId, type, id) {
    return one(`SELECT * FROM spatial_object_versions WHERE campaign_id=? AND object_type=? AND object_id=?
      ORDER BY version DESC LIMIT 1`, campaignId, typeKey(type), identifier(id));
  }
  function envelope(row) {
    const value = JSON.parse(row.payload_json);
    if (value?.format !== DOMAIN_FORMAT || !value.scope || !Object.hasOwn(value, 'data')) {
      throw new DomainError('Invalid domain ledger record.', 500);
    }
    return value;
  }
  function scopeFor(current, scope) {
    if (!scope || typeof scope !== 'object' || Array.isArray(scope)) throw new DomainError('Explicit disclosure scope is required.');
    if (scope.kind === 'global' || scope.kind === 'dm') return { kind: scope.kind };
    if (scope.kind === 'room') {
      const roomId = identifier(scope.roomId);
      if (!one('SELECT 1 FROM spatial_rooms WHERE campaign_id=? AND id=?', current.campaignId, roomId)) {
        throw new DomainError('Location not found.', 404);
      }
      return { kind: 'room', roomId };
    }
    if (scope.kind === 'users') {
      if (!Array.isArray(scope.userIds) || scope.userIds.length > 20 ||
          scope.userIds.some(id => typeof id !== 'string' || !current.playerIds.includes(id))) {
        throw new DomainError('Invalid disclosure recipients.');
      }
      return { kind: 'users', userIds: [...new Set(scope.userIds)].sort() };
    }
    throw new DomainError('Invalid disclosure scope.');
  }
  function canObserve(current, value, userId) {
    if (value.ownerUserId === userId) return true;
    if (value.allowedUserIds !== null && !value.allowedUserIds.includes(userId)) return false;
    switch (value.scope.kind) {
      case 'global': return true;
      case 'users': return value.scope.userIds.includes(userId);
      case 'room': return Boolean(one('SELECT 1 FROM spatial_presence WHERE campaign_id=? AND user_id=? AND room_id=?',
        current.campaignId, userId, value.scope.roomId));
      default: return false;
    }
  }
  function receive(current, type, id, row, userId) {
    // Reading/observing does not advance the story CAS cursor. The referenced
    // version's publication sequence is its provenance; reconnect cannot grant
    // an intermediate version that the viewer never witnessed.
    run(`INSERT INTO spatial_object_receipts(campaign_id,user_id,object_type,object_id,version,observed_seq)
      VALUES(?,?,?,?,?,?) ON CONFLICT(campaign_id,user_id,object_type,object_id)
      DO UPDATE SET version=excluded.version,observed_seq=excluded.observed_seq
      WHERE spatial_object_receipts.version<>excluded.version`,
    current.campaignId, userId, typeKey(type), id, row.version, row.seq);
  }
  function project(row) {
    const value = envelope(row);
    return { id: row.object_id, version: row.version, seq: row.seq,
      roomId: row.room_id, deleted: value.deleted === true, data: clone(value.data) };
  }
  function readInternal(current, type, id, observe) {
    const head = latest(current.campaignId, type, id);
    if (!head) return null;
    if (current.isDm) return envelope(head).dmVisible !== false || envelope(head).ownerUserId === current.userId ? project(head) : null;
    if (observe && canObserve(current, envelope(head), current.userId)) receive(current, type, id, head, current.userId);
    const row = one(`SELECT v.* FROM spatial_object_receipts r JOIN spatial_object_versions v
      ON v.campaign_id=r.campaign_id AND v.object_type=r.object_type AND v.object_id=r.object_id AND v.version=r.version
      WHERE r.campaign_id=? AND r.user_id=? AND r.object_type=? AND r.object_id=?`,
    current.campaignId, current.userId, typeKey(type), id);
    return row ? project(row) : null;
  }
  return {
    has(campaignId, type, id) { return Boolean(latest(campaignId, type, id)); },
    metadata(campaignId, dmUserId, type, id) {
      actor(campaignId, dmUserId, true);
      const row = latest(campaignId, type, id);
      return row && (envelope(row).dmVisible !== false || envelope(row).ownerUserId === dmUserId)
        ? { ...project(row), ...envelope(row) } : null;
    },
    publish(campaignId, dmUserId, type, id, data, options = {}) {
      const current = actor(campaignId, dmUserId, true);
      typeKey(type); identifier(id);
      return db.transaction(() => {
        const previous = latest(campaignId, type, id);
        const old = previous ? envelope(previous) : null;
        if (options.expectedVersion !== undefined && options.expectedVersion !== (previous?.version ?? 0)) {
          throw new DomainError('Entity version changed. Read it again before editing.', 409);
        }
        const scope = scopeFor(current, options.scope ?? old?.scope);
        const ownerUserId = options.ownerUserId !== undefined ? options.ownerUserId : old?.ownerUserId ?? null;
        if (ownerUserId !== null && !current.memberIds.includes(ownerUserId)) throw new DomainError('Entity owner not found.', 404);
        let allowedUserIds = options.allowedUserIds !== undefined ? options.allowedUserIds : old?.allowedUserIds ?? null;
        if (allowedUserIds !== null) {
          if (!Array.isArray(allowedUserIds) || allowedUserIds.length > 20 ||
              allowedUserIds.some(id => typeof id !== 'string')) throw new DomainError('Invalid entity access list.');
          // Removed accounts must not turn a once-valid record into an error
          // on the next edit. Rejoining never bypasses the current scope.
          allowedUserIds = [...new Set(allowedUserIds.filter(id => current.playerIds.includes(id)))].sort();
        }
        const dmVisible = options.dmVisible !== undefined ? options.dmVisible === true : old?.dmVisible !== false;
        const value = { format: DOMAIN_FORMAT, scope, ownerUserId, allowedUserIds, dmVisible,
          deleted: options.deleted === true, data: clone(data) };
        const encoded = json(value);
        if (Buffer.byteLength(encoded, 'utf8') > 128 * 1024) throw new DomainError('Entity exceeds the publication budget.', 413);
        if (previous?.payload_json === encoded) return project(previous);
        const version = (previous?.version ?? 0) + 1;
        const seq = nextSeq(campaignId);
        const roomId = scope.kind === 'room' ? scope.roomId : null;
        run(`INSERT INTO spatial_object_versions(campaign_id,object_type,object_id,version,room_id,payload_json,seq)
          VALUES(?,?,?,?,?,?,?)`, campaignId, typeKey(type), id, version, roomId, encoded, seq);
        const row = { object_id: id, version, seq, room_id: roomId, payload_json: encoded };
        // Audience is fixed at publication. New arrivals may observe the
        // current version later, but never acquire past conversations/edits.
        for (const userId of current.playerIds) if (canObserve(current, value, userId)) receive(current, type, id, row, userId);
        return project(row);
      })();
    },
    read(campaignId, userId, type, id, { observe = true } = {}) {
      const current = actor(campaignId, userId);
      return db.transaction(() => readInternal(current, type, identifier(id), observe))();
    },
    list(campaignId, userId, type, { query = '', roomId, limit = 200 } = {}) {
      const current = actor(campaignId, userId);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000 || typeof query !== 'string' || query.length > 300) {
        throw new DomainError('Invalid entity query.');
      }
      return db.transaction(() => {
        const keys = all(`SELECT object_id,MAX(seq) AS position FROM spatial_object_versions
          WHERE campaign_id=? AND object_type=? GROUP BY object_id ORDER BY position DESC,object_id`, campaignId, typeKey(type));
        const result = [];
        // Search AFTER projection: current/hidden text must never influence
        // a player's search hit, excerpt, total count, or returned version.
        const needle = query.toLocaleLowerCase();
        for (const key of keys) {
          const visible = readInternal(current, type, key.object_id, true);
          if (!visible || visible.deleted || (roomId !== undefined && visible.roomId !== roomId)) continue;
          if (needle && !json(visible.data).toLocaleLowerCase().includes(needle)) continue;
          result.push(visible);
        }
        // Sorting by the witnessed sequence, not the secret latest sequence,
        // also prevents an off-screen edit from reordering the visible list.
        return result.sort((a, b) => b.seq - a.seq || a.id.localeCompare(b.id)).slice(0, limit);
      })();
    },
    observe(campaignId, dmUserId, type, id, userIds, expectedVersion) {
      const current = actor(campaignId, dmUserId, true);
      return db.transaction(() => {
        const row = latest(campaignId, type, id);
        if (!row) throw new DomainError('Entity not found.', 404);
        if (envelope(row).dmVisible === false && envelope(row).ownerUserId !== dmUserId) throw new DomainError('Entity not found.', 404);
        if (row.version !== expectedVersion) throw new DomainError('Entity version changed.', 409);
        if (!Array.isArray(userIds) || userIds.length < 1 || userIds.length > 20 || userIds.some(id => !current.playerIds.includes(id))) {
          throw new DomainError('Invalid observation recipients.');
        }
        // Explicit DM disclosure is deliberate and version-pinned. It never
        // grants room history or silently follows subsequent entity updates.
        for (const userId of new Set(userIds)) receive(current, type, id, row, userId);
        return { id, version: row.version };
      })();
    },
  };
}
