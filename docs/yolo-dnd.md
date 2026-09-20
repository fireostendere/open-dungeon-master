# YOLO DnD

This branch is the lightweight, fiction-first runtime for playing when model quality,
latency, context budget, bandwidth, or compute are constrained.

The target is not rules accuracy at any cost. The target is a fast, coherent and
fun table that still has real dice and server-authoritative combat/state.

## Defaults

YOLO mode is enabled by default on this branch.

- One model call for an ordinary narration turn.
- At most two story-model calls for a normal turn that needs a tool result.
- Thinking is off by default.
- Only the last 24 chat messages are sent, plus compact structured continuity.
- Retrieval, narration-repair, chapter summarization/compaction and background
  world simulation do not run in the normal YOLO turn.
- Automatic image tool calls are disabled.
- Out of combat the model sees a small tool surface: generic dice, location,
  whispers, rest, persistent character-state changes and spell/resource state.
- During an encounter the full authoritative combat toolset becomes available.
- A missed private-whisper reply uses the deterministic fallback instead of
  spending another model call.

Dice are intentionally sparse: routine or low-stakes actions should simply work.
A roll is requested when the outcome is genuinely uncertain and failure would
create a meaningful consequence. Combat rolls and HP remain authoritative.

## Environment overrides

```sh
# Default on this branch. Explicit form:
YOLO_DND=1

# Temporarily run the normal full ODM pipeline from this branch:
YOLO_DND=0

# Optional: let the first/tool-decision call use model thinking.
# Default is off for speed and weak-model compatibility.
YOLO_THINKING=1
```

## What is deliberately sacrificed

YOLO does not try to run every simulation subsystem every turn. Relationship
simulation, background world ticks, broad lore retrieval, detailed chapter
maintenance, automatic art requests and narration guard rewrites are omitted
from the fast path. The underlying database and mechanics are not removed, so
switching back to the full pipeline does not destroy campaign data.

Long-term continuity is kept cheaply through the campaign/chapter summary,
recent active facts, pinned notes/memories, a small NPC roster and the last
three closed-chapter breadcrumbs.

## Expected model capability

A small model should support OpenAI-style tool/function calls. The existing
text/XML/prose salvage paths remain in place, so imperfect tool formatting is
still tolerated. A 16k context is a reasonable floor; larger context helps with
large parties but is no longer required just to carry the full DM rule manual.

## Design rule

If a mechanic makes the scene better or protects authoritative state, keep it.
If it exists mainly to make the simulation more exact, omit it from the normal
YOLO turn.
