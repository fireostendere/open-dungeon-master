# YOLO DnD

YOLO is the lightweight, fiction-first runtime for constrained or casual play.
It keeps authoritative dice, combat and persistent character state, but removes
most simulation/bookkeeping work from the normal narration path.

## Automatic routing

The routing rule is intentionally simple and source-aware:

| Source | Default |
| --- | --- |
| Web/internal AI DM | YOLO |
| External narrator other than the in-repo custom OpenCode adapter | YOLO |
| In-repo custom OpenCode narrator | FULL |
| Any source with an explicit YOLO request | YOLO |

The OpenCode exception is identified by the trusted in-repository
`OpenCodeAdapter` marker. It is not inferred from User-Agent, request text or
another client-controlled header.

A player message, Ask, lore entry or prompt injection cannot switch modes.

## Explicit YOLO

For the narrator host:

```sh
node narrator/run.mjs --campaign "$ODM_CAMPAIGN_ID" --yolo
```

or:

```sh
export ODM_DND_MODE=yolo
# Legacy equivalent:
export YOLO_DND=1
```

`deploy/narratorctl.py ... --yolo` propagates the same explicit request.

An explicit YOLO request always wins. There is intentionally no client-supplied
`full` escape hatch for web or third-party hosts: sources that are not the
trusted custom OpenCode adapter remain YOLO.

## YOLO fast path

- One model call for an ordinary narration turn.
- At most two story-model calls for the internal DM turn that needs a tool
  result.
- Thinking is off by default; `YOLO_THINKING=1` opts it back in.
- Only the last 24 internal-chat messages are sent, plus compact structured
  continuity.
- Retrieval, narration-repair, chapter summarization/compaction and background
  world simulation do not run in the normal internal YOLO turn.
- Automatic image tool calls are disabled.
- The internal model receives exactly one rules tool, `game`. Its compact menu
  lists the currently legal engine operations; `game({action,args})` is
  unwrapped server-side into the existing authoritative handler.
- Active combat still uses the full authoritative encounter engine; combat
  operations do not become a second implementation merely because the model
  reaches them through `game`.
- The external narrator YOLO profile exposes the same single `game` façade
  over a compact operation catalog, uses a shorter public history, skips a
  separate writer pass and defaults to six referee steps instead of 24.

Dice are sparse by design: routine or low-stakes actions should simply work. A
roll is requested when the result is genuinely uncertain and failure would
create a meaningful consequence.

## What is deliberately sacrificed

YOLO does not try to run every simulation subsystem every turn. Relationship and
romance simulation, background world ticks, broad lore retrieval, detailed
chapter maintenance, automatic art requests, extended writer passes and
narration-guard rewrites are omitted from the fast path.

The underlying campaign data and server mechanics are not deleted. Switching
from an explicitly requested YOLO OpenCode session back to the normal custom
OpenCode launch returns to the full narrator path.

Long-term continuity is kept cheaply through summaries, recent active facts,
pinned notes/memories, a small NPC roster, durable milestones and short chapter
breadcrumbs.

## Design rule

If a mechanic improves the scene or protects authoritative state, keep it. If it
mainly makes the simulation more exact, omit it from the normal YOLO turn.


## One public engine surface

The model-facing API is now separate from the server's internal mechanics in
both FULL and YOLO play. A narrator does not receive dozens of independent
function schemas. It receives one `game` surface and selects an operation
inside it:

```json
{"action":"pc_attack","args":{"characterId":"...","enemyId":"..."}}
```

The façade does not reimplement combat, dice, spells, inventory or persistence.
The turn loop unwraps the request and sends it through the same existing
handlers, transaction boundaries, per-turn caps, physical-dice parking and
authoritative database state as the full DM. External narrators use the same
shape and the narrator host unwraps it before calling `narrator.invoke`.

This is primarily a context and tool-selection optimization: adding an internal
mechanic no longer means adding another public LLM tool schema. FULL mode keeps
the complete operation set and the long-form simulation/retrieval path behind
the same `game` façade; YOLO exposes a smaller operation set and uses it much
more sparingly. The external narrator can still request the detailed schema for
one underlying operation on demand, so maximum-control play does not require
shipping every schema on every model call.
