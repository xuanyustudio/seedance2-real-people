# GitHub Open-Source Publish Ready Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the repo GitHub-ready: bilingual README emphasizing local CPU small models / no third-party LLM / $0 inference cost, Apache-2.0 license, safe `.gitignore`, sanitized deploy scripts, and aligned docs/metadata.

**Architecture:** Documentation and packaging only (方案 2). No detection algorithm changes. Core message: seedance2.0 face-pass runs YuNet/Haar locally on CPU with zero cloud API cost. Spec: `docs/superpowers/specs/2026-08-08-github-open-source-design.md`.

**Tech Stack:** Node.js HTTP server, OpenCV.js/WASM, YuNet ONNX (`onnxruntime-node`), Haar cascades, `sharp`; GitHub metadata (Topics, About).

---

### Task 1: Apache-2.0 LICENSE

**Files:**
- Create: `LICENSE`
- Modify: `package.json` (license field only in this task’s commit if preferred; or with Task 4)

**Step 1: Write LICENSE**

Create `LICENSE` with the standard Apache License 2.0 full text from https://www.apache.org/licenses/LICENSE-2.0.txt

Appendix copyright notice at top of file (or in NOTICE if using separate NOTICE — prefer single LICENSE header comment style used by many Node repos: full Apache text is enough; add a one-line copyright in README License section):

```
Copyright 2026 OpenCV-Haar-eyes contributors
```

**Step 2: Verify file exists and is non-empty**

Run (PowerShell):
```powershell
Test-Path LICENSE; (Get-Item LICENSE).Length -gt 5000
```
Expected: `True` / `True`

**Step 3: Commit**

```powershell
git add LICENSE
git commit -m "Add Apache-2.0 LICENSE."
```

---

### Task 2: Strengthen .gitignore

**Files:**
- Modify: `.gitignore`

**Step 1: Replace `.gitignore` contents with:**

```
node_modules/
data/
dist/
*.log
output.jpg
.DS_Store
Thumbs.db
.env
.env.*
*.pem
deploy.local.*
*.zip
```

**Step 2: Verify git will ignore data/dist**

```powershell
git check-ignore -v data/in data/upload dist node_modules .env
```
Expected: each path shows a matching rule from `.gitignore`

**Step 3: Commit**

```powershell
git add .gitignore
git commit -m "Ignore runtime data, dist, and local secrets."
```

---

### Task 3: Sanitize deploy scripts

**Files:**
- Modify: `scripts/deploy-ssh.js`
- Modify: `scripts/find-vhost.js`

**Step 1: Update `scripts/deploy-ssh.js` host/user/path block**

Replace the top config (lines ~7–16) so there are **no** default IP or remote path:

```javascript
const HOST = process.env.DEPLOY_HOST;
const USER = process.env.DEPLOY_USER || 'root';
const PASS = process.env.DEPLOY_PASS;
const REMOTE = process.env.DEPLOY_PATH;
const ROOT = path.resolve(__dirname, '..');

if (!HOST || !PASS || !REMOTE) {
  console.error('缺少环境变量: DEPLOY_HOST, DEPLOY_PASS, DEPLOY_PATH（可选 DEPLOY_USER，默认 root）');
  process.exit(1);
}
```

Ensure no leftover string `85.137.240.157` or `/drama/seedance_face` remains in the file.

**Step 2: Update `scripts/find-vhost.js` connect block**

Require `DEPLOY_HOST` (and keep `DEPLOY_PASS`). Remove default `'85.137.240.157'`.

Near top, after PASS check:

```javascript
const HOST = process.env.DEPLOY_HOST;
const USER = process.env.DEPLOY_USER || 'root';
if (!HOST) {
  console.error('缺少环境变量: DEPLOY_HOST（以及 DEPLOY_PASS；可选 DEPLOY_USER）');
  process.exit(1);
}
```

In `.connect({...})`:

```javascript
  .connect({
    host: HOST,
    port: 22,
    username: USER,
    password: PASS,
    readyTimeout: 20000,
  });
```

