// ============================================================
//  OpenCV Haar 眼睛遮挡 API —— 本地 Node.js HTTP 服务
//  POST /api/detect  上传图片，返回遮挡后的 HTTP URL
//  POST /api/upload  图床（图片/音频/视频，零处理）
//  GET  /api/proxy/image/:file  图床文件读取
//  运行：node server.js  或  npm start
// ============================================================
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const detect = require('./lib/detect-eyes');
const { parseMultipart } = require('./lib/multipart');
const { fetchImage } = require('./lib/fetch-image');
const { todayStamp, purgeOldDateDirs } = require('./lib/retention');
const { Perf, writePerfLog } = require('./lib/perf');
const hosting = require('./lib/hosting');

const ROOT = path.resolve(__dirname);
const PORT = Number(process.env.PORT) || 8060;
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS) || 30;
const DATA_IN = path.join(ROOT, 'data', 'in');
const DATA_OUT = path.join(ROOT, 'data', 'out');
const DATA_LOGS = path.join(ROOT, 'data', 'logs');
const DATA_UPLOAD = path.join(ROOT, 'data', 'upload');
const DATA_UPLOAD_INDEX = path.join(DATA_UPLOAD, '_index');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.xml': 'application/xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.json': 'application/json',
};

function resolveSafe(urlPath) {
  let rel = decodeURIComponent((urlPath || '/').split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  rel = rel.replace(/^\/+/, '').replace(/\\/g, '/');
  if (rel.includes('\0') || rel.split('/').includes('..')) return null;

  const filePath = path.resolve(ROOT, rel);
  const rootWithSep = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep;
  if (filePath !== ROOT && !filePath.startsWith(rootWithSep)) return null;
  return filePath;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache',
    ...corsHeaders(),
  });
  res.end(body);
}

function truthy(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

/** 布尔表单字段；缺省返回 defaultVal；支持 0/false/no 关、1/true/yes 开 */
function parseFlag(v, defaultVal) {
  if (v == null || String(v).trim() === '') return defaultVal;
  const s = String(v).trim().toLowerCase();
  if (s === '0' || s === 'false' || s === 'no') return false;
  if (s === '1' || s === 'true' || s === 'yes') return true;
  return defaultVal;
}

/** 遮挡框大小 1–10，默认 5（不依赖 lib 导出，避免部署漏文件） */
function parseSize(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 5;
  return Math.max(1, Math.min(10, Math.round(n)));
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function purgeData() {
  ensureDir(DATA_IN);
  ensureDir(DATA_OUT);
  ensureDir(DATA_UPLOAD);
  ensureDir(DATA_UPLOAD_INDEX);
  purgeOldDateDirs(DATA_IN, RETENTION_DAYS);
  purgeOldDateDirs(DATA_OUT, RETENTION_DAYS);
  purgeUploadDirs();
}

/** 清理 data/upload/{tokenHash}/YYYY-MM-DD 过期目录，并去掉失效索引 */
function purgeUploadDirs() {
  if (!fs.existsSync(DATA_UPLOAD)) return;
  for (const name of fs.readdirSync(DATA_UPLOAD)) {
    if (name.startsWith('_') || name.startsWith('.')) continue;
    const full = path.join(DATA_UPLOAD, name);
    let st;
    try {
      st = fs.statSync(full);
    } catch (_) {
      continue;
    }
    if (!st.isDirectory()) continue;
    purgeOldDateDirs(full, RETENTION_DAYS);
  }
}

function publicBase(req) {
  const host = req.headers.host || `localhost:${PORT}`;
  const proto = (req.headers['x-forwarded-proto'] || 'http').toString().split(',')[0].trim();
  return `${proto}://${host}`;
}

function extractBearer(req) {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(\S+)/i.exec(h);
  return m ? m[1] : '';
}

function tokenFolder(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex').slice(0, 16);
}

function resolveUploadFile(id, ext) {
  const indexPath = path.join(DATA_UPLOAD_INDEX, id);
  if (!fs.existsSync(indexPath)) return null;
  let rel;
  try {
    rel = fs.readFileSync(indexPath, 'utf8').trim();
  } catch (_) {
    return null;
  }
  if (!rel || rel.includes('..') || rel.includes('\0') || path.isAbsolute(rel)) return null;
  const filePath = path.resolve(DATA_UPLOAD, rel);
  const rootWithSep = DATA_UPLOAD.endsWith(path.sep) ? DATA_UPLOAD : DATA_UPLOAD + path.sep;
  if (!filePath.startsWith(rootWithSep)) return null;
  if (path.extname(filePath).toLowerCase() !== ext.toLowerCase()) return null;
  if (!fs.existsSync(filePath)) return null;
  return filePath;
}

async function handleUpload(req, res) {
  try {
    const token = extractBearer(req);
    if (!token) {
      sendJson(res, 401, { error: '缺少 Authorization: Bearer <token>' });
      return;
    }

    purgeData();

    const { file } = await parseMultipart(req, { maxBytes: hosting.LIMITS.video });
    if (!file || !file.buffer || !file.buffer.length) {
      sendJson(res, 400, { error: '缺少文件字段 file' });
      return;
    }

    const meta = hosting.resolveUploadMeta(file);
    if (meta.error) {
      sendJson(res, meta.statusCode || 400, { error: meta.error });
      return;
    }

    const date = todayStamp();
    const id = crypto.randomBytes(16).toString('hex');
    const tokenHash = tokenFolder(token);
    const dir = path.join(DATA_UPLOAD, tokenHash, date);
    ensureDir(dir);
    ensureDir(DATA_UPLOAD_INDEX);

    const filename = id + meta.ext;
    const absPath = path.join(dir, filename);
    fs.writeFileSync(absPath, file.buffer);

    const rel = path.join(tokenHash, date, filename).split(path.sep).join('/');
    fs.writeFileSync(path.join(DATA_UPLOAD_INDEX, id), rel, 'utf8');

    const created = Date.now();
    const base = publicBase(req);
    sendJson(res, 200, {
      url: `${base}/api/proxy/image/${filename}`,
      created,
    });
  } catch (err) {
    const code = err && err.statusCode ? err.statusCode : 500;
    sendJson(res, code, { error: (err && err.message) || String(err) });
  }
}

function handleProxyImage(req, res, filename) {
  const safe = path.basename(filename || '');
  if (!safe || safe !== filename || safe.includes('\0')) {
    res.writeHead(400, corsHeaders());
    res.end('Bad Request');
    return;
  }
  const ext = path.extname(safe).toLowerCase();
  const id = path.basename(safe, ext);
  if (!/^[a-f0-9]{32}$/i.test(id) || !hosting.kindOfExt(ext)) {
    res.writeHead(404, corsHeaders());
    res.end('Not Found');
    return;
  }

  const filePath = resolveUploadFile(id, ext);
  if (!filePath) {
    res.writeHead(404, corsHeaders());
    res.end('Not Found');
    return;
  }

  fs.stat(filePath, (statErr, st) => {
    if (statErr || !st.isFile()) {
      res.writeHead(404, corsHeaders());
      res.end('Not Found');
      return;
    }
    const headers = {
      'Content-Type': hosting.mimeForExt(ext),
      'Content-Length': st.size,
      'Cache-Control': 'public, max-age=31536000',
      ...corsHeaders(),
    };
    if (req.method === 'HEAD') {
      res.writeHead(200, headers);
      res.end();
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, corsHeaders());
        res.end('Not Found');
        return;
      }
      res.writeHead(200, headers);
      res.end(data);
    });
  });
}

