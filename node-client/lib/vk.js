export async function updateTestGroupURL({ vkServiceToken, testGroupName }, url, sessionSignal) {
  const signal = AbortSignal.any([sessionSignal, AbortSignal.timeout(10000)]);

  async function call(method, params = {}) {
    const result = await fetch(`https://api.vk.com/method/apps.${method}`, {
      method: 'POST',
      redirect: 'error',
      body: new URLSearchParams({ ...params, v: '5.199', access_token: vkServiceToken }),
      signal,
    });
    if (!result.ok) throw new Error(`VK API: HTTP ${result.status}`);
    let data;
    try {
      data = await result.json();
    } catch (error) {
      signal.throwIfAborted();
      throw new Error('VK вернул некорректный JSON', { cause: error });
    }
    if (data?.error) {
      // VK errors can echo request parameters, including credentials.
      const code = data.error.error_code;
      throw new Error(`VK API: ${method}, код ${Number.isInteger(code) ? code : 'неизвестен'}`);
    }
    return data?.response;
  }

  const groups = await call('getTestingGroups');
  if (!Array.isArray(groups)) throw new Error('VK вернул некорректный список групп');
  const matches = groups.filter((group) => group?.name === testGroupName);
  if (!matches.length) throw new Error('группа не найдена');
  if (matches.length > 1) throw new Error('найдено несколько групп с таким именем');

  const [group] = matches;
  if (group.webview === url) return false;
  if (!Number.isSafeInteger(group.group_id) || group.group_id <= 0 ||
      !Array.isArray(group.platforms) || !group.platforms.length ||
      !group.platforms.every((value) => typeof value === 'string' && value.length > 0)) {
    throw new Error('VK вернул некорректный ID или список платформ группы');
  }
  const response = await call('updateMetaForTestingGroup', {
    group_id: String(group.group_id),
    name: group.name,
    platforms: group.platforms.join(','),
    webview: url,
  });
  if (response?.group_id !== group.group_id) throw new Error('VK не подтвердил обновление группы');
  const savedGroups = await call('getTestingGroups', { group_id: String(group.group_id) });
  const saved = Array.isArray(savedGroups) && savedGroups.find(item => item?.group_id === group.group_id);
  if (!saved || saved.name !== testGroupName || saved.webview !== url) {
    throw new Error('после записи VK не вернул ожидаемый URL для этой группы');
  }
  return true;
}
