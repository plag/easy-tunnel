import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { rewriteRequestHeaders } from '../lib/headers.js';

async function transform(parts, preserveHost = false) {
  const stream = rewriteRequestHeaders(5173, preserveHost);
  const chunks = [];
  stream.on('data', (chunk) => {
    return chunks.push(chunk);
  });
  for (const part of parts) {
    stream.write(part);
  }
  stream.end();
  await once(stream, 'end');
  return Buffer.concat(chunks);
}

test('rewrites only headers and retains a fragmented binary request body', async () => {
  const body = Buffer.from([0, 1, 255, 13, 10]);
  const result = await transform([
    Buffer.from('POST / HTTP/1.1\r\nHo'),
    Buffer.from(
      'st: abc.tunnel.example.com\r\nX-Forwarded-Host: forged\r\nContent-Length: 5\r\n\r\n',
    ),
    body,
  ]);
  const split = result.indexOf('\r\n\r\n');
  const headers = result.subarray(0, split).toString();
  assert.match(headers, /Host: localhost:5173\r\n/);
  assert.match(headers, /X-Forwarded-Host: abc\.tunnel\.example\.com/);
  assert.doesNotMatch(headers, /forged/);
  assert.deepEqual(result.subarray(split + 4), body);
});

test('preserves original bytes in preserve-host mode', async () => {
  const request = Buffer.from('GET / HTTP/1.1\r\nHost: abc.tunnel.example.com\r\n\r\n');
  assert.deepEqual(await transform([request], true), request);
});

test('rejects oversized or incomplete request headers', async () => {
  for (const parts of [[Buffer.from('A'.repeat(65537))], [Buffer.from('GET / HTTP/1.1\r\n')]]) {
    const stream = rewriteRequestHeaders(5173);
    const error = once(stream, 'error');
    for (const part of parts) {
      stream.write(part);
    }
    stream.end();
    assert.match((await error)[0].message, /headers/i);
  }
});
