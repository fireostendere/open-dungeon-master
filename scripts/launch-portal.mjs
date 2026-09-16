#!/usr/bin/env node
/** Explicit local-only launcher. Server pins are never taken from a request. */
import { constants, openSync, fstatSync, readSync, closeSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const TOKEN = /^[A-Za-z0-9_-]{16,512}$/;

export function parsePortalOptions(argv) {
  const options = { port: 3007, dev: false };
  const used = new Set();
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (used.has(flag)) throw new Error('A portal option was supplied more than once.');
    used.add(flag);
    if (flag === '--help' || flag === '-h') { options.help = true; continue; }
    if (flag === '--dev') { options.dev = true; continue; }
    if (!['--origin', '--token-file', '--port'].includes(flag)) throw new Error('Unknown portal option. Use --help.');
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error('A portal option is missing its value.');
    if (flag === '--origin') options.origin = value;
    else if (flag === '--token-file') options.tokenFile = value;
    else {
      if (!/^\d+$/.test(value)) throw new Error('The local port must be an integer.');
      options.port = Number(value);
    }
  }
  return options;
}

function readPrivateToken(filename) {
  if (typeof filename !== 'string' || !filename) throw new Error('Provide --token-file with a private bearer-token file.');
  // O_NOFOLLOW and fstat refer to the same opened file, not a check-then-read path.
  const fd = openSync(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.size > 1024) throw new Error('The token file must be a small regular file.');
    if (process.platform !== 'win32') {
      if ((info.mode & 0o077) !== 0) throw new Error('The token file must be private; set mode 600.');
      if (process.getuid && info.uid !== process.getuid()) throw new Error('The token file must belong to the launching user.');
    }
    const bytes = Buffer.alloc(1025);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length > 1024) throw new Error('The token file grew beyond its permitted size.');
    const token = bytes.subarray(0, length).toString('utf8').trim();
    if (!TOKEN.test(token)) throw new Error('The token file contains an invalid bearer token.');
    return token;
  } finally { closeSync(fd); }
}

export function portalLaunchSpec(options, { nextCli, environment = process.env } = {}) {
  let remote;
  try { remote = new URL(options.origin); } catch { throw new Error('Provide a valid --origin.'); }
  if (!['http:', 'https:'].includes(remote.protocol) || remote.username || remote.password || remote.search || remote.hash || remote.pathname !== '/') {
    throw new Error('The portal origin must be an HTTP(S) origin without credentials, a path, query or fragment.');
  }
  const port = options.port ?? 3007;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('The local port must be 1024..65535.');
  if (['localhost', '127.0.0.1', '[::1]'].includes(remote.hostname.toLowerCase()) && Number(remote.port || (remote.protocol === 'https:' ? 443 : 80)) === port) {
    throw new Error('The portal cannot forward to its own local listening port.');
  }
  const token = readPrivateToken(options.tokenFile);
  // Native shells retain their existing cookie provisioning. The trusted local
  // process now supplies the matching server-side pins as well.
  return {
    command: process.execPath,
    args: [nextCli ?? require.resolve('next/dist/bin/next'), options.dev ? 'dev' : 'start', '--hostname', '127.0.0.1', '--port', String(port)],
    cwd: ROOT,
    env: {
      ...environment,
      HOSTNAME: '127.0.0.1', PORT: String(port),
      ODM_LOCAL_PORTAL: '1', ODM_PORTAL_ORIGIN: remote.origin, ODM_PORTAL_TOKEN: token,
    },
  };
}

export function launchPortal(options, dependencies = {}) {
  const spec = portalLaunchSpec(options, dependencies);
  const child = spawn(spec.command, spec.args, { cwd: spec.cwd, env: spec.env, stdio: 'inherit', shell: false });
  const sigint = () => child.kill('SIGINT');
  const sigterm = () => child.kill('SIGTERM');
  process.on('SIGINT', sigint); process.on('SIGTERM', sigterm);
  const cleanup = () => { process.off('SIGINT', sigint); process.off('SIGTERM', sigterm); };
  child.once('error', cleanup); child.once('close', cleanup);
  return child;
}

export function portalHelp() {
  return 'Usage: npm run start:portal -- --origin https://game.example.org --token-file /private/portal.token [--port 3007] [--dev]\n'
    + 'The server listens only on 127.0.0.1. The native client must set its usual portal cookies to the same origin and token.\n'
    + 'The token is read from a private file, never from a command argument or cookie-controlled setting.\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parsePortalOptions(process.argv.slice(2));
    if (options.help) process.stdout.write(portalHelp());
    else {
      const child = launchPortal(options);
      child.once('error', () => { console.error('Portal startup failed. Check the local installation and token-file permissions.'); process.exitCode = 1; });
      child.once('close', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
    }
  } catch {
    // Never echo raw options, environment values or credential-file contents.
    console.error('Portal startup refused. Check --help, the origin, port, private token file and installed Next dependency.');
    process.exitCode = 1;
  }
}