async function handleDetect(req, res) {
  const perf = new Perf();
  const date = todayStamp();
  let id = null;
  let source = 'upload';
  let imageUrl = '';
  let httpStatus = null;

  function logFail(errorMsg) {
    const rec = {
      ts: new Date().toISOString(),
      date,
      id,
      ok: false,
      source,
      error: errorMsg,
      timings: perf.snapshot(),
    };
    if (source === 'url') {
      if (imageUrl) rec.imageUrl = imageUrl;
      if (httpStatus != null) rec.httpStatus = httpStatus;
    }
    writePerfLog(DATA_LOGS, rec);
  }

  try {
    perf.start('purge');
    purgeData();
    perf.end('purge');

    perf.start('upload');
    const { fields, file } = await parseMultipart(req);
    perf.end('upload');

    imageUrl = String((fields && fields.imageUrl) || '').trim();
    const hasFile = !!(file && file.buffer && file.buffer.length);
    const hasUrl = !!imageUrl;

    if (hasFile && hasUrl) {
      sendJson(res, 400, { ok: false, error: '请只提供 image 或 imageUrl 其中之一，不要同时传' });
      return;
    }
    if (!hasFile && !hasUrl) {
      sendJson(res, 400, { ok: false, error: '请提供 image 文件或 imageUrl' });
      return;
    }

    let buffer;
    let mimeOrExt;

    if (hasFile) {
      buffer = file.buffer;
      mimeOrExt = detect.normalizeExt(file.mime) || detect.normalizeExt(file.filename);
    } else {
      perf.start('download');
      let downloaded;
      try {
        downloaded = await fetchImage(imageUrl);
      } catch (e) {
        if (e && e.httpStatus != null) httpStatus = e.httpStatus;
        source = 'url';
        throw e;
      } finally {
        perf.end('download');
      }
      buffer = downloaded.buffer;
      mimeOrExt = detect.normalizeExt(downloaded.mime) || detect.normalizeExt(imageUrl);
      source = 'url';
      httpStatus = downloaded.httpStatus;
    }

    if (!mimeOrExt) {
      const msg = '仅支持 jpeg / png / webp 图片';
      logFail(msg);
      sendJson(res, 400, { ok: false, error: msg });
      return;
    }
    const ext = mimeOrExt;

    id = crypto.randomBytes(8).toString('hex');
    const inDir = path.join(DATA_IN, date);
    const outDir = path.join(DATA_OUT, date);
    ensureDir(inDir);
    ensureDir(outDir);

    perf.start('save.in');
    const inPath = path.join(inDir, id + ext);
    fs.writeFileSync(inPath, buffer);
    perf.end('save.in');

    const size = parseSize(fields.size);
    const singleEye = parseFlag(fields.singleEye, true);
    let detector;
    try {
      detector = detect.normalizeDetector(fields.detector);
    } catch (e) {
      const msg = (e && e.message) || String(e);
      logFail(msg);
      sendJson(res, e.statusCode || 400, { ok: false, error: msg });
      return;
    }
    const result = await detect.processBuffer(buffer, {
      noFace: truthy(fields.noFace),
      singleEye,
      mimeOrExt: ext,
      size,
      detector,
      perf,
    });

    perf.start('save.out');
    const outPath = path.join(outDir, id + result.ext);
    fs.writeFileSync(outPath, result.outBuffer);
    perf.end('save.out');

    const timings = perf.snapshot();
    const base = publicBase(req);
    const payload = {
      ok: true,
      id,
      date,
      eyeCount: result.eyeCount,
      size: result.size != null ? result.size : size,
      singleEye: result.singleEye !== false,
      detector: result.detector || detector,
      url: `${base}/data/out/${date}/${id}${result.ext}`,
      inputUrl: `${base}/data/in/${date}/${id}${ext}`,
      timings,
      faceCounts: result.faceCounts || null,
    };
    if (source === 'url') {
      payload.source = 'url';
      payload.imageUrl = imageUrl;
    }

    writePerfLog(DATA_LOGS, {
      ts: new Date().toISOString(),
      date,
      id,
      ok: true,
      source,
      ...(source === 'url' ? { imageUrl, httpStatus } : {}),
      bytesIn: buffer.length,
      bytesOut: result.outBuffer.length,
      width: result.width,
      height: result.height,
      ext: result.ext,
      eyeCount: result.eyeCount,
      size: payload.size,
      singleEye: payload.singleEye,
      detector: payload.detector,
      noFace: truthy(fields.noFace),
      faceCounts: result.faceCounts || null,
      timings,
    });

    sendJson(res, 200, payload);
  } catch (err) {
    const code = err && err.statusCode ? err.statusCode : 500;
    const msg = (err && err.message) || String(err);
    logFail(msg);
    sendJson(res, code, { ok: false, error: msg, timings: perf.snapshot() });
  }
}

