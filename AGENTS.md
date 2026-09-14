<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Локальные навыки OpenCode

Навигация и границы: [`docs/agent-skills.md`](docs/agent-skills.md). Используйте
`.opencode/skills/<id>/SKILL.md` по намерению; это помощники OpenCode, не изменения
runtime DM. Перед изменением состояния ODM/MCP следуйте общему контракту и получите
явное подтверждение в разрешённом scope; разрушительные действия согласуйте отдельно.
Проверки статуса и другие read-only операции такого подтверждения не требуют. Чистые
D&D-задачи не требуют запуска сервера или MCP.
