# seedance2.0 人脸直过 · OpenCV/YuNet Eye Mask API

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-brightgreen.svg)](https://nodejs.org/)
[![OpenCV / ONNX](https://img.shields.io/badge/OpenCV%20%2F%20ONNX-YuNet%20%2B%20Haar-orange.svg)](https://github.com/opencv/opencv_zoo)

Upload a face photo; locally detect eyes and cover them with a white square (black border); get a public result URL.

上传人脸图片，本地检测眼睛并用白底黑边方块遮挡，返回可访问的结果图 URL。

**Local small models (YuNet ONNX + Haar) run face/eye masking on CPU. No third-party LLM or cloud vision API. Inference cost = $0.**

**本地小模型 + CPU 过人脸**；不调用第三方大模型/云端视觉 API；**推理成本为 0**（仅本机算力）。

## Features / 特性

- **Local CPU inference** — YuNet ONNX + Haar cascades; no GPU required
- **No third-party LLM / cloud vision** — no OpenAI, no remote vision APIs
- **$0 inference cost** — pay only for your own machine (本机算力，推理成本为 0)
- **Eye mask** — white square with black border over detected eyes; WebP output
- **Dual detectors** — `onnx` (YuNet, default) or `haar` cascade
- **Image host** — `POST /api/upload` for raw media storage (Bearer token)
- **Retention** — auto-purge dated dirs (default 30 days)

## Demo

```bat
npm start
curl -F "image=@sample/lena.jpg" http://localhost:8060/api/detect
```

Open `http://localhost:8060` for the product page and in-browser tryout.

## Quick Start / 快速开始

```bat
npm install
npm start
```

Then open `http://localhost:8060`.

### Models / 模型

- **YuNet ONNX** — if `models/yunet_2023mar.onnx` is missing, run `npm run download-yunet` (or place the file under `models/`).
- **Haar cascades** + `opencv.js` / `opencv_js.wasm` — included in the repo.

## API Summary / 接口摘要

`POST /api/detect` (`multipart/form-data`)

| Field | Required | Description |
|-------|----------|-------------|
| `image` | either / 二选一 | jpg / png / webp file (provide `image` **or** `imageUrl`) |
| `imageUrl` | either / 二选一 | http/https image URL; server downloads then same pipeline; max 20MB |
| `detector` | no | `onnx` (default, YuNet) or `haar` |
| `noFace` | no | `1`/`true`/`yes`: skip face stage, scan full image for eyes (mainly `haar`) |
| `singleEye` | no | mask one eye per face; **on by default** (`0`/`false`/`no` to disable) |
| `size` | no | mask size `1`–`10`, default `5` |

`POST /api/upload` — image/audio/video hosting (no processing). Header: `Authorization: Bearer <token>`; field: `file`.

Full reference: [docs/API.md](docs/API.md).

## How it works / 原理

1. **Default `detector=onnx`** — YuNet (`models/yunet_2023mar.onnx`) finds faces and five landmarks; eye points drive the mask boxes.
2. **`detector=haar`** (or ONNX unavailable) — Haar face/eye cascades; side-face fallback estimates eyes from the face box when needed.
3. After models are present, the pipeline runs **fully offline on CPU** — no cloud calls for inference.

## Directory layout / 目录结构

```
seedance2-real-people/
├─ server.js                 # HTTP API + static assets
├─ lib/
│  ├─ detect-eyes.js         # detect + mask orchestration
│  ├─ detectors/yunet.js     # YuNet ONNX
│  ├─ multipart.js
│  ├─ hosting.js
│  └─ retention.js
├─ models/                   # Haar + yunet_2023mar.onnx
├─ scripts/                  # download-yunet, deploy helpers
├─ sample/                   # sample images (e.g. lena.jpg)
├─ data/                     # runtime in/out/upload/logs (gitignored)
├─ opencv.js
├─ opencv_js.wasm
├─ index.html
├─ docs/API.md
├─ package.json
└─ README.md
```

## Environment / 环境变量

| Variable | Default | Notes |
|----------|---------|-------|
| `PORT` | `8060` | HTTP listen port |
| `RETENTION_DAYS` | `30` | purge age for dated data dirs |

Deploy helpers (`scripts/deploy-ssh.js`, etc.) expect:

| Variable | Required | Notes |
|----------|----------|-------|
| `DEPLOY_HOST` | yes | target host |
| `DEPLOY_PASS` | yes | SSH password |
| `DEPLOY_PATH` | yes | remote project path |
| `DEPLOY_USER` | no | default `root` |

Do not commit real hosts or secrets.

## Keywords / 关键词

EN: `seedance`, `local-ai`, `cpu-inference`, `zero-cost`, `on-device`, `yunet`, `haar`, `eye-mask`, `opencv`, `onnx`, `face-detection`, `privacy`

ZH: `本地小模型`, `CPU 推理`, `推理成本为 0`, `人脸直过`, `眼睛遮挡`, `离线视觉`, `隐私保护`

## Contributing / 贡献

Issues and pull requests are welcome. Please keep changes focused, avoid committing secrets or machine-specific paths, and describe the problem or use case briefly.

欢迎提 Issue / PR：请保持改动聚焦，勿提交密钥或本机绝对路径，并简要说明动机。

## License / 许可

Apache License 2.0 — see [LICENSE](LICENSE).

Copyright 2026 seedance2-real-people contributors
