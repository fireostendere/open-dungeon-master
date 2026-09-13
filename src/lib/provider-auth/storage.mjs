import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { ProviderError } from './core.mjs';

export function authRoot(projectRoot=process.cwd()) {
  const projectId=createHash('sha256').update(fs.realpathSync(projectRoot)).digest('hex').slice(0,16);
  // Keep auth outside the project, build tracing, public assets and normal game exports.
  return process.env.ODM_PROVIDER_AUTH_HOME || path.join(os.homedir(),'.local','state','odm-provider-auth',projectId);
}
export function secureDirectory(dir) {
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const s=fs.lstatSync(dir);
  if (!s.isDirectory() || s.isSymbolicLink()) throw new ProviderError('UNSAFE_AUTH_DIRECTORY');
  if(process.platform !== 'win32') fs.chmodSync(dir,0o700);
}
export function readOrCreateSecret(dir,name) {
  secureDirectory(dir); const file=path.join(dir,name);
  try {fs.writeFileSync(file,randomBytes(32).toString('hex')+'\n',{flag:'wx',mode:0o600});}
  catch(e){if(e.code!=='EEXIST')throw e;}
  const stat=fs.lstatSync(file);
  if(!stat.isFile() || stat.isSymbolicLink() || stat.nlink!==1) throw new ProviderError('UNSAFE_AUTH_SECRET_FILE');
  if(process.platform!=='win32') {
    if(typeof process.getuid==='function' && stat.uid !== process.getuid()) throw new ProviderError('AUTH_SECRET_WRONG_OWNER');
    fs.chmodSync(file,0o600);
  }
  const key=fs.readFileSync(file,'utf8').trim();
  if(!/^[0-9a-f]{64}$/.test(key))throw new ProviderError('INVALID_LOCAL_AUTH_SECRET');
  return key;
}
export function codexEnvironment(root) {
  const codexHome=path.join(root,'codex'), work=path.join(root,'empty-workspace');
  secureDirectory(codexHome); secureDirectory(work);
  // Only runtime essentials; do not pass DB/API secrets or the user's working Codex profile.
  const env={};
  for(const key of ['PATH','Path','PATHEXT','SystemRoot','WINDIR','COMSPEC','TEMP','TMP','LANG','LC_ALL','SSL_CERT_FILE','SSL_CERT_DIR','HTTPS_PROXY','HTTP_PROXY','NO_PROXY']) {
    if(process.env[key])env[key]=process.env[key];
  }
  env.HOME=root;env.USERPROFILE=root;env.CODEX_HOME=codexHome;
  return {env,cwd:work,codexHome};
}
