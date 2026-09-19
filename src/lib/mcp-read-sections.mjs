import { narratorSectionCache, NARRATOR_SECTION_SOURCES, projectionDigest } from './db/revision-cache.mjs';

/** Caller has already authenticated the narrator and validated its timeline.
 * Historical/player-observed projections deliberately do not use this cache.
 */
export function readNarratorSections({ db, campaignId, timelineEpoch, principal, live, delta, knownSections = {}, loaders }) {
  const started=performance.now();
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
  if(process.env.ODM_LATENCY_LOG==='1')console.error('[odm-latency]',JSON.stringify({stage:'read_sections',durationMs:Math.round(performance.now()-started),hits:cache.stats.hits-before.hits,loads:cache.stats.loads-before.loads}));
  return { sections,sectionVersions,omittedSections };
}
