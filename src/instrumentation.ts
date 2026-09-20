// Next's standalone startup hook. Importing the deterministic job runner
// only in Node keeps SQLite out of the edge bundle.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startJobRunner } = await import("@/lib/jobs");
    startJobRunner();
  }
}
