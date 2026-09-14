'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

const MAX_BYTES = 20 * 1024 * 1024;
const TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 3;

function err(message, statusCode) {
  return Object.assign(new Error(message), { statusCode });
}

function looksLikeImage(mime, urlPath) {
  const m = String(mime || '').toLowerCase().split(';')[0].trim();
  if (m === 'image/jpeg' || m === 'image/jpg' || m === 'image/png' || m === 'image/webp') return true;
  const p = String(urlPath || '').toLowerCase();
  return /\.(jpe?g|png|webp)(\?|$)/i.test(p);
}

/**
 * @param {string} imageUrl
 * @param {{ maxBytes?: number, timeoutMs?: number, maxRedirects?: number }} [opts]
 * @returns {Promise<{ buffer: Buffer, mime: string, httpStatus: number, bytes: number, finalUrl: string }>}
 */
function fetchImage(imageUrl, opts = {}) {
  const maxBytes = opts.maxBytes != null ? opts.maxBytes : MAX_BYTES;
  const timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : TIMEOUT_MS;
  const maxRedirects = opts.maxRedirects != null ? opts.maxRedirects : MAX_REDIRECTS;

  const raw = String(imageUrl == null ? '' : imageUrl).trim();
  if (!raw) throw err('imageUrl 仅支持 http/https', 400);

  return fetchOnce(raw, { maxBytes, timeoutMs, maxRedirects, redirectsLeft: maxRedirects });
}

function fetchOnce(imageUrl, ctx) {
  let parsed;
  try {
    parsed = new URL(imageUrl);
  } catch (_) {
    return Promise.reject(err('imageUrl 仅支持 http/https', 400));
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return Promise.reject(err('imageUrl 仅支持 http/https', 400));
  }

  const lib = parsed.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (e) => {
      if (settled) return;
      settled = true;
      reject(e);
    };

    const req = lib.get(
      imageUrl,
      {
        timeout: ctx.timeoutMs,
        headers: { Accept: 'image/jpeg,image/png,image/webp,*/*', 'User-Agent': 'seedance2-detect/1.0' },
      },
      (res) => {
        const status = res.statusCode || 0;

        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (ctx.redirectsLeft <= 0) {
            fail(err('下载失败：重定向过多', 502));
            return;
          }
          let next;
          try {
            next = new URL(res.headers.location, imageUrl).toString();
          } catch (_) {
            fail(err('下载失败：无效重定向', 502));
            return;
          }
          fetchOnce(next, { ...ctx, redirectsLeft: ctx.redirectsLeft - 1 }).then(resolve, fail);
          return;
        }

        if (status < 200 || status >= 300) {
          res.resume();
          fail(err(`下载失败，HTTP ${status}`, 502));
          return;
        }

        const mime = (res.headers['content-type'] || '').toString();
        const len = Number(res.headers['content-length']);
        if (Number.isFinite(len) && len > ctx.maxBytes) {
          res.destroy();
          fail(err('图片过大（上限 20MB）', 413));
          return;
        }

        const chunks = [];
        let total = 0;
        res.on('data', (chunk) => {
          total += chunk.length;
          if (total > ctx.maxBytes) {
            res.destroy();
            fail(err('图片过大（上限 20MB）', 413));
            return;
          }
          chunks.push(chunk);
        });
        res.on('error', (e) => fail(Object.assign(e, { statusCode: 502 })));
        res.on('end', () => {
          if (settled) return;
          const buffer = Buffer.concat(chunks);
          if (!looksLikeImage(mime, parsed.pathname) && !looksLikeImage(mime, imageUrl)) {
            fail(err('仅支持 jpeg / png / webp 图片', 400));
            return;
          }
          settled = true;
          resolve({
            buffer,
            mime: mime || 'application/octet-stream',
            httpStatus: status,
            bytes: buffer.length,
            finalUrl: imageUrl,
          });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      fail(err('下载图片超时', 504));
    });
    req.on('error', (e) => {
      if (e.code === 'ERR_STREAM_PREMATURE_CLOSE') return;
      fail(Object.assign(new Error(e.message || String(e)), { statusCode: 502 }));
    });
  });
}

module.exports = { fetchImage, MAX_BYTES, TIMEOUT_MS };
