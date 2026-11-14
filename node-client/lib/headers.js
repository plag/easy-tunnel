import { Transform } from 'node:stream';

const MAX_HEADERS = 64 * 1024;

// A tunnel data connection carries one HTTP request, then possibly WebSocket data.
export function rewriteRequestHeaders(port, preserveHost = false) {
  let pending = Buffer.alloc(0);
  let finished = preserveHost;
  return new Transform({
    transform(chunk, encoding, callback) {
      if (finished) {
        return callback(null, chunk);
      }
      pending = Buffer.concat([pending, chunk]);
      const end = pending.indexOf('\r\n\r\n');
      if (end < 0) {
        if (pending.length > MAX_HEADERS) {
          return callback(new Error('HTTP headers exceed 64 KiB'));
        }
        return callback();
      }
      if (end + 4 > MAX_HEADERS) {
        return callback(new Error('HTTP headers exceed 64 KiB'));
      }
      const lines = pending.subarray(0, end).toString('latin1').split('\r\n');
      const output = [lines.shift()];
      let host;
      for (const line of lines) {
        const i = line.indexOf(':');
        if (i < 1) {
          return callback(new Error('Invalid HTTP header'));
        }
        const name = line.slice(0, i).toLowerCase();
        if (name === 'host') {
          if (host !== undefined) {
            return callback(new Error('Duplicate Host header'));
          }
          host = line.slice(i + 1).trim();
        } else if (name !== 'x-forwarded-host') {
          output.push(line);
        }
      }
      if (!host) {
        return callback(new Error('Missing Host header'));
      }
      output.push(`Host: localhost:${port}`, `X-Forwarded-Host: ${host}`, '', '');
      this.push(Buffer.from(output.join('\r\n'), 'latin1'));
      this.push(pending.subarray(end + 4));
      pending = null;
      finished = true;
      callback();
    },
    flush(callback) {
      callback(finished ? undefined : new Error('Incomplete HTTP headers'));
    },
  });
}