Note: `find-vhost.js` may still grep remote for `83zi.com` — that is a diagnostic string on the remote box, not a secret. Leave as-is unless it embeds credentials (it does not).

**Step 3: Grep for hardcoded host**

```powershell
rg "85\.137|DEPLOY_HOST \|" scripts/
```
Expected: no IP; only env reads without IP fallbacks.

**Step 4: Commit**

```powershell
git add scripts/deploy-ssh.js scripts/find-vhost.js
git commit -m "Require deploy env vars; remove hardcoded host defaults."
```

---

### Task 4: Update package.json metadata

**Files:**
- Modify: `package.json`

**Step 1: Set fields**

```json
{
  "name": "opencv-haar-eyes",
  "version": "1.0.0",
  "description": "seedance2.0 face-pass API: local CPU small-model eye masking (YuNet/Haar). No cloud LLM. Zero inference cost. 本地小模型 CPU 过人脸，不调用第三方大模型，推理成本为 0。",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "download-yunet": "scripts\\download-yunet.bat",
    "test": "echo \"Error: no test specified\" && exit 1"
  },
  "keywords": [
    "seedance",
    "opencv",
    "yunet",
    "haar-cascade",
    "eye-detection",
    "face-detection",
    "image-masking",
    "privacy",
    "nodejs",
    "onnx",
    "computer-vision",
    "api",
    "local-ai",
    "cpu-inference",
    "zero-cost",
    "on-device",
    "eye-mask"
  ],
  "author": "",
  "license": "Apache-2.0",
  "dependencies": {
    "onnxruntime-node": "^1.27.0",
    "sharp": "^0.35.3"
  }
}
```

Keep existing `dependencies` versions exactly as in the current file if they differ slightly; only change description/keywords/license (and ensure scripts stay).

**Step 2: Validate JSON**

```powershell
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('ok')"
```
Expected: `ok`

**Step 3: Commit**

```powershell
git add package.json
git commit -m "Align package.json with Apache-2.0 and SEO keywords."
```

---

### Task 5: Rewrite README.md (bilingual + positioning)

**Files:**
- Modify: `README.md`

**Step 1: Replace entire README with bilingual content**

Must include, in order:

1. Title: `# seedance2.0 人脸直过 · OpenCV/YuNet Eye Mask API`
2. Badges (static shields are fine):
   - Apache-2.0
   - Node.js
   - OpenCV / ONNX
3. EN + ZH one-liners, then **mandatory positioning line**:
   - EN: Local small models (YuNet ONNX + Haar) run face/eye masking on **CPU**. No third-party LLM or cloud vision API. **Inference cost = $0.**
   - ZH: **本地小模型 + CPU 过人脸**；不调用第三方大模型/云端视觉 API；**推理成本为 0**（仅本机算力）。
4. Features — first bullets = local/CPU/no-LLM/$0; then eye mask, dual detectors, image host, retention
5. Demo `curl` using `sample/lena.jpg` and `http://localhost:8060` (match `server.js`)
6. Quick Start with relative paths (`npm install` / `npm start` / open `http://localhost:8060`)
7. Model note: YuNet via `npm run download-yunet` if missing; Haar + wasm included
8. API summary table + link `docs/API.md`
9. How it works (onnx default / haar fallback / offline CPU)
10. Directory layout (no `E:\...`)
11. Env: `PORT` (default 8060), `RETENTION_DAYS` (default 30); deploy: `DEPLOY_HOST`, `DEPLOY_PASS`, `DEPLOY_PATH`, optional `DEPLOY_USER`
12. Keywords EN + ZH lines including local-ai / zero-cost / 本地小模型
13. Contributing blurb (Issues/PRs welcome)
14. License Apache-2.0

Do **not** mention real deploy IPs or product-private hosts.

**Step 2: Spot-check**

