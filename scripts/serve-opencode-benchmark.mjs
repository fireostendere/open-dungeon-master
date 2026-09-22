// Disposable local campaign server using the real authenticated Next route and SQLite engine.
import { register } from 'node:module';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
const stateFile = process.argv[2];
if (!stateFile) throw new Error('Usage: node scripts/serve-opencode-benchmark.mjs /tmp/odm-benchmark-state.json');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'astra-campaign-'));
process.env.SQLITE_DB_PATH = path.join(directory, 'game.sqlite');
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString('hex');
process.env.ODM_MCP_TOKEN = randomBytes(32).toString('hex');
register('./lib/register-alias.mjs', import.meta.url);
const { createUser } = await import('../src/lib/db/users.ts');
const { createCampaign, setCampaignStatus, setHumanDm, joinByInviteCode, allocateSeq } = await import('../src/lib/db/campaigns.ts');
const { createCharacter, instantiateIntoCampaign } = await import('../src/lib/db/characters.ts');
const { createSheetSchema } = await import('../src/lib/schemas/sheet.ts');
const { insertCampaignMessage } = await import('../src/lib/db/messages.ts');
const { POST } = await import('../src/app/api/internal/mcp/route.ts');
const campaigns = [];
for (const label of ['baseline', 'optimized']) {
 const dm = createUser('dm_'+label, '!'), player=createUser('player_'+label,'!');
 const campaign = createCampaign(dm.id, {title:'Astra '+label,description:'Disposable local latency benchmark',theme:'Village inn',maxPlayers:4,startingLevel:1,difficulty:'normal',gameSettings:{dmMode:'human',ttsEnabled:false,mapsEnabled:false,unitSystem:'metric'}});
 assert.ok(!joinByInviteCode(player.id,campaign.inviteCode).error);
 setHumanDm(campaign.id, dm.id);
 const character=createCharacter(player.id,1,createSheetSchema.parse({name:'Торин',race:'human',class:'fighter',subclass:'',background:'soldier',abilities:{str:16,dex:14,con:14,int:10,wis:12,cha:10},maxHp:12,ac:16,speed:30,hitDice:{die:'d10',total:1,spent:0},proficiencies:{saves:['str','con'],skills:['athletics','perception'],languages:['common'],tools:[],armor:[],weapons:['longsword']},equipment:[{name:'Longsword',qty:1}],gold:10,copper:0}));
 const sheet=instantiateIntoCampaign(character.id,campaign.id,player.id,1);assert.ok(!sheet.error);
 setCampaignStatus(campaign.id,'active');
 for(let i=0;i<12;i++)insertCampaignMessage({campaignId:campaign.id,seq:allocateSeq(campaign.id),authorType:i%2?'dm':'player',userId:i%2?dm.id:player.id,characterId:i%2?undefined:sheet.id,content:i%2?'Трактирщик Михаил протирает стойку; дождь стучит в ставни. У двери стоит запертый сундук.':'Торин осматривает зал и спрашивает о ночлеге.'});
 campaigns.push({label,id:campaign.id,characterId:sheet.id,playerId:player.id});
}
const server=http.createServer(async(req,res)=>{
 try {
  if(req.url!=='/api/internal/mcp'){res.writeHead(404);res.end();return;}
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});
  const response=await POST(new Request('http://127.0.0.1'+req.url,{method:'POST',headers:req.headers,body:Buffer.concat(chunks),signal:controller.signal}));
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch(error){console.error(error);res.writeHead(500);res.end('benchmark fixture error');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const state={url:`http://127.0.0.1:${server.address().port}/api/internal/mcp`,token:process.env.ODM_MCP_TOKEN,campaigns,directory};
fs.writeFileSync(stateFile,JSON.stringify(state),{mode:0o600});
console.log(JSON.stringify({ready:true,stateFile,campaigns}));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close(()=>{
 fs.rmSync(stateFile,{force:true});
 fs.rmSync(directory,{recursive:true,force:true});
 process.exit();
}));
