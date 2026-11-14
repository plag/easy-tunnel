import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import net from 'node:net';
import { WebSocketServer } from 'ws';
import { TunnelClient } from '../lib/client.js';

test(
  'client proxies a close-delimited response and closes normally',
  {
    timeout: 15000,
  },
  async (t) => {
    let requestHeaders = '';
    const local = net.createServer((socket) => {
      socket.once('data', (chunk) => {
        requestHeaders = chunk.toString();
        socket.end('HTTP/1.0 200 OK\r\n\r\ncomplete');
      });
    });
    local.listen(0, '127.0.0.1');
    await once(local, 'listening');
    t.after(() => {
      return local.close();
    });
    const server = createServer();
    const wss = new WebSocketServer({
      noServer: true,
    });
    t.after(() => {
      for (const client of wss.clients) {
        client.terminate();
      }
      wss.close();
      server.close();
    });
    let control;
    let acceptData;
    const dataReady = new Promise((resolve) => {
      acceptData = resolve;
    });
    server.on('upgrade', (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (ws) => {
        if (req.url === '/_tunnel/control') {
          assert.equal(req.headers.authorization, 'Bearer secret');
          assert.equal(req.headers['x-easytunnel-protocol'], '1');
          control = ws;
          ws.send(
            JSON.stringify({
              type: 'ready',
              protocolVersion: 1,
              id: 'a'.repeat(32),
              secret: 'b'.repeat(32),
              url: 'https://example.test/',
            }),
          );
        } else {
          assert.equal(req.headers['x-tunnel-request'], 'c'.repeat(32));
          acceptData(ws);
        }
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const client = new TunnelClient({
      server: `http://127.0.0.1:${server.address().port}`,
      token: 'secret',
      port: local.address().port,
      onReady: () => {},
      onError: () => {},
    });
    t.after(() => {
      return client.close();
    });
    await client.start();
    control.send(
      JSON.stringify({
        type: 'open',
        id: 'c'.repeat(32),
      }),
    );
    const data = await dataReady;
    const chunks = [];
    data.on('message', (chunk) => {
      return chunks.push(chunk);
    });
    const closed = once(data, 'close');
    data.send('GET / HTTP/1.1\r\nHost: abc.tunnel.example.com\r\nConnection: close\r\n\r\n', {
      binary: true,
    });
    const [code] = await closed;
    assert.equal(code, 1000);
    assert.equal(Buffer.concat(chunks).toString(), 'HTTP/1.0 200 OK\r\n\r\ncomplete');
    assert.match(requestHeaders, /Host: localhost:/);
    assert.match(requestHeaders, /X-Forwarded-Host: abc\.tunnel\.example\.com/);
  },
);

test(
  'client rejects incompatible and missing protocol versions',
  {
    timeout: 5000,
  },
  async (t) => {
    const server = createServer();
    const wss = new WebSocketServer({
      noServer: true,
    });
    t.after(() => {
      for (const ws of wss.clients) {
        ws.terminate();
      }
      wss.close();
      server.close();
    });
    let version;
    server.on('upgrade', (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.send(
          JSON.stringify({
            type: 'ready',
            protocolVersion: version,
            id: 'a'.repeat(32),
            secret: 'b'.repeat(32),
            url: 'https://example.test/',
          }),
        );
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    for (version of [2, undefined]) {
      const client = new TunnelClient({
        server: `http://127.0.0.1:${server.address().port}`,
        token: 'secret',
        port: 5173,
        onReady: () => {
          return assert.fail('incompatible session accepted');
        },
        onError: () => {},
      });
      await assert.rejects(client.start(), /Incompatible EasyTunnel protocol/);
      client.close();
    }
  },
);

test(
  'client reports server rejection of its protocol version',
  {
    timeout: 5000,
  },
  async (t) => {
    const server = createServer();
    server.on('upgrade', (_req, socket) => {
      socket.end('HTTP/1.1 426 Upgrade Required\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => {
      return server.close();
    });
    const client = new TunnelClient({
      server: `http://127.0.0.1:${server.address().port}`,
      token: 'secret',
      port: 5173,
      onReady: () => {},
      onError: () => {},
    });
    t.after(() => {
      return client.close();
    });
    await assert.rejects(client.start(), /Incompatible EasyTunnel protocol/);
  },
);

test(
  'client reports normal closure when stopped and abnormal closure on interruption',
  {
    timeout: 10000,
  },
  async (t) => {
    const server = createServer();
    const wss = new WebSocketServer({
      noServer: true,
    });
    const accepted = [];
    server.on('upgrade', (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (ws) => {
        accepted.push(ws);
        ws.send(
          JSON.stringify({
            type: 'ready',
            protocolVersion: 1,
            id: 'a'.repeat(32),
            secret: 'b'.repeat(32),
            url: 'https://example.test/',
          }),
        );
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => {
      for (const ws of wss.clients) {
        ws.terminate();
      }
      wss.close();
      server.close();
    });

    const client = new TunnelClient({
      server: `http://127.0.0.1:${server.address().port}`,
      token: 'secret',
      port: 5173,
      onReady: () => {},
      onError: () => {},
    });
    await client.start();
    const closed = once(accepted[0], 'close');
    client.close();
    const [code] = await closed;
    assert.equal(code, 1000);

    const interrupted = new TunnelClient({
      server: `http://127.0.0.1:${server.address().port}`,
      token: 'secret',
      port: 5173,
      onReady: () => {},
      onError: () => {},
    });
    await interrupted.start();
    const abruptClose = once(accepted[1], 'close');
    // Simulate transport loss without triggering the client's normal shutdown.
    interrupted.stopped = true;
    interrupted.control.terminate();
    const [abruptCode] = await abruptClose;
    assert.equal(abruptCode, 1006);
  },
);

test(
  'CLI sends a normal close when it receives SIGINT',
  {
    timeout: 10000,
    skip: process.platform === 'win32',
  },
  async (t) => {
    const server = createServer();
    const wss = new WebSocketServer({
      noServer: true,
    });
    let control;
    server.on('upgrade', (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (ws) => {
        control = ws;
        ws.send(
          JSON.stringify({
            type: 'ready',
            protocolVersion: 1,
            id: 'a'.repeat(32),
            secret: 'b'.repeat(32),
            url: 'https://example.test/',
          }),
        );
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const cwd = mkdtempSync(join(tmpdir(), 'easytunnel-signal-'));
    t.after(() => {
      for (const ws of wss.clients) {
        ws.terminate();
      }
      wss.close();
      server.close();
      rmSync(cwd, {
        recursive: true,
        force: true,
      });
    });
    const child = spawn(
      process.execPath,
      [
        resolve('node-client/bin/easytunnel.js'),
        '--server',
        `http://127.0.0.1:${server.address().port}`,
        '--src=5173',
      ],
      {
        cwd,
        env: {
          ...process.env,
          TUNNEL_TOKEN: 'secret',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    t.after(() => {
      if (child.exitCode === null) {
        child.kill('SIGKILL');
      }
    });
    await once(child.stdout, 'data');
    const closed = once(control, 'close');
    const exited = once(child, 'exit');
    child.kill('SIGINT');
    const [code] = await closed;
    const [exitCode] = await exited;
    assert.equal(code, 1000);
    assert.equal(exitCode, 0);
  },
);
