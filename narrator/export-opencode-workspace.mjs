#!/usr/bin/env node
import fs from 'node:fs';import path from 'node:path';import { ROLE_PROFILES,trustedInstruction } from './role-profiles.mjs';
const directory=process.argv[2];if(!directory)throw new Error('Usage: node narrator/export-opencode-workspace.mjs <empty-directory>');
const target=path.resolve(directory),config=path.join(target,'opencode.json');fs.mkdirSync(target,{recursive:true});
if(fs.existsSync(config)||fs.readdirSync(target).length)throw new Error('Refusing to overwrite a non-empty workspace.');
fs.writeFileSync(config,JSON.stringify({$schema:'https://opencode.ai/config.json',warming:false,agents:Object.fromEntries(Object.keys(ROLE_PROFILES).map(name=>[`narrator-${name}`,{mode:'primary',system:trustedInstruction(name),permissions:[{action:'*',resource:'*',effect:'deny'}]}]))},null,2)+'\n',{mode:0o600,flag:'wx'});
console.log(config);
