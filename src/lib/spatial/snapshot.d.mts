import type { SqliteDatabase } from "../db/driver";
export const SPATIAL_TABLES: readonly string[];
export function captureSpatialSnapshot(db: SqliteDatabase, campaignId: string): Record<string, Record<string, unknown>[]>;
export function restoreSpatialSnapshot(db: SqliteDatabase, campaignId: string, tables: Record<string, unknown> | undefined): void;
