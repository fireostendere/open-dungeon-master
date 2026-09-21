import net from 'node:net';
import { spawn } from 'node:child_process';

const READ_ACTIONS = new Set([
  'narrator.connect', 'narrator.read', 'narrator.snapshot', 'narrator.catalog',
  'server.status', 'server.capabilities', 'users.list', 'campaigns.list',
  'campaigns.get', 'campaigns.members', 'campaigns.events', 'characters.list',
  'characters.get', 'sheets.list', 'sheets.get',
]);

export class OdmTransportError extends Error {
  constructor(message, { code = 'ODM_TRANSPORT_ERROR', cause } = {}) {
    super(message, { cause });
    this.name = 'OdmTransportError';
    this.code = code;
  }
}

const number = (value, fallback, min = 1, max = 65535) => {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
};

function failureDetail(error) {
  const message = error instanceof Error ? error.message : '';
  return message && !/(bearer|token|password|secret|authorization)/i.test(message)
    ? `: ${message.slice(0, 160)}`
    : '';
}

function safeTarget(value) {
  if (typeof value !== 'string' || !value.trim() || /[\s\0\r\n]/.test(value)) {
    throw new OdmTransportError('ODM_SSH_TARGET is invalid.', { code: 'ODM_TRANSPORT_CONFIG' });
  }
  return value.trim();
}

function endpoint(value) {
  let url;
  try { url = new URL(value); } catch (error) {
    throw new OdmTransportError('ODM_URL must be an absolute HTTP(S) URL.', { code: 'ODM_TRANSPORT_CONFIG', cause: error });
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new OdmTransportError('ODM_URL must not contain credentials, query parameters or fragments.', { code: 'ODM_TRANSPORT_CONFIG' });
  }
  return url;
}

function tcpProbe(host, port, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => socket.destroy(new Error('Tunnel readiness timeout.')), timeoutMs);
    const abort = () => socket.destroy(signal.reason ?? new Error('Tunnel start cancelled.'));
    signal?.addEventListener('abort', abort, { once: true });
    const finish = (error) => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort); socket.destroy();
      error ? reject(error) : resolve();
    };
    socket.once('connect', () => finish());
    socket.once('error', finish);
  });
}

function createPersistentTunnel({
  target, localHost, localPort, remoteHost, remotePort, sshBin, spawnImpl, readyTimeoutMs, waitForReady,
}) {
  let child = null;
  let starting = null;
  let closed = false;

  const stop = async (final = false) => {
    if (final) closed = true;
    const process = child;
    child = null;
    if (!process || process.exitCode !== null) return;
    await new Promise(resolve => {
      process.once('exit', resolve);
      process.kill('SIGTERM');
    });
  };

  const start = async (signal) => {
    if (closed) throw new OdmTransportError('ODM tunnel is closed.', { code: 'ODM_TUNNEL_CLOSED' });
    if (child && child.exitCode === null) return;
    if (starting) return starting;
    starting = (async () => {
      const args = [
        '-N', '-T', '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes',
        '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3',
        '-L', `${localHost}:${localPort}:${remoteHost}:${remotePort}`, target,
      ];
      let process;
      try { process = spawnImpl(sshBin, args, { stdio: ['ignore', 'ignore', 'pipe'] }); }
      catch (error) { throw new OdmTransportError('Could not start ODM SSH tunnel.', { code: 'ODM_TUNNEL_START', cause: error }); }
      child = process;
      let readyState = false;
      const failed = new Promise((_, reject) => {
        process.once('error', error => reject(new OdmTransportError('ODM SSH tunnel failed to start.', { code: 'ODM_TUNNEL_START', cause: error })));
        process.once('exit', (code, signalName) => {
          if (child === process) child = null;
          if (!readyState && code !== 0 && !closed) reject(new OdmTransportError('ODM SSH tunnel exited.', { code: 'ODM_TUNNEL_EXIT' }));
          else if (!readyState && signalName && !closed) reject(new OdmTransportError('ODM SSH tunnel stopped.', { code: 'ODM_TUNNEL_EXIT' }));
        });
      });
      const ready = waitForReady
        ? waitForReady({ host: localHost, port: localPort, signal })
        : tcpProbe(localHost, localPort, readyTimeoutMs, signal);
      try {
        await Promise.race([ready, failed]);
        readyState = true;
      } catch (error) {
        process.kill('SIGTERM');
        throw error instanceof OdmTransportError
          ? error
          : new OdmTransportError('ODM SSH tunnel is unavailable.', { code: 'ODM_TUNNEL_UNAVAILABLE', cause: error });
      }
    })().finally(() => { starting = null; });
    return starting;
  };

  return { start, stop, isAlive: () => Boolean(child && child.exitCode === null) };
}

