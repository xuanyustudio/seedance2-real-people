# detect imageUrl 下载支持 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 `POST /api/detect` 在保留文件上传的前提下，支持 multipart 字段 `imageUrl`（服务端下载后走现有检测+WebP），写增强日志，并同步首页/`docs/API.md`/`README`。

**Architecture:** 新增 `lib/fetch-image.js` 专责下载；`handleDetect` 校验 `image`/`imageUrl` 二选一后汇合到现有 `processBuffer`。检测接口上传与下载统一 20MB；图床不动。上传模式响应字段与现网一致。

**Tech Stack:** Node.js 内置 `http`/`https`；现有 `multipart.js`、`detect-eyes.js`、`perf.js`；无新 npm 依赖。

**Spec:** `docs/superpowers/specs/2026-09-15-detect-imageurl-design.md`

---

### Task 1: `lib/fetch-image.js` 下载模块

**Files:**
- Create: `lib/fetch-image.js`
- Create: `scripts/smoke-fetch-image.js`（临时冒烟，Task 结束后可保留作手动脚本）

**Step 1: 实现 `lib/fetch-image.js`**

```js
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
```

**Step 2: 冒烟（协议校验）**

Run (PowerShell，仓库根目录):

```powershell
node -e "const {fetchImage}=require('./lib/fetch-image'); fetchImage('ftp://x').then(()=>console.log('bad')).catch(e=>console.log(e.statusCode, e.message))"
```

Expected: `400 imageUrl 仅支持 http/https`

**Step 3: Commit**

```powershell
git add lib/fetch-image.js
git commit -m "Add fetch-image helper for detect imageUrl downloads."
```

---

### Task 2: multipart 检测上限改为 20MB（错误文案跟 maxBytes）

**Files:**
- Modify: `lib/multipart.js`（默认 `maxBytes` 与错误文案）

**Step 1: 改默认上限与错误文案**

将：

```js
function parseMultipart(req, { maxBytes = 10 * 1024 * 1024 } = {}) {
```

改为：

```js
function parseMultipart(req, { maxBytes = 20 * 1024 * 1024 } = {}) {
```

将硬编码错误：

```js
fail(new Error('上传文件过大（上限 10MB）'), 413);
```

改为按 `maxBytes` 计算：

```js
const mb = Math.round(maxBytes / (1024 * 1024));
fail(new Error(`上传文件过大（上限 ${mb}MB）`), 413);
```

**注意：** `server.js` 里 `handleUpload` 调用 `parseMultipart(req, { maxBytes: hosting.LIMITS.video })`（10MB），图床行为不变。仅默认值影响 `/api/detect`。

**Step 2: Commit**

```powershell
git add lib/multipart.js
git commit -m "Raise default multipart limit to 20MB for detect."
```

---

### Task 3: 改造 `handleDetect`（二选一 + 下载 + 日志 + 响应）

**Files:**
- Modify: `server.js`
- Modify: `scripts/deploy-ssh.js`（若部署清单需包含新文件，把 `lib/fetch-image.js` 加进去）

**Step 1: 顶部 require**

```js
const { fetchImage } = require('./lib/fetch-image');
```

**Step 2: 重写 `handleDetect` 取图逻辑**

在 `parseMultipart` 之后替换「缺少 image」分支为：

```js
const imageUrl = String((fields && fields.imageUrl) || '').trim();
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
let source = 'upload';
let httpStatus = null;

if (hasFile) {
  buffer = file.buffer;
  mimeOrExt = detect.normalizeExt(file.mime) || detect.normalizeExt(file.filename);
} else {
  perf.start('download');
  let downloaded;
  try {
    downloaded = await fetchImage(imageUrl);
  } finally {
    // 若 fetch 抛错，仍尽量 end download；用 try/finally 或在 catch 前 end
  }
  perf.end('download');
  buffer = downloaded.buffer;
  mimeOrExt = detect.normalizeExt(downloaded.mime) || detect.normalizeExt(imageUrl);
  source = 'url';
  httpStatus = downloaded.httpStatus;
}

if (!mimeOrExt) {
  sendJson(res, 400, { ok: false, error: '仅支持 jpeg / png / webp 图片' });
  return;
}
const ext = mimeOrExt;
```

