import { SPATIAL_SCHEMA } from "./store.mjs";
// Parent-before-child insertion order; reverse it when replacing a timeline.
export const SPATIAL_TABLES = Object.freeze([
  "spatial_campaigns", "spatial_rooms", "spatial_links", "spatial_presence", "spatial_visits",
  "spatial_messages", "spatial_receipts", "spatial_observers", "spatial_requests",
  "spatial_object_versions", "spatial_object_receipts",
]);
export function captureSpatialSnapshot(db, campaignId) {
  db.exec(SPATIAL_SCHEMA);
  return Object.fromEntries(SPATIAL_TABLES.map(table => [table,
    db.prepare(`SELECT * FROM ${table} WHERE campaign_id=?`).all(campaignId)]));
}
// Called inside the existing chapter-rewind transaction. Old snapshots have
// no spatial rows, so rewinding before enablement safely disables the mode.
export function restoreSpatialSnapshot(db, campaignId, tables) {
  db.exec(SPATIAL_SCHEMA);
  for (const table of [...SPATIAL_TABLES].reverse()) db.prepare(`DELETE FROM ${table} WHERE campaign_id=?`).run(campaignId);
  const userExists = id => Boolean(db.prepare("SELECT 1 FROM users WHERE id=?").get(id));
  for (const table of SPATIAL_TABLES) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name);
    const insert = db.prepare(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`);
    for (const value of tables?.[table] ?? []) {
      if (!value || value.campaign_id !== campaignId) throw new Error("Spatial snapshot belongs to another campaign.");
      const row = { ...value };
      if ((row.user_id && !userExists(row.user_id)) || (row.actor_id && !userExists(row.actor_id))) continue;
      if (row.author_user_id && !userExists(row.author_user_id)) row.author_user_id = null;
      insert.run(...columns.map(column => row[column] ?? null));
    }
  }
}
