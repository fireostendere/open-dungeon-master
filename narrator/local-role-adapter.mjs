import { NarratorOrchestrator } from './orchestration.mjs';
import { createOpenCodeAdapter } from './opencode-adapter.mjs';
import { ScopedRag } from './dnd-edition.mjs';
import { pathToFileURL } from 'node:url';

async function loadRagRetriever(options) {
  if (typeof options.ragRetriever === 'function') return options.ragRetriever;
  const source = options.ragModule ?? process.env.ODM_NARRATOR_RAG_MODULE;
  if (!source) return undefined;
  const url = new URL(source, pathToFileURL(`${process.cwd()}/`));
  if (url.protocol !== 'file:' || url.search || url.hash) throw new Error('D&D RAG adapter must be an operator-installed local module.');
  const loaded = await import(url.href), retriever = loaded.retrieveDndKnowledge ?? loaded.default;
  if (typeof retriever !== 'function') throw new Error('D&D RAG module must export retrieveDndKnowledge.');
  return retriever;
}

export async function createNarratorAdapter(options={}) {
  const cursor=options.startAfterSeq??process.env.ODM_NARRATOR_START_AFTER_SEQ;
  if(cursor===undefined||!/^[0-9]+$/.test(String(cursor))||!Number.isSafeInteger(Number(cursor)))throw new Error('Set ODM_NARRATOR_START_AFTER_SEQ to the last already handled player-input boundary (0 for a new campaign).');
  const adapter=createOpenCodeAdapter(options),dndEdition=options.dndEdition??(adapter.model.providerID==='openai'&&adapter.model.id==='gpt-5.6-dnd-edition');
  const rag=dndEdition?(options.rag??new ScopedRag({retriever:await loadRagRetriever(options)})):undefined;
  return { storyController:new NarratorOrchestrator({adapter,startAfterSeq:Number(cursor),dndEdition,rag,
    maxSteps:Number(options.maxSteps??process.env.ODM_NARRATOR_MAX_STEPS??24),maxCallsPerHour:Number(options.maxCallsPerHour??process.env.ODM_NARRATOR_MAX_CALLS_PER_HOUR??240)}) };
}
