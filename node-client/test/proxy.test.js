import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { TunnelClient } from '../lib/client.js';
import { hasProxyEnvironment, createProxyAgent } from '../lib/proxy.js';

test('proxy is opt-in, honors NO_PROXY, and connects through the selected proxy', async (t) => {
  const names = ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy'];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  t.after(() => {
    for (const name of names) {
      if (previous[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = previous[name];
      }
    }
  });
  for (const name of names) {
    delete process.env[name];
  }
  assert.equal(hasProxyEnvironment(), false);
  const proxy = createServer();
  let connects = 0;
  proxy.on('connect', (req, socket) => {
    connects += 1;
    assert.equal(req.url, 'tunnel.example.com:443');
    socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n');
  });
  proxy.listen(0, '127.0.0.1');
  await once(proxy, 'listening');
  t.after(() => {
    proxy.close();
  });
  process.env.HTTPS_PROXY = `http://127.0.0.1:${proxy.address().port}`;
  assert.equal(hasProxyEnvironment(), true);
  const options = {
    server: 'https://tunnel.example.com',
    token: 'test',
    port: 3000,
    onError: () => {},
  };
  const direct = new TunnelClient(options);
  assert.equal(direct.agent, undefined);
  direct.close();
  const client = new TunnelClient({
    ...options,
    useProxy: true,
  });
  assert.ok(client.agent instanceof HttpsProxyAgent);
  await assert.rejects(client.start(), /407/);
  client.close();
  assert.equal(connects, 1);
  process.env.NO_PROXY = 'tunnel.example.com';
  assert.equal(createProxyAgent(new URL(options.server)), undefined);
});
