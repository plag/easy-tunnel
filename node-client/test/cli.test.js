import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const cli = resolve('node-client/bin/easytunnel.js');

test('accepts --src and validates the port while preserving the positional form', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'easytunnel-cli-'));
  t.after(() => {
    rmSync(cwd, {
      recursive: true,
      force: true,
    });
  });
  const env = {
    ...process.env,
    TUNNEL_TOKEN: '',
  };

  function run(args) {
    return spawnSync(process.execPath, [cli, ...args], {
      cwd,
      env,
      encoding: 'utf8',
      timeout: 5000,
    });
  }

  for (const args of [['--src=5173'], ['--src', '5173'], ['5173']]) {
    const result = run(['--server=https://example.com', ...args]);
    assert.match(result.stderr, /TUNNEL_TOKEN is required/);
  }

  for (const args of [
    [],
    ['--src='],
    ['--src=abc'],
    ['--src=0'],
    ['--src=65536'],
    ['--src=5173', '3000'],
  ]) {
    const result = run(args);
    assert.match(result.stdout, /Usage:/);
  }
});

test('reads JSON config and does not load application .env', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'easytunnel-config-'));
  t.after(() => {
    rmSync(cwd, {
      recursive: true,
      force: true,
    });
  });
  const env = {
    ...process.env,
  };
  delete env.TUNNEL_TOKEN;

  function run(args) {
    return spawnSync(process.execPath, [cli, ...args], {
      cwd,
      env,
      encoding: 'utf8',
      timeout: 5000,
    });
  }

  writeFileSync(join(cwd, '.env'), 'TUNNEL_TOKEN=should-not-be-loaded\n');
  let result = run(['--server=https://example.com', '--src=5173']);
  assert.match(result.stderr, /TUNNEL_TOKEN is required/);

  writeFileSync(
    join(cwd, 'easy-tunnel-config.json'),
    '{"server":"https://example.com","src":5173}',
  );
  result = run([]);
  assert.match(result.stderr, /TUNNEL_TOKEN is required/);

  writeFileSync(join(cwd, 'easy-tunnel-config.json'), '{invalid');
  result = run(['--src=5173']);
  assert.match(result.stderr, /Invalid JSON/);
});

test('requires an explicit server address', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'easytunnel-cli-'));
  t.after(() => {
    rmSync(cwd, {
      recursive: true,
      force: true,
    });
  });
  const result = spawnSync(process.execPath, [cli, '--src=5173'], {
    cwd,
    env: {
      ...process.env,
      TUNNEL_TOKEN: 'test',
    },
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Server URL is required/);
});

test('warns about proxy variables unless --use-proxy is passed', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'easytunnel-proxy-cli-'));
  t.after(() => {
    rmSync(cwd, {
      recursive: true,
      force: true,
    });
  });
  const env = {
    ...process.env,
    HTTPS_PROXY: 'http://user:secret@proxy.example.com:8080',
    TUNNEL_TOKEN: '',
  };
  const options = {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 5000,
  };
  const args = ['--server=https://example.com', '--src=5173'];
  const direct = spawnSync(process.execPath, [cli, ...args], options);
  assert.match(direct.stderr, /proxy environment variables are set but ignored/);
  assert.match(direct.stderr, /--use-proxy/);
  assert.doesNotMatch(direct.stderr, /secret/);
  const proxied = spawnSync(process.execPath, [cli, ...args, '--use-proxy'], options);
  assert.doesNotMatch(proxied.stderr, /proxy environment variables are set but ignored/);
  assert.match(proxied.stderr, /TUNNEL_TOKEN is required/);
});