function serveStatic(req, res) {
  const filePath = resolveSafe(req.url || '/');
  if (!filePath) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      ...corsHeaders(),
    });
    res.end(data);
  });
}

async function main() {
  try {
    detect.init();
  } catch (err) {
    console.error('[错误] OpenCV 初始化失败:', err.message || err);
    process.exit(1);
  }

  const onnxOk = await detect.initOnnx();
  if (onnxOk) {
    console.log('[info] YuNet(onnx) 已就绪，默认 detector=onnx');
  } else {
    console.warn('[warn] YuNet 模型未加载，默认 detector=haar（可显式传 detector=haar）');
  }

  purgeData();

  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        ...corsHeaders(),
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return;
    }
    if (req.method === 'POST' && urlPath === '/api/detect') {
      handleDetect(req, res);
      return;
    }
    if (req.method === 'POST' && urlPath === '/api/upload') {
      handleUpload(req, res);
      return;
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      const proxyMatch = /^\/api\/proxy\/image\/([^/]+)$/.exec(urlPath);
      if (proxyMatch) {
        handleProxyImage(req, res, proxyMatch[1]);
        return;
      }
      serveStatic(req, res);
      return;
    }
    sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
  });

  server.listen(PORT, () => {
    console.log(`眼睛遮挡 API 已启动: http://localhost:${PORT}`);
    console.log(`POST /api/detect  image 或 imageUrl（可选 detector / noFace / singleEye / size）`);
    console.log(`POST /api/upload  图床（Bearer token + file；图片/音频/视频）`);
    console.log(`GET  /api/proxy/image/{id}.ext`);
    console.log(`结果保留 ${RETENTION_DAYS} 天（RETENTION_DAYS）`);
  });
}

main().catch((err) => {
  console.error('[错误] 启动失败:', err.message || err);
  process.exit(1);
});
