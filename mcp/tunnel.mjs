#!/usr/bin/env node
import { createOdmTunnel } from './transport.mjs';

const tunnel = createOdmTunnel();
await tunnel.start();
console.error(`ODM persistent tunnel ready on ${process.env.ODM_TUNNEL_LOCAL_HOST || '127.0.0.1'}:${process.env.ODM_TUNNEL_LOCAL_PORT || 39005}`);
const close = async () => { await tunnel.stop(true); process.exit(0); };
process.once('SIGINT', close);
process.once('SIGTERM', close);
await new Promise(() => {});