export function createOdmTunnel(options = {}) {
  const localHost = options.localHost ?? process.env.ODM_TUNNEL_LOCAL_HOST ?? '127.0.0.1';
  const localPort = number(options.localPort ?? process.env.ODM_TUNNEL_LOCAL_PORT, 39005);
  const remotePort = number(options.remotePort ?? process.env.ODM_SSH_REMOTE_PORT, 3005);
  const readyTimeoutMs = number(options.readyTimeoutMs ?? process.env.ODM_TUNNEL_READY_TIMEOUT_MS, 10_000, 100, 120_000);
  return createPersistentTunnel({
    target: safeTarget(options.sshTarget ?? process.env.ODM_SSH_TARGET ?? ''), localHost, localPort,
    remoteHost: options.remoteHost ?? process.env.ODM_SSH_REMOTE_HOST ?? '127.0.0.1', remotePort,
    sshBin: options.sshBin ?? process.env.ODM_SSH_BIN ?? 'ssh', spawnImpl: options.spawnImpl ?? spawn,
    readyTimeoutMs, waitForReady: options.waitForReady,
  });
}

export function transportConfig(options = {}) {
  const configured = String(options.transport ?? process.env.ODM_TRANSPORT ?? '').trim().toLowerCase();
  const rawUrl = options.url ?? process.env.ODM_URL ?? process.env.ODM_MCP_CONTROL_URL ?? 'http://127.0.0.1:3005/api/internal/mcp';
  const transport = configured || (String(rawUrl).startsWith('https://') ? 'https' : 'local');
  if (!['local', 'https', 'ssh-tunnel'].includes(transport)) {
    throw new OdmTransportError(`Unsupported ODM_TRANSPORT: ${transport}.`, { code: 'ODM_TRANSPORT_CONFIG' });
  }
  if (transport === 'https' && !String(rawUrl).startsWith('https://')) {
    throw new OdmTransportError('HTTPS transport requires an https:// ODM_URL.', { code: 'ODM_TRANSPORT_CONFIG' });
  }
  if (transport === 'local' && !String(rawUrl).startsWith('http://')) {
    throw new OdmTransportError('Local transport requires an http:// ODM_URL.', { code: 'ODM_TRANSPORT_CONFIG' });
  }
  return { transport, url: endpoint(rawUrl) };
}

export function createOdmTransport(options = {}) {
  const config = transportConfig(options);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const localHost = options.localHost ?? process.env.ODM_TUNNEL_LOCAL_HOST ?? '127.0.0.1';
  const localPort = number(options.localPort ?? process.env.ODM_TUNNEL_LOCAL_PORT, 39005);
  const tunnel = config.transport === 'ssh-tunnel' ? createOdmTunnel(options) : null;
  const url = config.transport === 'ssh-tunnel'
    ? endpoint(options.tunnelUrl ?? process.env.ODM_TUNNEL_URL ?? `http://${localHost}:${localPort}${config.url.pathname}`)
    : config.url;

  async function request(body, { signal, timeoutMs = 135_000, retryable = false, headers = {} } = {}) {
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)].filter(Boolean));
    const init = {
      method: 'POST', redirect: 'error', signal: requestSignal,
      headers: { 'content-type': 'application/json', accept: 'application/json', ...headers }, body: JSON.stringify(body),
    };
    const send = async () => {
      await tunnel?.start(requestSignal);
      return fetchImpl(url, init);
    };
    try { return await send(); }
    catch (error) {
      if (requestSignal.aborted) throw error;
      if (retryable) {
        await tunnel?.stop();
        return send();
      }
      if (error instanceof OdmTransportError) throw error;
      throw new OdmTransportError(`ODM transport is unavailable${failureDetail(error)}.`, { code: 'ODM_TRANSPORT_UNAVAILABLE', cause: error });
    }
  }

  return {
    kind: config.transport,
    url: url.toString(),
    request,
    close: () => tunnel?.stop(true),
    retryable: action => READ_ACTIONS.has(action),
  };
}
