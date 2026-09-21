import { NarratorOrchestrator } from './orchestration.mjs';
import { createOpenCodeAdapter } from './opencode-adapter.mjs';

export async function createNarratorAdapter(options = {}) {
  const cursor = options.startAfterSeq ?? process.env.ODM_NARRATOR_START_AFTER_SEQ;
  if (cursor === undefined || !/^[0-9]+$/.test(String(cursor)) || !Number.isSafeInteger(Number(cursor))) {
    throw new Error('Set ODM_NARRATOR_START_AFTER_SEQ to the last already handled player-input boundary (0 for a new campaign).');
  }

  const adapter = createOpenCodeAdapter(options);
  // Build empty, deny-all, role-pinned sessions before gameplay. They contain
  // trusted instructions only; each is consumed once and replenished in the
  // background while the current model call runs.
  await adapter.prepare(['referee', 'writer', 'ask']);
  const maxStepsRaw = options.maxSteps ?? process.env.ODM_NARRATOR_MAX_STEPS;
  const maxCallsRaw = options.maxCallsPerHour ?? process.env.ODM_NARRATOR_MAX_CALLS_PER_HOUR ?? 240;

  return {
    storyController: new NarratorOrchestrator({
      adapter,
      startAfterSeq: Number(cursor),
      ...(maxStepsRaw === undefined ? {} : { maxSteps: Number(maxStepsRaw) }),
      maxCallsPerHour: Number(maxCallsRaw),
      yolo: options.yolo === true,
      writerEnabled: options.writerEnabled ?? process.env.ODM_NARRATOR_WRITER_ENABLED !== '0',
    }),
  };
}
