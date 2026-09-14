# `/api/detect` 支持 `imageUrl` 下载处理

日期：2026-09-15

## 目标

让 `POST /api/detect` 在保留现有文件上传的前提下，额外支持 multipart 字段 `imageUrl`：服务端下载图片后走与上传相同的检测 + WebP 压缩链路，并记录日志。首页（https://face.83zi.com/）与 `docs/API.md` 同步文档。

## 兼容性（硬约束）

- **未传 `imageUrl` 时，旧调用方式行为不变**：仍只认 `image` 文件；响应字段、处理管线、图床接口均不受影响。
- 仅当调用方显式传入非空 `imageUrl`（或同时传了两者触发 400）时，才进入新逻辑。
- 对旧上传路径的**唯一有意变更**：`/api/detect` 上传大小上限由 10MB 调整为 **20MB**（错误文案同步）。
- `/api/upload` 图床上限与语义保持现状（图片仍 10MB），不在本需求范围内。

## 接口契约

`POST /api/detect`，`Content-Type: multipart/form-data`。

| 字段 | 必填 | 说明 |
|------|------|------|
| `image` | 与 `imageUrl` 二选一 | jpg / png / webp 文件（与现网一致） |
| `imageUrl` | 与 `image` 二选一 | `http`/`https` 图片 URL，服务端下载后处理 |
| `detector` / `noFace` / `singleEye` / `size` | 否 | 语义不变 |

校验：

| 情况 | 状态码 | 错误说明 |
|------|--------|----------|
| 二者都无 | 400 | `请提供 image 文件或 imageUrl` |
| 二者都有 | 400 | `请只提供 image 或 imageUrl 其中之一，不要同时传` |
| `imageUrl` 非 http(s) 或空 | 400 | `imageUrl 仅支持 http/https` |

大小：`/api/detect` 的**上传与 URL 下载**统一上限 **20MB**（原检测上传默认 10MB 上调）。图床不动。

成功响应：

- **上传模式**：响应 JSON 字段集合与现网完全一致（不加 `source` / `imageUrl`）。
- **URL 模式**：在现网字段基础上附加只读 `source: "url"` 与 `imageUrl`（回显请求 URL）。

空字符串 / 仅空白的 `imageUrl` 视为未提供。
## 架构

推荐抽出 `lib/fetch-image.js`，`handleDetect` 负责编排：

```
multipart 解析
  → 校验 image / imageUrl 二选一
  → 上传：用 file.buffer
  → URL：fetchImage(imageUrl) → buffer
  → 写入 data/in → processBuffer（检测 + WebP）→ data/out
  → writePerfLog + JSON 响应
```

下载模块职责：协议校验、超时、大小上限、有限重定向、Content-Type/扩展名粗检，返回 `{ buffer, mime, httpStatus, bytes }`。

### 下载行为

- 仅 `http:` / `https:`
- 超时约 **15s**
- 响应体上限 **20MB**（超限中断 → 413）
- 重定向最多 **3** 次，目标仍须 http(s)
- **不做**内网 / localhost IP 拦截
- 类型：jpeg / png / webp（与上传一致）；无法识别 → 400
- 下载后与上传一样进入现有 `processBuffer`（含长边缩放与 WebP 压缩）

### 下载错误

| 情况 | 状态码 | 说明示例 |
|------|--------|----------|
| 超时 | 504 | `下载图片超时` |
| 远端非 2xx | 502 | `下载失败，HTTP {status}` |
| 超 20MB | 413 | `图片过大（上限 20MB）` |
| 非支持类型 | 400 | `仅支持 jpeg / png / webp 图片` |

## 日志

沿用 `writePerfLog` → `data/logs/YYYY-MM-DD.jsonl`。

URL 模式追加：

- `source: "url"`
- `imageUrl`（完整 URL）
- `httpStatus`
- `timings.download`（ms）
- `bytesIn`（下载后字节数，沿用现有字段）

上传模式日志：写 `source: "upload"`（仅日志，不进响应 JSON）；其余字段保持现有成功/失败结构。失败（含下载失败）同样写 `ok: false` 记录。
## 文档

1. `docs/API.md` — 字段表、二选一规则、20MB、curl URL 示例、状态码
2. 首页 `index.html`（部署后即 https://face.83zi.com/）— API 表格与 curl 示例同步；演示区仍以本地选图为主，本次不加 URL 试玩控件
3. `README.md` — 若有 detect 字段摘要则对齐

## 非目标

- 不改 `/api/upload` 行为与限额
- 不做 SSRF 私网拦截
- 首页不强制增加粘贴 URL 的交互演示
- 不新增独立 `/api/detect-url` 路由

## 验收

1. 仅 `image=@file`：与改前行为一致（处理结果、主要响应字段）
2. 仅 `-F "imageUrl=https://..."`：下载 → 遮挡 → 返回 `url`；日志含 `source`/`imageUrl`/`httpStatus`/`timings.download`
3. 同时传两者 → 400 且文案明确
4. 超过 20MB → 413
5. 首页与 `docs/API.md` 文档已更新 `imageUrl` 与 20MB 说明
