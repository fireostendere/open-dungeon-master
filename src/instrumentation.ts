// Next's standalone startup hook. Both runners are process-global/idempotent;
// importing them only in Node keeps SQLite out of the edge bundle.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startJobRunner } = await import("@/lib/jobs");
    startJobRunner();
    const { startDmMediaRunner } = await import("@/lib/dm/media-jobs");
    startDmMediaRunner();
  }
}