```powershell
rg "8080|E:\\\\|85\.137|大模型|zero|8060|CPU" README.md
```
Expected: `8060` present; positioning words present; no `E:\`, no `85.137`, no stale `8080` as default port.

**Step 3: Commit**

```powershell
git add README.md
git commit -m "Rewrite bilingual README with local CPU zero-cost positioning."
```

---

### Task 6: Patch docs/API.md

**Files:**
- Modify: `docs/API.md`

**Step 1: Edits**

1. After the H1, add English one-liner:  
   `Local HTTP API: upload image → CPU eye mask (YuNet/Haar) → WebP URL. No cloud LLM.`
2. Replace every `localhost:8080` with `localhost:8060`
3. Replace absolute `cd E:\OpenCV-Haar-eyes` with `cd <repo>` or just `npm start` from repo root
4. In 启动 section, state default port **8060** and env `PORT` / `RETENTION_DAYS`
5. Keep Chinese as primary body

**Step 2: Verify**

```powershell
rg "8080|E:\\\\" docs/API.md
```
Expected: no matches (or only historical notes if any — prefer zero)

**Step 3: Commit**

```powershell
git add docs/API.md
git commit -m "Fix API docs port and remove absolute paths."
```

---

### Task 7: Stage publishable tree and verify clean status

**Files:** (staging only — no logic change)
- Include: source, docs, models, sample, opencv assets, package files, LICENSE, README, scripts
- Exclude: `data/`, `dist/`, `node_modules/`

**Step 1: Stage intended paths**

```powershell
git add .gitignore LICENSE README.md package.json package-lock.json server.js index.html debug.html opencv.js opencv_js.wasm lib models sample scripts docs/API.md docs/superpowers
git status
```

**Step 2: Confirm ignored / not staged**

`git status` must **not** list files under `data/` or `dist/` or `node_modules/`.

If something under `data/` appears, fix `.gitignore` and unstage.

**Step 3: Optional dry-run file list**

```powershell
git diff --cached --stat
```
Expected: reasonable source/docs/models/sample/wasm; no upload media.

**Step 4: Commit remaining project files**

```powershell
git commit -m "Add project sources for public GitHub release."
```

(If already committed piecemeal and only leftovers remain, commit leftovers with the same message intent.)

---

### Task 8: Hand off GitHub About / Topics (no push)

**Files:** none (output in chat / optional `docs/GITHUB_META.md` — prefer chat only to avoid doc sprawl)

**Step 1: Print for user**

**About:**
```
seedance2.0 face-pass — local small-model CPU eye mask (YuNet/Haar). No cloud LLM. $0 inference cost.
```

**Topics (comma-separated for GitHub UI):**
```
seedance, opencv, yunet, haar-cascade, eye-detection, face-detection, image-masking, privacy, nodejs, onnx, computer-vision, api, local-ai, cpu-inference, zero-cost
```

**Step 2: Do NOT push** unless user explicitly asks and provides GitHub user/org.

**Step 3: If user asks to create remote**

```powershell
gh repo create OpenCV-Haar-eyes --public --source=. --remote=origin --description "seedance2.0 face-pass — local small-model CPU eye mask (YuNet/Haar). No cloud LLM. $0 inference cost."
git push -u origin HEAD
gh repo edit --add-topic seedance --add-topic opencv --add-topic yunet --add-topic haar-cascade --add-topic eye-detection --add-topic face-detection --add-topic image-masking --add-topic privacy --add-topic nodejs --add-topic onnx --add-topic computer-vision --add-topic api --add-topic local-ai --add-topic cpu-inference --add-topic zero-cost
```

(Only run after explicit approval.)

---

## Definition of done

- [ ] `LICENSE` Apache-2.0 present
- [ ] README bilingual + local CPU / no LLM / $0 cost above the fold
- [ ] `docs/API.md` port 8060, no `E:\` paths
- [ ] `package.json` license + keywords aligned
- [ ] `.gitignore` covers `data/`, `dist/`, secrets
- [ ] Deploy scripts require env; no hardcoded IP defaults
- [ ] First publishable commit(s) exclude runtime uploads
- [ ] User has About + Topics text; push only on request
