# Design: GitHub Open-Source Publish Ready (方案 2)

**Date:** 2026-08-08  
**Status:** Approved in conversation; awaiting user review of this written spec  
**License:** Apache-2.0  
**Audience:** Public open-source showcase (clone → run → star)

## Goals

Make `OpenCV-Haar-eyes` safe and discoverable on GitHub while keeping **seedance2.0 人脸直过** as the product brand and a technical subtitle (OpenCV / YuNet Eye Mask API).

### Core positioning (must emphasize everywhere)

对外 final messaging pillar — appear in About, README hero, Features, How it works, and Keywords:**

| ZH | EN |
|----|----|
| 本地小模型，CPU 过人脸 | Local small models; face pipeline runs on CPU |
| 不调用第三方大模型 / 云端视觉 API | No third-party LLMs or cloud vision APIs |
| 推理成本为 0（仅本机算力） | Inference cost = $0 (your machine only) |
| 数据不出本机（默认本地部署） | Data stays on-prem by default |

Do **not** position this as a generative / LLM product. Contrast with cloud face APIs and paid vision models is intentional and should be explicit (short, not ranting).

Success criteria:

1. A stranger can clone, `npm install`, `npm start`, and call `/api/detect` without local absolute paths or missing docs.
2. No runtime uploads, logs, deploy host secrets, or build zips land in the repo.
3. README is bilingual (ZH + EN); Topics / `package.json` keywords support search.
4. License is Apache-2.0 end-to-end (`LICENSE` + `package.json`).
5. A first-time reader understands within 10 seconds: **local small model + CPU + no third-party LLM + zero inference cost**.

Out of scope (方案 3 deferred): demo GIF, full English API.md, GitHub Actions CI, Issue templates, Git LFS.

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| Purpose | A — open-source showcase |
| Branding | A — seedance2.0 product name + technical subtitle |
| License | B — Apache-2.0 |
| Docs language | C — bilingual README; API.md Chinese-primary + EN blurb |
| Approach | 2 — publish-ready package |
| Value prop | Local small-model CPU face pass; no third-party LLM; $0 inference cost |

## 1. Repository identity

- **Repo name:** `OpenCV-Haar-eyes`
- **GitHub About description:**  
  `seedance2.0 face-pass — local small-model CPU eye mask (YuNet/Haar). No cloud LLM. $0 inference cost.`
- **Topics:**  
  `seedance`, `opencv`, `yunet`, `haar-cascade`, `eye-detection`, `face-detection`, `image-masking`, `privacy`, `nodejs`, `onnx`, `computer-vision`, `api`, `local-ai`, `cpu-inference`, `zero-cost`
- **package.json:**
  - `description`: bilingual one-liner stressing local CPU small models + zero API cost
  - `keywords`: same set as Topics (plus short aliases if useful, e.g. `eye-mask`, `on-device`)
  - `license`: `Apache-2.0`
  - `author`: leave empty unless user supplies a name later

## 2. README & docs

### README.md structure (single bilingual file)

1. Title + badges (License Apache-2.0, Node, OpenCV)
2. One EN sentence + one ZH sentence (what it is) — **immediately followed by** the local/CPU/zero-cost/no-LLM line
3. Features / 特性 (bilingual); **first bullets must cover:**
   - Local YuNet ONNX (~small) + Haar cascades; CPU inference
   - No OpenAI / cloud vision / third-party LLM dependency
   - $0 per-request inference cost after self-hosting
   - Then product features (eye mask, dual detectors, image host, etc.)
4. Demo: `curl` with `sample/lena.jpg` (no mandatory screenshot)
5. Quick Start / 快速开始: relative paths only; `npm install` → `npm start` → browser
6. API Summary: `/api/detect`, `/api/upload` tables; link to `docs/API.md`
7. How it works / 原理: default `onnx` (YuNet) / `haar` fallback; restate “runs fully offline on CPU after models are present”
8. Project layout / 目录
9. Config: `PORT`, `RETENTION_DAYS`, deploy env vars (no real hosts)
10. Keywords (one EN line + one ZH line for search; include 本地小模型 / zero-cost / on-device)
11. Short “Issues / PRs welcome” (3–5 lines; no separate CONTRIBUTING.md)
12. License (Apache-2.0)

### docs/API.md

- Remove absolute Windows paths (e.g. `E:\OpenCV-Haar-eyes`)
- Align default port with `server.js` (**8060**, overridable via `PORT`)
- Keep Chinese as primary; add a one-line English summary at the top

### Port consistency

- Documented default port must match `server.js` (`PORT || 8060`)
- README and API.md must not claim 8080 unless code is changed (prefer fix docs, not code port)

## 3. Safety, ignore rules, small code changes

### .gitignore

Must exclude at least:

- `node_modules/`
- entire `data/` (`in`, `out`, `logs`, `upload`, `_index`)
- `dist/`, local zips, `*.log`
- OS junk: `.DS_Store`, `Thumbs.db`
- secrets: `.env`, `*.pem`, `deploy.local.*`

### Deploy scripts (`scripts/deploy-ssh.js`, `scripts/find-vhost.js`)

- Remove hardcoded default host IP and fixed remote path defaults
- Require env vars; exit with clear error listing required variables
- README documents variable names only — never real host/credentials

### What stays in the repo

- `opencv.js`, `opencv_js.wasm` (~8MB; acceptable without LFS for v1)
- Haar XMLs under `models/`, `sample/lena.jpg`
- `models/yunet_2023mar.onnx` if present; otherwise document `npm run download-yunet`

### What must not be in the first commit

- Anything under `data/`
- `dist/` artifacts
- `node_modules/`

### LICENSE

- Add root `LICENSE` (Apache-2.0 full text)
- Copyright line: `Copyright 2026 OpenCV-Haar-eyes contributors` (replace with user’s real name if they provide one before LICENSE is written)
- Sync `package.json` `license` field

### Git workflow in this effort

- `git init` if needed
- Stage only safe publishable files
- Prepare first commit content as part of implementation
- **Do not** `gh repo create` / `git push` until the user explicitly requests it and provides GitHub user/org

## Implementation checklist (for later plan)

1. Write `LICENSE` (Apache-2.0)
2. Rewrite `README.md` (bilingual structure above)
3. Patch `docs/API.md` (paths, port, EN blurb)
4. Update `package.json` (description, keywords, license)
5. Strengthen `.gitignore`
6. Sanitize deploy scripts (env-only host/path)
7. Verify no secrets / upload binaries staged
8. `git init` + initial commit when user asks to commit
9. Provide copy-paste GitHub Topics + About for repo settings
10. Push only on explicit user request

## Non-goals / deferred

- Demo GIF / screenshots gallery
- Full English translation of `docs/API.md`
- CI workflows, CODE_OF_CONDUCT, Issue/PR templates
- Git LFS for wasm
- Functional changes to detection algorithms
