import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadReviewModule} from './lib/review-module.mjs';
const root = fileURLToPath(new URL('../src/lib/i18n/',import.meta.url));
const game = loadReviewModule(root+'game-text.ts');
const display = loadReviewModule(root+'character-display.ts');
const {displaySystemText} = loadReviewModule(root+'session-system-text.ts',{'./game-text':game,'./character-display':display});
for (const language of ['ru','en']) {
  test(`system text catalog and placeholders: ${language}`,()=>{
    assert.deepEqual(Object.keys(game.GAME_TEXT[language]),Object.keys(game.GAME_TEXT.en));
    for(const [key,text] of Object.entries(game.GAME_TEXT[language])){
      assert.ok(text);
      assert.deepEqual([...text.matchAll(/\{(\w+)\}/g)].map(x=>x[1]).sort(),[...game.GAME_TEXT.en[key].matchAll(/\{(\w+)\}/g)].map(x=>x[1]).sort());
    }
    assert.ok(game.gameText(language,'nextTurn',{name:'Hero {round}',round:4}).includes('Hero {round}'));
  });
}
for (const language of ['ru']) {
  test(`end, skip and initiative messages are rendered in ${language} without changing stored text`,()=>{
    const original=["It is now O'Brien's turn (round 3).","Hero ends their turn. It is now Ally's turn.","Hero ends their turn.","The party lead skipped Hero's turn. It is now Ally's turn."];
    const before=[...original];
    const rendered=original.map(s=>displaySystemText(s,language));
    assert.equal(rendered[0],game.gameText(language,'nextTurn',{name:"O'Brien",round:3}));
    assert.equal(rendered[1],game.gameText(language,'endTurn',{name:'Hero'})+' '+game.gameText(language,'nextTurnShort',{name:'Ally'}));
    assert.equal(rendered[2],game.gameText(language,'endTurn',{name:'Hero'}));
    assert.equal(rendered[3],game.gameText(language,'skipTurn',{name:'Hero'})+' '+game.gameText(language,'nextTurnShort',{name:'Ally'}));
    assert.deepEqual(original,before);
  });
  test(`halted notices retain protocol marker in storage and localize display (${language})`,()=>{
    const marker='The DM ran into a problem: ';
    for(const key of ['internal','backend','timeout','context','toolsExhausted']){
      const stored=marker+game.GAME_TEXT.en[key];
      const rendered=displaySystemText(stored,language);
      assert.ok(!rendered.includes(marker));assert.ok(rendered.endsWith(game.GAME_TEXT[language][key]));
      assert.ok(stored.startsWith(marker));
    }
    assert.ok(displaySystemText(marker+'Unrecognized private provider diagnostic',language).includes(game.GAME_TEXT[language].unknownFailure));
    const authored='Arbitrary authored sentence: the statue says hello.';
    assert.equal(displaySystemText(authored,language),authored);
  });
}
test('skip-turn count notices use the active locale',()=>{
  assert.equal(game.gameText('en','skipTurns',{name:'Hero',count:2}),'*Hero skips a turn (remaining: 2).*');
  assert.equal(game.gameText('ru','skipTurns',{name:'Герой',count:2}),'*Герой пропускает ход (осталось: 2).*');
});
test('explicit campaign language wins and legacy inference matches the prompt rules',()=>{
  const history=[{authorType:'player',content:'Hello'},{authorType:'dm',content:'Русский ответ'}];
  assert.equal(game.resolveGameLanguage(undefined,history),'en');
  assert.equal(game.resolveGameLanguage('pl',history),'en');
  assert.equal(game.resolveGameLanguage(undefined,[{authorType:'player',content:'Pójdę dalej'}]),'en');
  assert.equal(game.resolveGameLanguage(undefined,[{authorType:'player',content:'Иду дальше'}]),'ru');
  assert.equal(game.resolveGameLanguage(null,[]),'ru');
});
test('provider diagnostics map to actionable localized failures without exposing raw text',()=>{
  assert.equal(game.modelFailureText('ru','MODEL_CONTEXT_EXCEEDED',400),game.GAME_TEXT.ru.context);
  for(const [status,key]of [[401,'unauthorized'],[403,'unauthorized'],[429,'rateLimit'],[504,'timeout'],[502,'backend']]) {
    assert.equal(game.modelFailureText('en','private diagnostic',status),game.GAME_TEXT.en[key]);
  }
});
