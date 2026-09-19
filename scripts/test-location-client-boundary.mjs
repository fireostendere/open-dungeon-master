// The retained LocationIntentSession hook is covered by test-location-client-intents.
// These merged API checks cover both historical identity-header contracts and
// a session change across awaited body parsing; authentication itself is doubled.
import test from 'node:test';
import assert from 'node:assert/strict';
import { astraHarness } from './lib/astra-harness.mjs';
test('both expected-user headers are conjunctive and cannot impersonate another seat',async t=>{
 const f=await astraHarness(t);f.login('b');const context={params:Promise.resolve({campaignId:'c'})};
 const denied=await f.locationRoute.GET(new Request('http://local/location-chat',{headers:{'X-ODM-Actor':'b','X-ODM-Expected-User':'a'}}),context);
 assert.equal(denied.status,409);assert.equal((await denied.json()).code,'identity_changed');
 const allowed=await f.locationRoute.GET(new Request('http://local/location-chat',{headers:{'X-ODM-Actor':'b','X-ODM-Expected-User':'b'}}),context);
 assert.equal(allowed.status,200);
});
test('a login change during note body parsing is rejected before any mutation',async t=>{
 const f=await astraHarness(t);f.login('a');
 const request={headers:new Headers(),json:async()=>{f.login('b');return {visibility:'public',title:'Changed user',body:'MUST_NOT_BE_WRITTEN',roomId:'tavern'};}};
 const result=await f.listRoute.POST(request,{params:Promise.resolve({campaignId:'c'})});
 assert.equal(result.status,409);assert.equal(f.db.prepare('SELECT count(*) n FROM campaign_notes').get().n,0);
});
