# 眼睛遮挡 API

Local HTTP API: upload image → CPU eye mask (YuNet/Haar) → WebP URL. No cloud LLM.

本地 HTTP 服务：上传图片 →（长边>1600 等比缩小）→ 检测眼睛 → 白底黑边方块遮挡 → 输出 WebP → 返回结果图 URL。

另提供兼容 imageproxy 风格的图床接口：上传图片/音频/视频，零处理，按 Bearer token 分目录存储。

## 启动

在仓库根目录执行：

```bat
npm start
```

默认端口：**8060**（地址：`http://localhost:8060`）。  
环境变量：`PORT`（覆盖端口）、`RETENTION_DAYS`（结果保留天数，默认 30）。

## `POST /api/detect`

`Content-Type: multipart/form-data`

| 字段 | 必填 | 说明 |
|------|------|------|
| `image` | 是 | jpg / png / webp 图片文件 |
| `detector` | 否 | `onnx`（默认，YuNet+五点关键标）或 `haar`；模型不可用时默认回落 `haar` |
| `noFace` | 否 | `1` / `true` / `yes`：跳过人脸，全图检眼（主要作用于 `haar`）；默认先人脸再眼睛 |
| `singleEye` | 否 | 每脸只遮一只眼。`1`/`true`/`yes` 开，`0`/`false`/`no` 关；**省略默认开** |
| `size` | 否 | 遮挡框大小 `1`–`10`：`2`≈眼睛，`10`≈整张脸；默认 `5` |

### 成功

```json
{
  "ok": true,
  "id": "43c8b34a30129402",
  "date": "2026-07-18",
  "eyeCount": 1,
  "size": 5,
  "singleEye": true,
  "detector": "onnx",
  "url": "http://localhost:8060/data/out/2026-07-18/43c8b34a30129402.webp",
  "inputUrl": "http://localhost:8060/data/in/2026-07-18/43c8b34a30129402.jpg",
  "faceCounts": { "merged": 3, "source": "yunet" },
  "timings": {
    "purge": 0.5,
    "upload": 12.3,
    "save.in": 1.1,
    "decode": 8.2,
    "mat": 1.4,
    "detect.yunet": 45.0,
    "mask": 0.8,
    "encode": 10.0,
    "save.out": 1.2,
    "total": 80.0
  }
}
```

`timings` 单位为毫秒。直接 `GET` `url` 即可下载结果图。

处理约束：长边超过 **1600px** 时等比缩小（不放大）；结果一律 **WebP**（质量约 80）。原图仍按上传格式保存在 `data/in/`。

同结构日志追加到 `data/logs/YYYY-MM-DD.jsonl`（控制台亦打印 `[perf] ...`），便于汇总瓶颈。

### 失败

```json
{ "ok": false, "error": "错误说明", "timings": { "upload": 3.2, "total": 3.5 } }
```

常见状态码：400（参数/格式）、413（超过 10MB）、500（处理失败）。

## `POST /api/upload`（图床）

纯存储，不做检测/转码。兼容常见图床调用方式。

Header：`Authorization: Bearer <token>`（任意非空 token；按 SHA256 前 16 位建目录）

`Content-Type: multipart/form-data`，字段名 **`file`**

| 类型 | 扩展名 | 上限 |
|------|--------|------|
| 图片 | jpg / jpeg / png / webp / gif | 10MB |
| 音频 | mp3 / wav / m4a / aac / ogg | 5MB |
| 视频 | mp4 / webm / mov | 10MB |

### 成功

```json
{
  "url": "http://localhost:8060/api/proxy/image/ba5b5738dd6aa18d9aea50e9750774b0.png",
  "created": 1785228062026
}
```

`GET /api/proxy/image/{id}.{ext}` 直接取回原文件。

### 调用示例

```bat
curl --location "http://localhost:8060/api/upload" ^
  --header "Authorization: Bearer my-token" ^
  --form "file=@C:\path\to\a.mp3"

curl --location "http://localhost:8060/api/upload" ^
  --header "Authorization: Bearer my-token" ^
  --form "file=@C:\path\to\clip.mp4"
```

## 调用示例（检测）

```bat
curl -F "image=@sample/lena.jpg" -F "size=5" http://localhost:8060/api/detect
curl -F "image=@sample/lena.jpg" -F "detector=haar" -F "size=5" http://localhost:8060/api/detect
curl -F "image=@sample/lena.jpg" -F "detector=onnx" -F "singleEye=0" -F "size=5" http://localhost:8060/api/detect
curl -F "image=@photo.webp" -F "noFace=1" -F "detector=haar" -F "size=8" http://localhost:8060/api/detect
```

## 存储与映射

```
data/
  in/YYYY-MM-DD/{id}.jpg|.png|.webp     ← 检测原图
  out/YYYY-MM-DD/{id}.webp              ← 检测结果图
  upload/{tokenHash}/YYYY-MM-DD/{id}.ext ← 图床原文件（按 token）
  upload/_index/{id}                     ← 图床 id → 相对路径
  logs/YYYY-MM-DD.jsonl                  ← 耗时日志
```

超过 `RETENTION_DAYS` 的日期目录会在启动时及每次处理前自动删除（`logs/` 不自动清理）。

## 遮挡样式

每个眼睛区域：以检测框中心做正方形（边长约 `max(宽,高)×1.1`），白色不透明填充 + 黑色细边框。
