'use strict';
// Minimal multipart/form-data parser (zero-dependency). Handles 1..n file + field parts.

function parseMultipart(req, maxBytes = 30 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const ct = req.headers['content-type'] || '';
    const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ct);
    if (!m) return reject(new Error('Expected multipart/form-data body'));
    const boundary = Buffer.from('--' + (m[1] || m[2]).trim());
    const chunks = [];
    let size = 0;
    let rejected = false;
    req.on('data', (c) => {
      if (rejected) return;
      size += c.length;
      if (size > maxBytes) {
        rejected = true;
        reject(new Error('Payload too large (limit is about 25 MB)'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('error', (e) => { if (!rejected) reject(e); });
    req.on('end', () => {
      if (rejected) return;
      try {
        const buf = Buffer.concat(chunks);
        const parts = [];
        let start = 0;
        for (;;) {
          const i = buf.indexOf(boundary, start);
          if (i === -1) break;
          const j = buf.indexOf(boundary, i + boundary.length);
          if (j === -1) break;
          let head = i + boundary.length;
          if (buf[head] === 0x0d && buf[head + 1] === 0x0a) head += 2;
          const end = j - 2; // strip trailing CRLF before next boundary
          if (end > head) {
            const part = buf.slice(head, end);
            const sep = part.indexOf('\r\n\r\n');
            if (sep !== -1) {
              const headerBlock = part.slice(0, sep).toString('utf8');
              const data = part.slice(sep + 4);
              const h = {};
              for (const line of headerBlock.split('\r\n')) {
                const k = line.indexOf(':');
                if (k > -1) h[line.slice(0, k).trim().toLowerCase()] = line.slice(k + 1).trim();
              }
              const cd = h['content-disposition'] || '';
              const nameM = /name="([^"]*)"/.exec(cd);
              const fileM = /filename="([^"]*)"/.exec(cd);
              parts.push({
                name: nameM ? nameM[1] : '',
                filename: fileM ? decodeURIComponent(fileM[1]) : '',
                contentType: h['content-type'] || '',
                data,
              });
            }
          }
          start = j;
        }
        resolve({ parts });
      } catch (e) {
        reject(e);
      }
    });
  });
}

module.exports = { parseMultipart };
