export * from '@/lib/db/snapshots-store';
import * as raw from '@/lib/db/snapshots-store';
import { restoreCanonicalDomainRows } from '@/lib/spatial/domain-restore';
// The caller already owns the rewind transaction. Restore canonical edited
// or deleted note/chapter rows from the restored observed-version ledger too.
export function restoreSnapshot(...args: Parameters<typeof raw.restoreSnapshot>) {
  raw.restoreSnapshot(...args);
  restoreCanonicalDomainRows(args[0]);
}
