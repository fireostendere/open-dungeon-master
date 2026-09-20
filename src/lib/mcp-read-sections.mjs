import { narratorSectionCache, NARRATOR_SECTION_SOURCES, projectionDigest } from './db/revision-cache.mjs';
import { emitLatency, latencyEnabled } from '../../mcp/latency-trace.mjs';

/** Caller has already authenticated the narrator and validated its timeline.
 * Historical/player-observed projections deliberately do not use this cache.
 */
export function readNarratorSections({ db, campaignId, timelineEpoch, principal, live, delta, knownSections = {}, loaders }) {
  const timing=latencyEnabled(), started=timing?performance.now():0;
  const omittedSections = live ? ['recentRolls','recentDmWhispers','recentMessages','chapters'] : [];
  const sections = {}, sectionVersions = {}, cache = narratorSectionCache(db);
  const before={...cache.stats};
  for (const [section, load] of Object.entries(loaders)) {
    if (omittedSections.includes(section)) { sections[section] = []; continue; }
    const dependencies = NARRATOR_SECTION_SOURCES[section];
    const entry = dependencies ? cache.get({ campaignId,timelineEpoch,principal,section,dependencies,load }) : null;
    const value = entry ? undefined : load();
    const version = entry?.version ?? projectionDigest({ campaignId,timelineEpoch,section,content:value });
    sectionVersions[section] = version;
    if (delta && knownSections[section] === version) {
      sections[section] = []; omittedSections.push(section);
    } else sections[section] = entry ? entry.value() : value;
  }
  if(timing)emitLatency({stage:'read_sections',durationMs:performance.now()-started,hits:cache.stats.hits-before.hits,loads:cache.stats.loads-before.loads});
  return { sections,sectionVersions,omittedSections };
}
