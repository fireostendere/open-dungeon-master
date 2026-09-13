// Explicit recovery fixture, not a generated campaign or model-quality test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {register} from 'node:module';
register('../../scripts/lib/register-alias.mjs',import.meta.url);
const {getDatabase}=await import('../../src/lib/db/core.ts');
const {createCampaign}=await import('../../src/lib/db/campaigns.ts');
const db=getDatabase(),action=process.argv[2];
const title='Operations recovery fixture';
try {
  if(action==='seed') {
    const user=db.prepare('SELECT id FROM users WHERE is_admin=1 LIMIT 1').get();assert.ok(user);
    const campaign=createCampaign(user.id,{title,description:'Recovery fixture',theme:'',maxPlayers:3,startingLevel:3,difficulty:'normal',gameSettings:{}});
    db.prepare('UPDATE campaigns SET story_summary=? WHERE id=?').run('The three heroes reached the old observatory.',campaign.id);
    const now=new Date().toISOString();
    db.prepare(`INSERT INTO character_sheets
      (id,campaign_id,user_id,name,race,class,level,abilities_json,max_hp,current_hp,ac,speed,hit_dice_json,proficiencies_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(),campaign.id,user.id,'Recovery hero','Human','Fighter',3,'{}',24,17,16,30,'{}','{}',now,now);
    db.prepare('INSERT INTO campaign_messages (id,campaign_id,seq,author_type,content,created_at) VALUES (?,?,?,?,?,?)')
      .run(crypto.randomUUID(),campaign.id,1,'dm','The gate is still locked.',now);
    fs.writeFileSync('/app/public/uploads/recovery-fixture.txt','portrait-asset-fixture');
    fs.writeFileSync('/app/provider-auth/recovery-fixture.txt','isolated-auth-fixture');
  } else if(action==='mutate') {
    db.prepare('UPDATE character_sheets SET current_hp=1 WHERE name=?').run('Recovery hero');
    db.prepare('UPDATE campaigns SET story_summary=? WHERE title=?').run('Later state',title);
    fs.writeFileSync('/app/public/uploads/recovery-fixture.txt','later-asset');
  } else if(action==='assert' || action==='assert-mutated') {
    const campaign=db.prepare('SELECT id,story_summary FROM campaigns WHERE title=?').get(title);assert.ok(campaign);
    const sheet=db.prepare('SELECT current_hp FROM character_sheets WHERE campaign_id=?').get(campaign.id);
    assert.equal(sheet.current_hp,action==='assert'?17:1);
    if(action==='assert') {
      assert.equal(campaign.story_summary,'The three heroes reached the old observatory.');
      assert.equal(db.prepare('SELECT content FROM campaign_messages WHERE campaign_id=?').get(campaign.id).content,'The gate is still locked.');
      assert.equal(fs.readFileSync('/app/public/uploads/recovery-fixture.txt','utf8'),'portrait-asset-fixture');
      assert.equal(fs.readFileSync('/app/provider-auth/recovery-fixture.txt','utf8'),'isolated-auth-fixture');
    }
  } else throw new Error('Unknown fixture action');
  console.log('Recovery game-state fixture: '+action+' PASS');
} finally {db.close();}
