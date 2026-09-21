import crypto from 'node:crypto';

export const ROLE_DELTA_FORMAT = 'odm.role.delta.v1';

const forbidden = new Set(['__proto__','prototype','constructor']);
const clone = value => value === undefined ? undefined : structuredClone(value);
const plain = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(plain(value))return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
}
export function rolePacketDigest(value){
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
function itemKey(item){
  if(!plain(item))return null;
  for(const key of ['id','seq','name']){
    if(typeof item[key]==='string'&&item[key]||Number.isSafeInteger(item[key]))return `${key}:${item[key]}`;
  }
  return null;
}
function equal(a,b){return rolePacketDigest(a)===rolePacketDigest(b);}
function entityPatch(before,after){
  if(!Array.isArray(before)||!Array.isArray(after))return null;
  const beforeKeys=before.map(itemKey),afterKeys=after.map(itemKey);
  if([...beforeKeys,...afterKeys].some(key=>key===null)||
     new Set(beforeKeys).size!==beforeKeys.length||new Set(afterKeys).size!==afterKeys.length)return null;
  const old=new Map(beforeKeys.map((key,index)=>[key,before[index]]));
  const now=new Map(afterKeys.map((key,index)=>[key,after[index]]));
  const upsert=[];
  for(const [key,item] of now)if(!old.has(key)||!equal(old.get(key),item))upsert.push(clone(item));
  const remove=[...old.keys()].filter(key=>!now.has(key));
  const order=JSON.stringify(beforeKeys)===JSON.stringify(afterKeys)?undefined:afterKeys;
  return {upsert,remove,...(order?{order}:{})};
}
function diffObject(before,after){
  const patch={set:{},unset:[],objects:{},entities:{}};
  const keys=new Set([...Object.keys(before??{}),...Object.keys(after??{})]);
  for(const key of keys){
    if(forbidden.has(key))continue;
    const hasOld=Object.hasOwn(before??{},key),hasNew=Object.hasOwn(after??{},key);
    if(!hasNew){patch.unset.push(key);continue;}
    if(!hasOld){patch.set[key]=clone(after[key]);continue;}
    if(equal(before[key],after[key]))continue;
    const entities=entityPatch(before[key],after[key]);
    if(entities){patch.entities[key]=entities;continue;}
    if(plain(before[key])&&plain(after[key])){
      const nested=diffObject(before[key],after[key]);
      if(Object.keys(nested).length)patch.objects[key]=nested;
      continue;
    }
    patch.set[key]=clone(after[key]);
  }
  if(!Object.keys(patch.set).length)delete patch.set;
  if(!patch.unset.length)delete patch.unset;
  if(!Object.keys(patch.objects).length)delete patch.objects;
  if(!Object.keys(patch.entities).length)delete patch.entities;
  return patch;
}
function applyEntities(before,change){
  if(!Array.isArray(before))throw new Error('Role delta entity baseline is not an array.');
  const keys=before.map(itemKey);
  if(keys.some(key=>key===null)||new Set(keys).size!==keys.length)throw new Error('Role delta baseline has unstable entity keys.');
  const map=new Map(keys.map((key,index)=>[key,clone(before[index])]));
  for(const key of change.remove??[])map.delete(String(key));
  for(const item of change.upsert??[]){
    const key=itemKey(item);if(key===null)throw new Error('Role delta upsert lacks a stable key.');
    map.set(key,clone(item));
  }
  const order=change.order??[...map.keys()];
  if(!Array.isArray(order)||order.length!==map.size||new Set(order.map(String)).size!==map.size)throw new Error('Role delta entity order is invalid.');
  return order.map(key=>{const value=map.get(String(key));if(value===undefined)throw new Error('Role delta entity order references missing data.');return value;});
}
function applyObject(before,patch){
  if(!plain(before))throw new Error('Role delta object baseline is invalid.');
  const result=clone(before);
  for(const key of patch.unset??[]){if(forbidden.has(key))throw new Error('Invalid role delta key.');delete result[key];}
  for(const [key,value] of Object.entries(patch.set??{})){if(forbidden.has(key))throw new Error('Invalid role delta key.');result[key]=clone(value);}
  for(const [key,nested] of Object.entries(patch.objects??{})){
    if(forbidden.has(key)||!Object.hasOwn(result,key))throw new Error('Invalid nested role delta.');
    result[key]=applyObject(result[key],nested);
  }
  for(const [key,change] of Object.entries(patch.entities??{})){
    if(forbidden.has(key)||!Object.hasOwn(result,key))throw new Error('Invalid role entity delta.');
    result[key]=applyEntities(result[key],change);
  }
  return result;
}
export function createRolePacketDelta(before,after){
  if(!plain(before)||!plain(after))throw new Error('Role packets must be objects.');
  return {format:ROLE_DELTA_FORMAT,baseDigest:rolePacketDigest(before),digest:rolePacketDigest(after),patch:diffObject(before,after)};
}
export function applyRolePacketDelta(before,delta){
  if(delta?.format!==ROLE_DELTA_FORMAT||delta.baseDigest!==rolePacketDigest(before))throw new Error('Role delta baseline mismatch.');
  const result=applyObject(before,delta.patch??{});
  if(rolePacketDigest(result)!==delta.digest)throw new Error('Role delta checksum mismatch.');
  return result;
}
