'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const ort = require('onnxruntime-node');

const INPUT = 640;
const STRIDES = [8, 16, 32];
const SCORE_THRESH = 0.5;
const NMS_THRESH = 0.3;
const TOP_K = 5000;

let session = null;
let modelPath = null;

function available() {
  return !!session;
}

function modelFile(root) {
  return path.join(root, 'models', 'yunet_2023mar.onnx');
}

async function init(root) {
  if (session) return true;
  const p = modelFile(root);
  if (!fs.existsSync(p)) return false;
  session = await ort.InferenceSession.create(p, {
    executionProviders: ['cpu'],
  });
  modelPath = p;
  return true;
}

function sigmoidClamp(v) {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function iouBox(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (inter <= 0) return 0;
  return inter / (a.w * a.h + b.w * b.h - inter);
}

function nms(faces, thresh, topK) {
  const order = faces
    .map((f, i) => ({ i, s: f.score }))
    .sort((a, b) => b.s - a.s)
    .slice(0, topK)
    .map((o) => o.i);
  const keep = [];
  const suppressed = new Set();
  for (const i of order) {
    if (suppressed.has(i)) continue;
    keep.push(faces[i]);
    for (const j of order) {
      if (j === i || suppressed.has(j)) continue;
      if (iouBox(faces[i], faces[j]) >= thresh) suppressed.add(j);
    }
  }
  return keep;
}

/**
 * RGBA → letterbox 640 RGB float NCHW（0–255）
 */
async function letterboxRgb(rgba, width, height) {
  const scale = Math.min(INPUT / width, INPUT / height);
  const newW = Math.max(1, Math.round(width * scale));
  const newH = Math.max(1, Math.round(height * scale));
  const padX = Math.floor((INPUT - newW) / 2);
  const padY = Math.floor((INPUT - newH) / 2);

  const resized = await sharp(Buffer.from(rgba), {
    raw: { width, height, channels: 4 },
  })
    .resize(newW, newH, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer();

  const canvas = new Float32Array(1 * 3 * INPUT * INPUT);
  for (let y = 0; y < newH; y++) {
    for (let x = 0; x < newW; x++) {
      const si = (y * newW + x) * 3;
      const di = (padY + y) * INPUT + (padX + x);
      canvas[0 * INPUT * INPUT + di] = resized[si];
      canvas[1 * INPUT * INPUT + di] = resized[si + 1];
      canvas[2 * INPUT * INPUT + di] = resized[si + 2];
    }
  }
  return { tensorData: canvas, scale, padX, padY };
}

function decodeStride(outs, stride, scale, padX, padY, imgW, imgH) {
  const cols = INPUT / stride;
  const rows = INPUT / stride;
  const cls = outs[`cls_${stride}`].data;
  const obj = outs[`obj_${stride}`].data;
  const bbox = outs[`bbox_${stride}`].data;
  const kps = outs[`kps_${stride}`].data;
  const faces = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const score = Math.sqrt(sigmoidClamp(cls[idx]) * sigmoidClamp(obj[idx]));
      if (score < SCORE_THRESH) continue;

      const cx = (c + bbox[idx * 4 + 0]) * stride;
      const cy = (r + bbox[idx * 4 + 1]) * stride;
      const w = Math.exp(bbox[idx * 4 + 2]) * stride;
      const h = Math.exp(bbox[idx * 4 + 3]) * stride;
      const x1 = (cx - w / 2 - padX) / scale;
      const y1 = (cy - h / 2 - padY) / scale;
      const bw = w / scale;
      const bh = h / scale;

      const landmarks = [];
      for (let n = 0; n < 5; n++) {
        const kx = ((kps[idx * 10 + 2 * n] + c) * stride - padX) / scale;
        const ky = ((kps[idx * 10 + 2 * n + 1] + r) * stride - padY) / scale;
        landmarks.push({
          x: Math.max(0, Math.min(imgW - 1, kx)),
          y: Math.max(0, Math.min(imgH - 1, ky)),
        });
      }

      faces.push({
        x: x1,
        y: y1,
        w: bw,
        h: bh,
        score,
        rightEye: landmarks[0],
        leftEye: landmarks[1],
        landmarks,
      });
    }
  }
  return faces;
}

/**
 * @param {{ width: number, height: number, data: Buffer|Uint8Array }} rgba
 * @returns {Promise<{ faces: object[], counts: { merged: number, source: string } }>}
 */
async function detectFaces(rgba) {
  if (!session) throw new Error('YuNet 未初始化（缺少 models/yunet_2023mar.onnx）');

  const { width, height, data } = rgba;
  const { tensorData, scale, padX, padY } = await letterboxRgb(data, width, height);
  const input = new ort.Tensor('float32', tensorData, [1, 3, INPUT, INPUT]);
  const outs = await session.run({ input });

  let candidates = [];
  for (const stride of STRIDES) {
    candidates = candidates.concat(
      decodeStride(outs, stride, scale, padX, padY, width, height)
    );
  }
  const faces = nms(candidates, NMS_THRESH, TOP_K).map((f) => ({
    x: Math.round(f.x),
    y: Math.round(f.y),
    width: Math.round(f.w),
    height: Math.round(f.h),
    score: f.score,
    source: 'yunet',
    rightEye: { x: f.rightEye.x, y: f.rightEye.y },
    leftEye: { x: f.leftEye.x, y: f.leftEye.y },
  }));

  return {
    faces,
    counts: { merged: faces.length, source: 'yunet' },
  };
}

module.exports = {
  init,
  available,
  detectFaces,
  modelFile,
  SCORE_THRESH,
  INPUT,
};
