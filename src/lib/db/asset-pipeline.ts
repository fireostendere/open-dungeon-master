// Public submission boundary: the existing pipeline owns validation, worker
// leases, duplicate detection and the SQL transaction. Storage keeps staging
// available until that transaction has committed successfully.
export * from "@/lib/db/asset-pipeline-store";
import { submitResult as submitStoredResult } from "@/lib/db/asset-pipeline-store";
import { getDatabase } from "@/lib/db/core";
import { afterCommit } from "@/lib/db/commit-effects";
import { assetStorage } from "@/lib/assets/storage";

export function submitResult(input: Parameters<typeof submitStoredResult>[0]): ReturnType<typeof submitStoredResult> {
  // Schema initialization stays with the store. Before the very first grant
  // exists there is nothing to clean; submitStoredResult reports the error.
  const db = getDatabase();
  const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='asset_access_grants'").get();
  const grant = table ? db.prepare("SELECT staging_key FROM asset_access_grants WHERE id=? AND job_id=? AND operation='upload'")
    .get(input.uploadId, input.jobId) as { staging_key: string | null } | undefined : undefined;
  const result = submitStoredResult(input);
  if (grant?.staging_key) afterCommit(() => {
    // Cleanup is optional after success, never a reason to turn a committed
    // submission into a client-visible failure or destroy a retryable upload.
    const current = db.prepare("SELECT status FROM asset_access_grants WHERE id=? AND job_id=?")
      .get(input.uploadId, input.jobId) as { status: string } | undefined;
    if (current?.status === "consumed") assetStorage().delete(grant.staging_key!);
  });
  return result;
}
