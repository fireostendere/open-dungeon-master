// Offline bootstrap/validation. Never runs a second application writer alongside a live server.
import {register} from 'node:module';
import fs from 'node:fs';
import Database from 'better-sqlite3-multiple-ciphers';
register('../scripts/lib/register-alias.mjs', import.meta.url);
const operation=process.argv[2];
try {
  if(operation==='bootstrap') {
    let raw=''; for await(const chunk of process.stdin) {raw+=chunk;if(raw.length>4096)throw new Error('Input too large');}
    const {username,password}=JSON.parse(raw);
    if(!/^[A-Za-z0-9_-]{3,24}$/.test(username)||typeof password!=='string'||password.length<16||password.length>100)throw new Error('Invalid admin input');
    const {getDatabase}=await import('../src/lib/db/core.ts');
    const {countUsers,createUser}=await import('../src/lib/db/users.ts');
    const {saveGlobalConfig}=await import('../src/lib/db/app-settings.ts');
    const {randomBytes,scryptSync}=await import('node:crypto');
    const db=getDatabase();
    if(countUsers()===0) {
      // Same password format as src/lib/auth.ts, verified by deployment CI login.
      const salt=randomBytes(16).toString('hex');
      const user=createUser(username,`${salt}$${scryptSync(password,salt,64).toString('hex')}`,{isAdmin:true});
      db.prepare('UPDATE users SET must_change_password = 1 WHERE id = ?').run(user.id);
      saveGlobalConfig({signupMode:'invite'});
      console.log('Initial private administrator created; change its password at first login.');
    } else console.log('Existing accounts preserved; administrator was not replaced.');
    db.close();
  } else if(operation==='check') {
    const file=process.env.SQLITE_DB_PATH,key=process.env.DB_ENCRYPTION_KEY;
    if(!file||!fs.existsSync(file)||!key)throw new Error('Missing database or encryption key');
    const db=new Database(file,{readonly:true,fileMustExist:true});
    try {
      db.pragma("cipher='chacha20'");db.pragma(`key='${key.replaceAll("'","''")}'`);
      const result=db.pragma('integrity_check');
      if(result.length!==1||Object.values(result[0])[0]!=='ok')throw new Error('Database integrity check failed');
      for(const table of ['users','campaigns','character_sheets','campaign_messages'])db.prepare(`SELECT count(*) FROM ${table}`).get();
      console.log('Encrypted database integrity and required game tables: PASS');
    } finally {db.close();}
  } else throw new Error('Expected bootstrap or check');
} catch {console.error('ODM database operation failed; no key or database content is logged.');process.exitCode=1;}
