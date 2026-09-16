import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadReviewModule} from './lib/review-module.mjs';
const input=loadReviewModule(fileURLToPath(new URL('../src/lib/dm/turn-input.ts',import.meta.url)));
for(const raw of [undefined,null,{},'not an array',0,true]) {
  test(`legacy non-array tool_calls: ${JSON.stringify(raw)}`,()=>{
    assert.deepEqual(input.collectTurnToolCallIds([{tool_calls:raw}]),[]);
  });
}
test('valid IDs survive invalid entries, duplicates and tool-only history',()=>{
  const history=[{tool_calls:[null,7,'x',{},[],{id:123},{id:''},{id:'a',extra_content:{google:{thought_signature:'opaque'}}}]},{tool_calls:[{id:'a'},{id:'b'}]},{tool_call_id:'c'}];
  const before=structuredClone(history);
  assert.deepEqual(input.collectTurnToolCallIds(history),['a','b','c']);assert.deepEqual(history,before);
});
test('new and synthesized invocation IDs cannot collide with prior assistant or result IDs',()=>{
  const previous=input.collectTurnToolCallIds([{tool_calls:[{id:'a'}]},{tool_call_id:'odm_batch_1'}]);
  const calls=input.normalizeTurnToolCalls([{id:'a',name:'one',rawArguments:'{}'},{name:'two',rawArguments:'{}'},{id:'a',name:'three',rawArguments:'{}'}],'batch',previous);
  assert.equal(new Set(calls.map(call=>call.id)).size,3);
  assert.ok(calls.every(call=>!previous.includes(call.id)));
});
