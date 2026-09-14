import { register } from "node:module";

register("../lib/register-alias.mjs", import.meta.url);

const { claimJob } = await import("../../src/lib/db/asset-pipeline.ts");
const jobId = process.env.ODM_TEST_JOB_ID;
const workerId = process.env.ODM_TEST_WORKER_ID;
if (!jobId || !workerId) process.exit(2);

try {
  const job = claimJob(jobId, workerId, 120);
  console.log(JSON.stringify({ ok: true, workerId, claimedBy: job.claimedBy }));
  globalThis.__localRoleplayDb?.close();
  globalThis.__localRoleplayDb = undefined;
  process.exit(0);
} catch (error) {
  console.log(JSON.stringify({ ok: false, workerId, error: error instanceof Error ? error.message : String(error) }));
  globalThis.__localRoleplayDb?.close();
  globalThis.__localRoleplayDb = undefined;
  process.exit(3);
}
