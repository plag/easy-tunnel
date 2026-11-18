import net from 'node:net';
import WebSocket, { createWebSocketStream } from 'ws';
import { rewriteRequestHeaders } from './headers.js';
import { createProxyAgent } from './proxy.js';

const PROTOCOL_VERSION = 1;

function localConnection(port) {
  return new Promise((resolve, reject) => {
    const addresses = ['127.0.0.1', '::1'];
    let lastError;
    const tryNext = () => {
      const host = addresses.shift();
      if (!host) {
        return reject(lastError || new Error('Local server unavailable'));
      }
      const socket = net.createConnection({
        host,
        port,
        timeout: 5000,
      });
      const failed = (err) => {
        lastError = err;
        socket.destroy();
        tryNext();
      };
      socket.once('error', failed);
      socket.once('timeout', () => {
        return socket.destroy(new Error('Local connection timeout'));
      });
      socket.once('connect', () => {
        socket.setTimeout(0);
        socket.removeListener('error', failed);
        resolve(socket);
      });
    };
    tryNext();
  });
}

export class TunnelClient {
  constructor({
    server,
    token,
    port,
    preserveHost = false,
    useProxy = false,
    onReady = (url) => console.log(url),
    onError = console.error,
  }) {
    this.base = new URL(server);
    if (
      !['https:', 'http:'].includes(this.base.protocol) ||
      this.base.username ||
      this.base.password ||
      this.base.search ||
      this.base.hash ||
      !['', '/'].includes(this.base.pathname)
    ) {
      throw new Error('Server must be an HTTP(S) origin');
    }
    if (
      this.base.protocol === 'http:' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(this.base.hostname)
    ) {
      throw new Error('HTTP is allowed only for loopback testing; use HTTPS');
    }
    if (!token) {
      throw new Error('TUNNEL_TOKEN is required');
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('Invalid port');
    }
    this.agent = useProxy ? createProxyAgent(this.base) : undefined;
    this.token = token;
    this.port = port;
    this.preserveHost = preserveHost;
    this.onReady = onReady;
    this.onError = onError;
    this.connections = new Set();
    this.sessionController = new AbortController();
    this.stopped = false;

  }

  wsURL(path) {
    const url = new URL(path, this.base);
    url.protocol = this.base.protocol === 'https:' ? 'wss:' : 'ws:';
    return url;
  }