实现时注意：`fetchImage` 抛错要进现有 `catch`，并在 `writePerfLog` 失败分支带上 `source`/`imageUrl`/`httpStatus`（能拿到的字段）。下载成功路径：

- `fs.writeFileSync(inPath, buffer)` 用 `buffer` 而非 `file.buffer`
- `processBuffer(buffer, …)`
- 成功 `writePerfLog` 增加：

```js
source,
...(source === 'url' ? { imageUrl, httpStatus } : { source: 'upload' }),
```

- 成功响应：仅当 `source === 'url'` 时附加 `source` 与 `imageUrl`；上传模式字段集合不变。

将原先 `perf` 段名 `upload` 保留给 multipart 解析；URL 模式另有 `download`。

**Step 3: 更新启动日志文案**

```js
console.log(`POST /api/detect  image 或 imageUrl（可选 detector / noFace / singleEye / size）`);
```

**Step 4: 部署清单**

在 `scripts/deploy-ssh.js` 的文件列表中加入 `'lib/fetch-image.js'`（若该脚本按白名单上传）。

**Step 5: 本地手工验收（服务需已启动）**

```powershell
# 旧方式（响应不应出现 source）
curl.exe -F "image=@sample/lena.jpg" -F "size=5" http://localhost:8060/api/detect

# URL 方式（需可公网访问的图片 URL；也可用本机已有结果 URL）
curl.exe -F "imageUrl=https://face.83zi.com/sample/lena.jpg" -F "size=5" http://localhost:8060/api/detect

# 同时传 → 400
curl.exe -F "image=@sample/lena.jpg" -F "imageUrl=https://example.com/a.jpg" http://localhost:8060/api/detect
```

Expected:
1. 第一条 `ok:true`，无 `source` 字段  
2. 第二条 `ok:true`，`source:"url"`，日志含 `download`  
3. 第三条 `400` 明确文案  

**Step 6: Commit**

```powershell
git add server.js scripts/deploy-ssh.js
git commit -m "Support imageUrl on /api/detect with download logging."
```

---

### Task 4: 文档 — `docs/API.md` + `README.md` + 首页 `index.html`

**Files:**
- Modify: `docs/API.md`
- Modify: `README.md`
- Modify: `index.html`

**Step 1: `docs/API.md`**

- `image` 改为「与 `imageUrl` 二选一」
- 新增 `imageUrl` 行
- 413 说明改为 20MB（detect）
- 成功示例旁注明 URL 模式多 `source`/`imageUrl`
- curl 增加：

```bat
curl -F "imageUrl=https://example.com/photo.jpg" -F "size=5" http://localhost:8060/api/detect
```

**Step 2: `README.md` API Summary 表**

- `image`：与 `imageUrl` 二选一  
- 新增 `imageUrl` 行  

**Step 3: `index.html` 首页文档区**

- 表格：`image` 说明改为与 `imageUrl` 二选一；新增 `imageUrl` 行（http/https，服务端下载，上限 20MB）
- `sampleCurl` 增加一行 URL 示例
- lead 文案可微改为「上传图片或传图片 URL」
- 演示区仍只做本地选图（不加 URL 输入框）

**Step 4: Commit**

```powershell
git add docs/API.md README.md index.html
git commit -m "Document imageUrl support on detect API and homepage."
```

---

### Task 5: 部署后验收（可选，需有 SSH/线上权限）

**Step 1:** 按现有 `npm run` / `scripts/deploy-ssh.js` 部署，确认 `lib/fetch-image.js` 已上线。

**Step 2:** 打开 https://face.83zi.com/ ，确认首页 API 表有 `imageUrl`。

**Step 3:**

```powershell
curl.exe -F "image=@sample/lena.jpg" https://face.83zi.com/api/detect
curl.exe -F "imageUrl=https://face.83zi.com/sample/lena.jpg" https://face.83zi.com/api/detect
```

Expected: 两条均 `ok:true`；第二条含 `source":"url"`。

---

## 执行注意

- **不要破坏旧客户端**：上传成功响应不要加 `source`。
- **图床**继续 `parseMultipart(req, { maxBytes: hosting.LIMITS.video })`，LIMITS 不改。
- 下载失败必须写 perf 日志（`ok:false`）。
- PowerShell 下用 `curl.exe`，避免别名 `Invoke-WebRequest`。
