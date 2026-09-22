# Main integration, 2026-09-22

All local and origin branch tips were checked with `git merge-base --is-ancestor`
against the integration candidate (17 refs, including main, astra and integration).
The third-party `upstream` remote is not this fork's release queue.

- `astra` supplies project MCP setup, accurate operation guidance and measured native turns.
- `astra-mcp-v4-followup-rebased` supplies sticky referee sessions and packet deltas,
  plus host-only read-only rules retrieval. The original followup history is also
  merged; newer exception handling, precise entity keys and asynchronous optional
  warmup are retained.
- `fix/lead-start-global-round` supersedes `feature/manual-global-turn-finish`:
  the lead can recover an input window without force-finishing a resolving round.
- `repair/mcp-autopilot` and `repair/mcp-autopilot-v2` are superseded by the final
  implementation already on main. Consent enforcement, synchronous spatial seal,
  bounded actor latency and the no-provider-call tests remain intact.
- The historical local `dnd-edition` runtime is superseded by the current role
  packet, scheduler, scoped narration and usage pipeline, with DnD model routing
  owned by custom OpenCode. Merging its history does not restore the old fixed
  Sol-medium pipeline, per-step waits or obsolete quorum writes. Its skip-message
  localization was already present as an equivalent patch.

Two followup test fixtures were updated for the current canonical packet contract:
`currentHp`, comparison after normal packet projection, realistic unchanged prefix
size for beneficial deltas, and an explicit bounded read retry count. No production
read validation or delta size threshold was weakened to make tests pass.

Sticky sessions are scoped to the immediate resolution of one input; they close
on completion, pause, failure or timeline change. Private Ask and actor sessions
remain separate. This improves reuse within an action and is not a promise of
cross-player-turn cache reuse or a newly measured production speedup.
