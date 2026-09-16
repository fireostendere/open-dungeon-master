# Open Dungeon Master — Claude Code Guide

This workspace contains **Open Dungeon Master (ODM)**, a full-stack multiplayer virtual tabletop and rules engine for D&D 5e with AI Dungeon Master support.

## Key Information & Master Guide
For complete server credentials, architecture details, and D&D 5e Master protocols, always consult:
- **`AGENTS.md`** in the repository root.
- **`open-dungeon-master/.opencode/skills/odm-narrator/SKILL.md`** for external AI Master operations.

## Architecture
- **Web App**: Next.js 15, React 19, TypeScript, Tailwind CSS, SQLite with SQLCipher.
- **Production Server**: `root@api.iroslyakov.com` (`/opt/odm`).
- **MCP Server**: `open-dungeon-master/mcp/server.mjs` (listening on port 3006 or `--stdio`).
- **Internal API**: `http://127.0.0.1:3005/api/internal/mcp` (Bearer token in `/opt/odm/config/mcp.token`).

## Build & Test Commands
Run all commands inside `open-dungeon-master/`:
```bash
# Type check
npm run typecheck   # or npx tsc --noEmit

# Run unit and contract tests
npm test            # or node scripts/test-mcp-tools-contract.mjs
node scripts/test-mcp-narrator-control.mjs

# Development server
npm run dev
```

## Running as Dungeon Master via MCP
1. Connect to campaign: `narrator.connect` (or `odm_narrator(operation: "connect")`).
2. Read game stream: `narrator.read` (gives `currentSeq`, messages, sheets, pending rolls, asks).
3. **NEVER invent dice rolls in text!** Call `narrator.invoke` with `name: "request_roll"` — the server rules engine rolls authentic random d20 with character sheet modifiers.
4. Combat: Call `start_encounter`, move tokens with `move_token`, attack with `pc_attack` (`enemyId` and `targetEnemyId`), apply damage with `damage_enemy`.
5. Answer Ask Panel: Call `narrator.answer_ask` with `{ askId, answer }`.
6. Live reactive loop: Run `/opt/odm/tools/watch-player.sh <LATEST_SEQ>` in the background to listen for player turns.
