# Open Dungeon Master — Claude Code guide

Read `AGENTS.md` in this repository root. Code paths start here: `src/`, `mcp/`,
`scripts/`, `deploy/` and `.opencode/skills/`. Exact dependency versions and scripts
are defined by `package.json` and the lockfiles, not a fixed framework version in
a guide. No SSH password, bearer or API key belongs in this file.

For external narration use `.opencode/skills/odm-narrator/SKILL.md` and
`odm://narrator/playbook`. Connect, read until `hasMore:false`, inspect the current
catalog, invoke real engine actions, reread and narrate actual outcomes. Players
own their decisions and the server owns dice and state. Do not automatically
retry writes after 409/timeouts, duplicate damage, or force movement to bypass rules.

Ask replies use `narrator.answer_ask` with `campaignId`, `askId`, `answer` and
optional citations. Read asks even when the story cursor is unchanged. Private
questions/answers must not appear in table events or public narration. A skill
alone cannot maintain an asynchronous game loop or wake an agent.

```sh
npx --no-install tsc --noEmit
npm test
npm run build
node scripts/test-mcp-tools-contract.mjs
node scripts/test-mcp-narrator-control.mjs
node --experimental-vm-modules --test scripts/test-merge-*.mjs
```

Run only with the required dependencies and report what actually executed. The
scoped merge tests do not replace browser/SDK/deployment acceptance. See
`docs/merge-2026-09-17.md` and `docs/review-2026-09-16-status.md`.
A request to merge code is not permission to deploy, access production or restore
its database. Use the installation's coordinated controller only when authorized.
