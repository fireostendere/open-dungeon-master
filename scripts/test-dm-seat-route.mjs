import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { loadSource } from './lib/readiness-harness.mjs';

test('party lead may seat a technical DM, but never a player with a sheet', async () => {
  const members = [{ userId: 'lead' }, { userId: 'technical-dm' }];
  const campaign = { id: 'campaign', dmUserId: 'old-dm', assistantDmUserId: null,
    gameSettings: { dmMode: 'human' } };
  const events = [];
  const route = loadSource('src/app/api/campaigns/[campaignId]/dm/seat/route.ts', {
    zod: { z },
    '@/lib/campaign-api': { requireMember: async () => ({ campaign, user: { id: 'lead' } }),
      isErrorResponse: () => false, isLead: () => true },
    '@/lib/db/campaigns': { campaignSeats: () => ({}), getCampaignById: () => campaign,
      listMembers: () => members, setAssistantDm: () => true,
      setHumanDm: (_id, userId) => { campaign.dmUserId = userId; return true; } },
    '@/lib/db/sheets': { listSheets: () => [{ userId: 'lead' }] },
    '@/lib/dm/viewer': { isPrimaryDm: () => false },
    '@/lib/events': { publishPersisted: (_id, type, payload) => events.push({ type, payload }) },
  });
  const send = userId => route.POST(new Request('http://localhost/dm/seat', { method: 'POST',
    body: JSON.stringify({ seat: 'dm', userId }) }), { params: Promise.resolve({ campaignId: campaign.id }) });

  campaign.assistantDmUserId = 'lead';
  assert.equal((await send('lead')).status, 409);
  assert.equal(campaign.dmUserId, 'old-dm');
  assert.equal(campaign.assistantDmUserId, 'lead', 'rejected promotion must not empty the assistant seat');
  assert.deepEqual(events, []);
  campaign.assistantDmUserId = null;
  assert.equal((await send('technical-dm')).status, 200);
  assert.equal(campaign.dmUserId, 'technical-dm');
  assert.equal(events.at(-1).type, 'campaign_updated');
  assert.equal(events.at(-1).payload.dmUserId, 'technical-dm');
});
