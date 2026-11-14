#!/usr/bin/env node
import { loadConfig } from '../lib/config.js';
import { TunnelClient } from '../lib/client.js';

function usage() {
  console.log('Usage: easytunnel --src=PORT [--server URL] [--preserve-host]');
  console.log('Configure token and optional settings in easy-tunnel-config.json.');
}

const args = process.argv.slice(2);
let server;
let preserveHost;
let port;
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--help' || arg === '-h') {
    usage();
    process.exit(0);
  }
  if (arg === '--server') {
    if (!args[i + 1]) {
      usage();
      process.exit(1);
    }
    server = args[++i];
  } else if (arg.startsWith('--server=')) {
    server = arg.slice('--server='.length);
  } else if (arg === '--preserve-host') {
    preserveHost = true;
  } else if (arg === '--src' && port === undefined && /^\d+$/.test(args[i + 1] ?? '')) {
    port = Number(args[++i]);
  } else if (arg.startsWith('--src=') && port === undefined && /^\d+$/.test(arg.slice(6))) {
    port = Number(arg.slice(6));
  } else if (/^\d+$/.test(arg) && port === undefined) {
    port = Number(arg);
  } else {
    usage();
    process.exit(1);
  }
}
let client;
try {
  const config = loadConfig();
  port = port ?? config.src;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    usage();
    process.exit(1);
  }
  const serverURL = server ?? config.server;
  if (!serverURL) {
    throw new Error(
      'Server URL is required; set server in easy-tunnel-config.json or use --server.',
    );
  }
  client = new TunnelClient({
    server: serverURL,
    port,
    preserveHost: preserveHost ?? config.preserveHost ?? false,
    token: process.env.TUNNEL_TOKEN ?? config.token,
  });
  await client.start();
} catch (err) {
  console.error(err.message);
  client?.close();
  process.exitCode = 1;
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    client?.close();
  });
}
