import { NarratorOrchestrator } from './orchestration.mjs';
import { createOpenCodeAdapter } from './opencode-adapter.mjs';
export async function createNarratorAdapter(options={}) {
  const cursor=options.startAfterSeq??process.env.ODM_NARRATOR_START_AFTER_SEQ;
  if(cursor===undefined||!/^[0-9]+$/.test(String(cursor))||!Number.isSafeInteger(Number(cursor)))throw new Error('Set ODM_NARRATOR_START_AFTER_SEQ to the last already handled player-input boundary (0 for a new campaign).');
  return { storyController:new NarratorOrchestrator({adapter:createOpenCodeAdapter(options),startAfterSeq:Number(cursor),
    maxSteps:Number(options.maxSteps??process.env.ODM_NARRATOR_MAX_STEPS??24),maxCallsPerHour:Number(options.maxCallsPerHour??process.env.ODM_NARRATOR_MAX_CALLS_PER_HOUR??240)}) };
}
