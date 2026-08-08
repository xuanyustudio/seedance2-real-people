# 可切换检测器：Haar / ONNX YuNet+五点

日期：2026-07-21

## 目标

解决组图多人漏检；API 可用 `detector` 在 Haar 与 ONNX（YuNet+五点关键标）间切换。

## 方案

- **haar**：现有 OpenCV.js WASM + Haar 正脸/侧脸/眼睛（行为不变）。
- **onnx**（默认）：`onnxruntime-node` + OpenCV Zoo YuNet（含 5 关键标）一次检出多人脸与两眼坐标，再按现有规则画遮挡方块。

> 选型说明：原拟 SCRFD；YuNet 同为「人脸+五点」、模型仅约 230KB、与 OpenCV 后处理一致，更适合本仓库随包分发。

## 接口

`POST /api/detect` 新增字段：

| 字段 | 说明 |
|------|------|
| `detector` | `haar` \| `onnx`；缺省 `onnx`（模型可用时）。非法值 → 400 |

其余字段（`image` / `noFace` / `singleEye` / `size`）语义不变。`noFace` 主要作用于 haar；onnx 路径始终全图 YuNet 取眼点。

响应增加 `detector`；`faceCounts` 在 onnx 下为 `{ merged, source: "yunet" }`。

## 管线

1. sharp 解码/限边（长边 ≤ 1600）。
2. 按 `detector` 分支：
   - haar → 现有人脸 + 脸内 Haar 眼 / 估算。
   - onnx → letterbox 640 → YuNet 推理 → NMS → 每人脸用左右眼关键标为遮挡中心；`singleEye` 时每脸只遮一只。
3. 遮挡样式、WebP、落盘、耗时日志不变；onnx 分段记 `detect.yunet`。

## 模型与依赖

- 依赖：`onnxruntime-node`
- 模型：`models/yunet_2023mar.onnx`（OpenCV Zoo `face_detection_yunet_2023mar`）
- 启动：模型缺失时默认回落 `haar`；显式 `detector=onnx` 返回明确错误

## 错误处理

- 未知 `detector` → 400
- onnx 初始化/推理失败 → 500，message 含原因
- 不自动静默把单次请求从 onnx 改成 haar；由调用方改参数回退
