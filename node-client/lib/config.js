import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CONFIG_FILE = 'easy-tunnel-config.json';

export function loadConfig(directory = process.cwd()) {
  let content;
  try {
    content = readFileSync(join(directory, CONFIG_FILE), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {};
    }
    throw new Error(`Cannot read ${CONFIG_FILE}; check file permissions.`);
  }

  let config;
  try {
    config = JSON.parse(content);
  } catch {
    throw new Error(`Invalid JSON in ${CONFIG_FILE}.`);
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`${CONFIG_FILE} must contain a JSON object.`);
  }
  if (config.token !== undefined && typeof config.token !== 'string') {
    throw new Error('Config token must be a string.');
  }
  if (config.server !== undefined && typeof config.server !== 'string') {
    throw new Error('Config server must be a string.');
  }
  if (
    config.src !== undefined &&
    (!Number.isInteger(config.src) || config.src < 1 || config.src > 65535)
  ) {
    throw new Error('Config src must be an integer between 1 and 65535.');
  }
  if (config.preserveHost !== undefined && typeof config.preserveHost !== 'boolean') {
    throw new Error('Config preserveHost must be a boolean.');
  }
  if (config.vkServiceToken !== undefined || config.testGroupName !== undefined) {
    for (const field of ['vkServiceToken', 'testGroupName']) {
      if (typeof config[field] !== 'string' || !config[field].trim()) {
        throw new Error(`Set ${field} to a non-empty string in ${CONFIG_FILE} to update a VK test group.`);
      }
    }
  }
  return config;
}
