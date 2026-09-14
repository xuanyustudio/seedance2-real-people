'use strict';

/**
 * 解析 multipart/form-data 请求体（无 Express）。
 * @returns {Promise<{ fields: Record<string,string>, file?: { buffer: Buffer, filename: string, mime: string } }>}
 */
function parseMultipart(req, { maxBytes = 20 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const ctype = req.headers['content-type'] || '';
    const m = /multipart\/form-data;\s*boundary=(?:"([^"]+)"|([^;]+))/i.exec(ctype);
    if (!m) {
      reject(Object.assign(new Error('Content-Type 必须是 multipart/form-data'), { statusCode: 400 }));
      return;
    }
    const boundary = (m[1] || m[2] || '').trim();
    if (!boundary) {
      reject(Object.assign(new Error('缺少 multipart boundary'), { statusCode: 400 }));
      return;
    }

    const chunks = [];
    let total = 0;
    let settled = false;

    const fail = (err, code) => {
      if (settled) return;
      settled = true;
      if (code) err.statusCode = code;
      reject(err);
    };

    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        const mb = Math.round(maxBytes / (1024 * 1024));
        fail(new Error(`上传文件过大（上限 ${mb}MB）`), 413);
        return;
      }
      chunks.push(chunk);
    });

    req.on('error', (err) => fail(err, 400));

    req.on('end', () => {
      if (settled) return;
      try {
        const body = Buffer.concat(chunks);
        resolve(parseBody(body, boundary));
      } catch (err) {
        fail(err, err.statusCode || 400);
      }
    });
  });
}

function parseBody(body, boundary) {
  const delim = Buffer.from('--' + boundary);
  const fields = {};
  let file;

  let start = indexOf(body, delim, 0);
  if (start < 0) throw Object.assign(new Error('无效的 multipart 数据'), { statusCode: 400 });

  while (start >= 0) {
    start += delim.length;
    // 结尾 --boundary--
    if (body[start] === 0x2d && body[start + 1] === 0x2d) break;
    // 跳过 CRLF
    if (body[start] === 0x0d && body[start + 1] === 0x0a) start += 2;

    const next = indexOf(body, delim, start);
    const partEnd = next < 0 ? body.length : next;
    // part 内容在 start..partEnd，末尾通常带 CRLF
    let part = body.subarray(start, partEnd);
    if (part.length >= 2 && part[part.length - 2] === 0x0d && part[part.length - 1] === 0x0a) {
      part = part.subarray(0, part.length - 2);
    }

    const headerEnd = indexOf(part, Buffer.from('\r\n\r\n'), 0);
    if (headerEnd < 0) {
      start = next;
      continue;
    }
    const headerText = part.subarray(0, headerEnd).toString('utf8');
    const content = part.subarray(headerEnd + 4);
    const nameMatch = /name="([^"]+)"/i.exec(headerText);
    if (!nameMatch) {
      start = next;
      continue;
    }
    const name = nameMatch[1];
    const filenameMatch = /filename="([^"]*)"/i.exec(headerText);
    if (filenameMatch) {
      const mimeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headerText);
      const mime = (mimeMatch && mimeMatch[1].trim()) || 'application/octet-stream';
      if ((name === 'image' || name === 'file') && !file) {
        file = {
          buffer: Buffer.from(content),
          filename: filenameMatch[1] || 'upload.bin',
          mime,
          field: name,
        };
      }
    } else {
      fields[name] = content.toString('utf8');
    }
    start = next;
  }

  return { fields, file };
}

function indexOf(buf, pattern, from) {
  return buf.indexOf(pattern, from);
}

module.exports = { parseMultipart };
