// Keep the established audit/snapshot formats while sharing one conflict type
// with the mandatory library-copy baseline guard.
export * from "@/lib/db/progress-sync-store";
export { ProgressConflictError } from "@/lib/db/progress-baseline";
import {
  syncCharacterProgress as syncStoredCharacterProgress,
  ProgressConflictError as AuditConflictError,
} from "@/lib/db/progress-sync-store";
import { ProgressConflictError } from "@/lib/db/progress-baseline";

export function syncCharacterProgress(sheetId: string, expectedVersion?: number): ReturnType<typeof syncStoredCharacterProgress> {
  try {
    return syncStoredCharacterProgress(sheetId, expectedVersion);
  } catch (error) {
    if (error instanceof AuditConflictError) throw new ProgressConflictError(error.message);
    throw error;
  }
}
