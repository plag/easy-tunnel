import { HttpsProxyAgent } from 'https-proxy-agent';
import { getProxyForUrl } from 'proxy-from-env';

const proxyVariables = [
  'HTTP_PROXY',
  'http_proxy',
  'HTTPS_PROXY',
  'https_proxy',
  'ALL_PROXY',
  'all_proxy',
];

export function hasProxyEnvironment() {
  return proxyVariables.some((name) => {
    return Boolean(process.env[name]);
  });
}

export function createProxyAgent(server) {
  if (server.protocol !== 'https:') {
    return undefined;
  }
  const proxy = getProxyForUrl(server.toString());
  if (!proxy) {
    return undefined;
  }
  return new HttpsProxyAgent(proxy);
}
