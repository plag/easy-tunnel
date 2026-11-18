import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateTestGroupURL } from '../lib/vk.js';

const config = { vkServiceToken: 'service-token', testGroupName: 's' };
const url = 'https://public.example.org';
const group = { group_id: 2, name: 's', platforms: ['web', 'android'], user_ids: [123] };

function mockVK(t, ...responses) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (endpoint, options) => {
    calls.push({ endpoint, ...options });
    assert.ok(responses.length, 'unexpected VK request');
    return Response.json(responses.shift());
  });
  return calls;
}

test('updates the named group, preserving platforms and omitting users', async (t) => {
  const calls = mockVK(t, { response: [{ ...group, name: 'S' }, group] }, { response: { group_id: 2 } });
  assert.equal(await updateTestGroupURL(config, url, new AbortController().signal), true);
  assert.deepEqual(calls.map(call => call.endpoint), [
    'https://api.vk.com/method/apps.getTestingGroups',
    'https://api.vk.com/method/apps.updateMetaForTestingGroup',
  ]);
  for (const call of calls) {
    assert.equal(call.method, 'POST');
    assert.equal(call.redirect, 'error');
  }
  assert.deepEqual(Object.fromEntries(calls[1].body), {
    access_token: 'service-token', v: '5.199', group_id: '2', name: 's',
    platforms: 'web,android', webview: url,
  });
});

test('skips a write if the group already uses the URL', async (t) => {
  const calls = mockVK(t, { response: [{ ...group, webview: url }] });
  assert.equal(await updateTestGroupURL(config, url, new AbortController().signal), false);
  assert.equal(calls.length, 1);
});

for (const [label, groups, reason] of [
  ['missing group', [], /не найдена/],
  ['duplicate name', [group, { ...group, group_id: 3 }], /несколько групп/],
  ['missing ID', [{ ...group, group_id: undefined }], /ID/],
  ['missing platforms', [{ ...group, platforms: null }], /платформ/],
]) {
  test(label, async (t) => {
    const calls = mockVK(t, { response: groups });
    await assert.rejects(updateTestGroupURL(config, url, new AbortController().signal), reason);
    assert.equal(calls.length, 1);
  });
}

test('rejects VK errors without logging credentials from the response', async (t) => {
  mockVK(t, { response: [group] }, { error: { error_code: 5, error_msg: config.vkServiceToken } });
  await assert.rejects(updateTestGroupURL(config, url, new AbortController().signal), {
    message: 'VK API: updateMetaForTestingGroup, код 5',
  });
});

test('requires confirmation for the same group', async (t) => {
  mockVK(t, { response: [group] }, { response: { group_id: 3 } });
  await assert.rejects(updateTestGroupURL(config, url, new AbortController().signal), /не подтвердил/);
});
