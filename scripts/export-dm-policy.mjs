#!/usr/bin/env node
// Print the tracked policy for a trusted host configuration; never read game text.
import { DM_POLICY_TEXT } from '../mcp/dm-policy.mjs';
process.stdout.write(DM_POLICY_TEXT);
