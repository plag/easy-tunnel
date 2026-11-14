import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../lib/config.js';

test('loads an optional JSON config and validates settings', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'easytunnel-config-'));
  t.after(() => {
    rmSync(cwd, {
      recursive: true,
      force: true,
    });
  });
  assert.deepEqual(loadConfig(cwd), {});
  const path = join(cwd, 'easy-tunnel-config.json');
  const config = {
    server: 'https://example.org',
    src: 5173,
    token: 'test',
    preserveHost: true,
  };
  writeFileSync(path, JSON.stringify(config));
  assert.deepEqual(loadConfig(cwd), config);

  for (const invalid of [
    null,
    [],
    { src: '5173' },
    { src: 0 },
    { token: 3 },
    { preserveHost: 'yes' },
    { server: false },
  ]) {
    writeFileSync(path, JSON.stringify(invalid));
    assert.throws(() => loadConfig(cwd));
  }
  writeFileSync(path, '{invalid');
  assert.throws(() => loadConfig(cwd), /Invalid JSON/);
});