  start() {
    return new Promise((resolve, reject) => {
      const ws = (this.control = new WebSocket(this.wsURL('/_tunnel/control'), {
        agent: this.agent,
        headers: {
          Authorization: `Bearer ${this.token}`,
          'X-Easytunnel-Protocol': String(PROTOCOL_VERSION),
        },
        handshakeTimeout: 10000,
        perMessageDeflate: false,
        maxPayload: 4096,
      }));
      let ready = false;
      const onError = (err) => {
        if (!ready) {
          reject(new Error(`Cannot connect to tunnel server: ${err.message}`));
        } else {
          this.onError(`Tunnel connection error: ${err.message}`);
        }
      };
      ws.on('error', onError);
      ws.on('unexpected-response', (_request, response) => {
        response.resume();
        if (response.statusCode === 426) {
          reject(
            new Error(
              `Incompatible EasyTunnel protocol: server rejected client version ${PROTOCOL_VERSION}. Update the client or server.`,
            ),
          );
        } else {
          reject(new Error(`Cannot connect to tunnel server: HTTP ${response.statusCode}`));
        }
        ws.terminate();
      });
      ws.on('message', (data) => {
        let msg;
        try {
          msg = JSON.parse(data.toString());
        } catch {
          return;
        }
        if (!ready) {
          if (
            msg.type !== 'ready' ||
            !/^[a-f0-9]{32}$/.test(msg.id) ||
            !/^[a-f0-9]{32}$/.test(msg.secret) ||
            typeof msg.url !== 'string'
          ) {
            reject(new Error('Invalid tunnel session response'));
            ws.terminate();
            return;
          }
          if (msg.protocolVersion !== PROTOCOL_VERSION) {
            const actual =
              msg.protocolVersion === undefined ? 'not provided' : String(msg.protocolVersion);
            reject(
              new Error(
                `Incompatible EasyTunnel protocol: server ${actual}, client ${PROTOCOL_VERSION}. Update the client or server.`,
              ),
            );
            ws.terminate();
            return;
          }
          ready = true;
          this.session = msg;
          this.onReady(msg.url, this.sessionController.signal);
          resolve();
          return;
        }
        if (msg.type === 'open' && /^[a-f0-9]{32}$/.test(msg.id)) {
          void this.openStream(msg.id);
        }
      });
      ws.on('close', () => {
        this.sessionController.abort();
        clearInterval(this.heartbeat);
        for (const connection of this.connections) {
          if (connection instanceof WebSocket) {
            connection.terminate();
          } else {
            connection.destroy();
          }
        }
        this.connections.clear();
        if (!ready) {
          reject(new Error('Tunnel connection closed before session was ready'));
        } else if (!this.stopped) {
          this.onError('Tunnel disconnected; restart the client to obtain a new URL.');
          process.exitCode = 1;
        }
      });
      let alive = true;
      ws.on('pong', () => {
        alive = true;
      });
      this.heartbeat = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          return;
        }
        if (!alive) {
          ws.terminate();
          return;
        }
        alive = false;
        ws.ping();
      }, 20000);
      this.heartbeat.unref();
    });
  }

  async openStream(id) {
    let local;
    try {
      local = await localConnection(this.port);
    } catch {
      this.onError(
        `Cannot connect to localhost:${this.port}; check that your application is running.`,
      );
      return;
    }
    if (this.stopped || this.control.readyState !== WebSocket.OPEN) {
      local.destroy();
      return;
    }
    this.connections.add(local);
    local.once('close', () => {
      return this.connections.delete(local);
    });
    // Attach the listener immediately, including while the data socket connects.
    local.on('error', () => {});
    const ws = new WebSocket(this.wsURL('/_tunnel/data'), {
      agent: this.agent,
      headers: {
        'X-Tunnel-ID': this.session.id,
        'X-Tunnel-Secret': this.session.secret,
        'X-Tunnel-Request': id,
      },
      handshakeTimeout: 10000,
      perMessageDeflate: false,
    });
    this.connections.add(ws);
    ws.once('close', () => {
      return this.connections.delete(ws);
    });
    ws.on('error', (error) => {
      if (!this.stopped && this.control?.readyState === WebSocket.OPEN) {
        this.onError(`Cannot open tunnel data connection: ${error.message}`);
      }
      local.destroy();
    });
    ws.once('open', () => {
      if (this.stopped || local.destroyed || this.control.readyState !== WebSocket.OPEN) {
        ws.terminate();
        local.destroy();
        return;
      }
      // ws streams close without a status by default. The Go server treats only
      // normal WebSocket closure as EOF for close-delimited HTTP responses.
      const close = ws.close.bind(ws);
      ws.close = (code, reason) => {
        return close(code ?? 1000, reason);
      };
      const stream = createWebSocketStream(ws);
      const request = rewriteRequestHeaders(this.port, this.preserveHost);
      const fail = () => {
        local.destroy();
        stream.destroy();
      };
      stream.on('error', fail);
      request.on('error', fail);
      local.on('error', fail);
      stream.on('close', () => {
        return local.destroy();
      });
      // Node stream backpressure keeps uploads and responses bounded.
      stream.pipe(request).pipe(local);
      local.pipe(stream);
    });
  }

  close() {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    this.sessionController.abort();
    clearInterval(this.heartbeat);
    for (const connection of this.connections) {
      if (connection instanceof WebSocket) {
        connection.terminate();
      } else {
        connection.destroy();
      }
    }
    this.connections.clear();
    if (this.control?.readyState === WebSocket.OPEN) {
      this.control.close(1000, 'client shutdown');
    } else if (this.control?.readyState === WebSocket.CONNECTING) {
      this.control.terminate();
    }
  }
}
