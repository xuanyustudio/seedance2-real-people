'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const cvFactory = require('../opencv.js');
const yunet = require('./detectors/yunet');

const ROOT = path.resolve(__dirname, '..');
/** size=2 时约为当前眼睛框；size=10 约等于人脸；默认 5 */
const DEFAULT_SIZE = 5;
const MIN_SIZE = 1;
const MAX_SIZE = 10;
/** 无脸框时，用人眼框估算人脸边长的倍数 */
const FACE_OVER_EYE = 3.2;
/** 处理/输出长边上限（不放大） */
const MAX_EDGE = 1600;
/** 结果一律 WebP */
const OUT_EXT = '.webp';
const WEBP_QUALITY = 80;
const DETECTORS = ['haar', 'onnx'];

let cv = null;
let faceCascade = null;
let profileCascade = null;
let eyeCascade = null;
let yunetReady = false;

function loadWasmBinary() {
  const p = path.join(ROOT, 'opencv_js.wasm');
  if (!fs.existsSync(p)) throw new Error('找不到 opencv_js.wasm');
  return fs.readFileSync(p);
}

function loadCascadeFile(name) {
  const p = path.join(ROOT, 'models', name);
  if (!fs.existsSync(p)) throw new Error('找不到模型: ' + name);
  const data = new Uint8Array(fs.readFileSync(p));
  try { cv.FS_unlink('/' + name); } catch (_) {}
  cv.FS_createDataFile('/', name, data, true, false);
}

function init() {
  if (cv) return cv;
  const wasmBinary = loadWasmBinary();
  cv = cvFactory({ wasmBinary });
  if (typeof cv.Mat !== 'function') {
    throw new Error('OpenCV 运行时初始化失败');
  }
  loadCascadeFile('haarcascade_frontalface_default.xml');
  loadCascadeFile('haarcascade_profileface.xml');
  loadCascadeFile('haarcascade_eye.xml');
  faceCascade = new cv.CascadeClassifier();
  profileCascade = new cv.CascadeClassifier();
  eyeCascade = new cv.CascadeClassifier();
  if (!faceCascade.load('/haarcascade_frontalface_default.xml')) {
    throw new Error('人脸模型加载失败');
  }
  if (!profileCascade.load('/haarcascade_profileface.xml')) {
    throw new Error('侧脸模型加载失败');
  }
  if (!eyeCascade.load('/haarcascade_eye.xml')) {
    throw new Error('眼睛模型加载失败');
  }
  return cv;
}

/**
 * 直方图均衡化增强对比度 —— 对特效/逆光/低对比度场景显著提升 Haar 检测率。
 * 返回新的 cv.Mat，调用方需负责 delete。
 */
function equalizedGray(gray) {
  const eq = new cv.Mat();
  cv.equalizeHist(gray, eq);
  return eq;
}

/** 异步初始化 YuNet；失败不抛，仅标记不可用 */
async function initOnnx() {
  if (yunetReady) return true;
  try {
    yunetReady = await yunet.init(ROOT);
  } catch (err) {
    yunetReady = false;
    console.warn('[warn] YuNet 初始化失败:', (err && err.message) || err);
  }
  return yunetReady;
}

function onnxAvailable() {
  return yunetReady || yunet.available();
}

function defaultDetector() {
  return onnxAvailable() ? 'onnx' : 'haar';
}

function normalizeDetector(raw) {
  if (raw == null || String(raw).trim() === '') return defaultDetector();
  const s = String(raw).trim().toLowerCase();
  if (s === 'yunet') return 'onnx';
  if (!DETECTORS.includes(s)) {
    const err = new Error('detector 仅支持 haar / onnx');
    err.statusCode = 400;
    throw err;
  }
  return s;
}

function rectIoU(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (inter <= 0) return 0;
  const union = a.width * a.height + b.width * b.height - inter;
  return inter / union;
}

function centerInside(inner, outer) {
  const cx = inner.x + inner.width / 2;
  const cy = inner.y + inner.height / 2;
  return cx >= outer.x && cx <= outer.x + outer.width
    && cy >= outer.y && cy <= outer.y + outer.height;
}

function facesShouldMerge(a, b, iouThresh) {
  return rectIoU(a, b) >= iouThresh || centerInside(a, b) || centerInside(b, a);
}

function preferFace(a, b) {
  // 保留面积更大者；面积接近时优先正脸
  const aa = a.width * a.height;
  const bb = b.width * b.height;
  if (aa !== bb) return aa >= bb ? a : b;
  return a.source === 'frontal' ? a : b;
}

/** 合并重叠/包含的人脸框 */
function mergeFaceRects(list, iouThresh = 0.2) {
  const kept = [];
  for (const r of list) {
    let merged = false;
    for (let i = 0; i < kept.length; i++) {
      if (facesShouldMerge(r, kept[i], iouThresh)) {
        kept[i] = preferFace(kept[i], r);
        merged = true;
        break;
      }
    }
    if (!merged) kept.push(r);
  }
  return kept;
}

function preferLargerRect(a, b) {
  return a.width * a.height >= b.width * b.height ? a : b;
}

/** 合并重叠眼睛框；面积优先，最多保留 maxKeep 个 */
function mergeEyeRects(list, iouThresh = 0.25, maxKeep = 2) {
  const kept = [];
  for (const r of list) {
    let merged = false;
    for (let i = 0; i < kept.length; i++) {
      if (rectIoU(r, kept[i]) >= iouThresh || centerInside(r, kept[i]) || centerInside(kept[i], r)) {
        kept[i] = preferLargerRect(kept[i], r);
        merged = true;
        break;
      }
    }
    if (!merged) kept.push(r);
  }
  kept.sort((a, b) => b.width * b.height - a.width * a.height);
  return kept.slice(0, maxKeep);
}

function pushRects(rectVec, out, mapX, source) {
  for (let i = 0; i < rectVec.size(); i++) {
    const f = rectVec.get(i);
    const x = mapX ? mapX(f.x, f.width) : f.x;
    out.push({ x, y: f.y, width: f.width, height: f.height, source });
  }
}

/**
 * 正脸 + 侧脸（原图 + 水平翻转，覆盖左右朝向）。
 * 使用直方图均衡化提升特效/逆光场景检出率。
 * @param {import('./perf').Perf | null} perf
 * @returns {{ faces: { x: number, y: number, width: number, height: number, source: string }[], counts: { frontal: number, profile: number, profileFlip: number, merged: number } }}
 */
function detectAllFaces(gray, perf) {
  const list = [];
  const frontal = new cv.RectVector();
  const profile = new cv.RectVector();
  const profileFlip = new cv.RectVector();
  const flipped = new cv.Mat();
  // 均衡化图像 —— 显著提高 Haar 在异常外观下的检测率
  const eq = equalizedGray(gray);
  try {
    if (perf) perf.start('detect.frontal');
    // minNeighbors=2 比原来的 3 更敏感，减少特效遮挡漏检
    faceCascade.detectMultiScale(eq, frontal, 1.1, 2, 0, new cv.Size(30, 30));
    pushRects(frontal, list, null, 'frontal');
    const frontalCount = frontal.size();
    if (perf) perf.end('detect.frontal');

    if (perf) perf.start('detect.profile');
    // 侧脸从 5→3，用均衡化图像可补偿误检增加
    profileCascade.detectMultiScale(eq, profile, 1.1, 3, 0, new cv.Size(30, 30));
    pushRects(profile, list, null, 'profile');
    const profileCount = profile.size();
    if (perf) perf.end('detect.profile');

    if (perf) perf.start('detect.profileFlip');
    // OpenCV 侧脸级联主要认「朝左」轮廓；翻转后再检「朝右」
    cv.flip(eq, flipped, 1);
    profileCascade.detectMultiScale(flipped, profileFlip, 1.1, 3, 0, new cv.Size(30, 30));
    pushRects(profileFlip, list, (x, w) => gray.cols - x - w, 'profile');
    const profileFlipCount = profileFlip.size();
    if (perf) perf.end('detect.profileFlip');

    if (perf) perf.start('detect.merge');
    const faces = mergeFaceRects(list);
    if (perf) perf.end('detect.merge');

    return {
      faces,
      counts: {
        frontal: frontalCount,
        profile: profileCount,
        profileFlip: profileFlipCount,
        merged: faces.length,
      },
    };
  } finally {
    frontal.delete();
    profile.delete();
    profileFlip.delete();
    flipped.delete();
    eq.delete();
  }
}

/** 人脸框内检不出眼睛时的兜底：用人脸框估算眼部区域。
 *  对特效/火眼场景，Haar 检不出眼，此兜底是最后的保障。
 *  扩大估算范围，确保特效场景也能覆盖眼部。
 */
function estimateEyeFromFace(faceRect) {
  // 面积从 0.28→0.35，更宽，覆盖火眼/特效范围
  const w = Math.max(1, Math.round(faceRect.width * 0.35));
  const h = Math.max(1, Math.round(faceRect.height * 0.22));
  return {
    x: Math.round(faceRect.x + faceRect.width * 0.36 - w / 2),
    y: Math.round(faceRect.y + faceRect.height * 0.36 - h / 2),
    width: w,
    height: h,
  };
}

/**
 * 无脸模式下检不出眼睛时的兜底：
 * 将图像左右分为两半，在每半的中间区域估算一个方形遮挡。
 * @param {number} imgW
 * @param {number} imgH
 * @returns {{ x: number, y: number, width: number, height: number }[]}
 */
function estimateEyesNoFace(imgW, imgH) {
  const halfW = Math.round(imgW / 2);
  const eyeH = Math.round(imgH * 0.25);          // 垂直占 1/4
  const eyeW = Math.round(halfW * 0.35);         // 水平占半幅的 35%
  const y = Math.round(imgH * 0.20);             // 从 20% 高度开始（眉毛到鼻子区域）
  return [
    { x: Math.round(halfW * 0.5 - eyeW / 2), y, width: eyeW, height: eyeH },
    { x: Math.round(halfW + halfW * 0.5 - eyeW / 2), y, width: eyeW, height: eyeH },
  ];
}

/** 由眼关键标 + 脸宽估算遮挡用眼睛框 */
function eyeRectFromLandmark(pt, faceRect, otherPt) {
  let side;
  if (otherPt) {
    const iod = Math.hypot(pt.x - otherPt.x, pt.y - otherPt.y);
    side = Math.max(10, Math.round(iod * 0.55));
  } else {
    side = Math.max(10, Math.round(Math.max(faceRect.width, faceRect.height) * 0.18));
  }
  return {
    x: Math.round(pt.x - side / 2),
    y: Math.round(pt.y - side / 2),
    width: side,
    height: side,
  };
}

/**
 * 全图检眼 + 三重兜底。
 * 供 Haar 无脸模式 和 ONNX 降级 共用。
 * @param {cv.Mat} gray 灰度图
 * @param {cv.Mat} img RGBA 原图（会画遮挡）
 * @param {number} size 遮挡大小 1-10
 * @returns {number} 遮挡的眼睛数量
 */
function detectEyesOnImage(gray, img, size) {
  let count = 0;
  const eyes = new cv.RectVector();
  const eq = equalizedGray(gray);
  try {
    // 第一轮：正常参数
    eyeCascade.detectMultiScale(eq, eyes, 1.1, 3, 0, new cv.Size(20, 20));

    if (eyes.size() > 0) {
      for (let i = 0; i < eyes.size(); i++) {
        maskEye(img, eyes.get(i), size, null);
        count++;
      }
    } else {
      // 第二轮：极宽参数 (minNeighbors=1, minSize=5)
      const e2 = new cv.RectVector();
      eyeCascade.detectMultiScale(eq, e2, 1.05, 1, 0, new cv.Size(5, 5));
      const fallbackRects = [];
      for (let i = 0; i < e2.size(); i++) {
        fallbackRects.push(e2.get(i));
      }
      e2.delete();
      if (fallbackRects.length > 0) {
        fallbackRects.sort((a, b) => b.width * b.height - a.width * a.height);
        const top = fallbackRects.slice(0, 2);
        for (const r of top) {
          maskEye(img, r, size, null);
          count++;
        }
      } else {
        // 终极兜底：左右半区估算
        const estimated = estimateEyesNoFace(gray.cols, gray.rows);
        for (const r of estimated) {
          maskEye(img, r, size, null);
          count++;
        }
      }
    }
  } finally {
    eq.delete();
    eyes.delete();
  }
  return count;
}

function normalizeExt(mimeOrExt) {
  const s = String(mimeOrExt || '').toLowerCase();
  if (s.includes('png') || s.endsWith('.png')) return '.png';
  if (s.includes('webp') || s.endsWith('.webp')) return '.webp';
  if (s.includes('jpeg') || s.includes('jpg') || s.endsWith('.jpg') || s.endsWith('.jpeg')) {
    return '.jpg';
  }
  return null;
}

function normalizeSize(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_SIZE;
  return Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(n)));
}

/** 解码为 RGBA；长边超过 MAX_EDGE 时等比缩小（不放大）；校正 EXIF 方向 */
async function decodeToRgba(buffer) {
  const { data, info } = await sharp(buffer)
    .rotate()
    .ensureAlpha()
    .resize({
      width: MAX_EDGE,
      height: MAX_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data };
}

async function encodeWebp(width, height, rgbaData) {
  return sharp(Buffer.from(rgbaData), {
    raw: { width, height, channels: 4 },
  })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();
}

/**
 * size=2 → 当前眼睛框大小；size=10 → 约一张脸大小；其间线性插值。
 */
function squareSide(eyeW, eyeH, size, faceW, faceH) {
  const eyeBase = Math.max(1, Math.max(eyeW, eyeH) * 1.1);
  const faceBase = (faceW > 0 && faceH > 0)
    ? Math.max(eyeBase, Math.max(faceW, faceH) * 0.9)
    : eyeBase * FACE_OVER_EYE;
  // size 2 → eyeBase，size 10 → faceBase；size 1 略小于眼睛
  const t = (size - 2) / (MAX_SIZE - 2);
  return Math.max(1, Math.round(eyeBase + (faceBase - eyeBase) * t));
}

function clampSquare(cx, cy, side, imgW, imgH) {
  let left = Math.round(cx - side / 2);
  let top = Math.round(cy - side / 2);
  left = Math.max(0, Math.min(left, imgW - side));
  top = Math.max(0, Math.min(top, imgH - side));
  const size = Math.min(side, imgW - left, imgH - top);
  return { x: left, y: top, size: Math.max(1, size) };
}

function borderThickness(imgW, imgH) {
  const short = Math.min(imgW, imgH);
  return Math.max(2, Math.min(4, Math.round(short / 400)));
}

function maskEye(img, rect, size, faceRect) {
  const side = squareSide(
    rect.width,
    rect.height,
    size,
    faceRect ? faceRect.width : 0,
    faceRect ? faceRect.height : 0
  );
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const sq = clampSquare(cx, cy, side, img.cols, img.rows);
  const t = borderThickness(img.cols, img.rows);
  const p1 = new cv.Point(sq.x, sq.y);
  const p2 = new cv.Point(sq.x + sq.size, sq.y + sq.size);
  cv.rectangle(img, p1, p2, new cv.Scalar(255, 255, 255, 255), -1);
  cv.rectangle(img, p1, p2, new cv.Scalar(0, 0, 0, 255), t);
}

/**
 * 在半透明人脸区域上叠加彩色渲染（彩绘），标注该人脸由 Haar 兜底补获。
 * 使用暖橙色调 + 30% 透明度叠加到面部区域。
 * @param {cv.Mat} img RGBA 原图
 * @param {{ x:number, y:number, width:number, height:number }} faceRect
 */
function paintFaceOverlay(img, faceRect) {
  const { x, y, width: w, height: h } = faceRect;
  if (w <= 0 || h <= 0) return;
  // 创建同尺寸 overlay Mat，画暖橙半透明矩形
  const overlay = new cv.Mat(h, w, cv.CV_8UC4, new cv.Scalar(220, 120, 50, 80));
  try {
    // 提取原图 ROI
    const roi = img.roi(new cv.Rect(x, y, w, h));
    // 混合：overlay * 0.3 + roi * 0.7
    cv.addWeighted(overlay, 0.45, roi, 0.55, 0, roi);
    roi.delete();
  } finally {
    overlay.delete();
  }
}

/**
 * 在人脸框列表内逐一检眼（均衡化 ROI + 二阶段检测 + 兜底）。
 * 供 Haar 路径和 ONNX 双保险共用。
 * @param {{ x:number, y:number, width:number, height:number }[]} faceRects
 * @param {cv.Mat} gray 灰度图
 * @param {cv.Mat} img RGBA 原图（会画遮挡）
 * @param {number} size 遮挡大小 1-10
 * @param {boolean} singleEye
 * @param {import('./perf').Perf|null} perf
 * @returns {number} 遮挡的眼睛数量
 */
function detectEyesInFaces(faceRects, gray, img, size, singleEye, perf) {
  let count = 0;
  let eyesMs = 0;
  for (const faceRect of faceRects) {
    const eyeBandH = Math.max(1, Math.round(faceRect.height * 0.55));
    const roiRect = new cv.Rect(faceRect.x, faceRect.y, faceRect.width, eyeBandH);
    const roiGray = gray.roi(roiRect);
    const roiEq = equalizedGray(roiGray);
    const e = new cv.RectVector();
    const tEye = process.hrtime.bigint();

    // 第一轮：正常检测 (minNeighbors=3)
    eyeCascade.detectMultiScale(roiEq, e, 1.1, 3, 0, new cv.Size(10, 10));
    eyesMs += Number(process.hrtime.bigint() - tEye) / 1e6;

    const rawEyes = [];

    if (e.size() > 0) {
      for (let j = 0; j < e.size(); j++) {
        const r = e.get(j);
        rawEyes.push({
          x: faceRect.x + r.x,
          y: faceRect.y + r.y,
          width: r.width,
          height: r.height,
        });
      }
    } else {
      // 第二轮：放宽参数 (minNeighbors=1, minSize=5)
      const e2 = new cv.RectVector();
      eyeCascade.detectMultiScale(roiEq, e2, 1.1, 1, 0, new cv.Size(5, 5));
      for (let j = 0; j < e2.size(); j++) {
        const r = e2.get(j);
        rawEyes.push({
          x: faceRect.x + r.x,
          y: faceRect.y + r.y,
          width: r.width,
          height: r.height,
        });
      }
      e2.delete();
    }

    const eyeRects = mergeEyeRects(rawEyes, 0.25, singleEye ? 1 : 2);
    if (eyeRects.length === 0) {
      maskEye(img, estimateEyeFromFace(faceRect), size, faceRect);
      count++;
    } else {
      for (const r of eyeRects) {
        maskEye(img, r, size, faceRect);
        count++;
      }
    }
    roiGray.delete();
    roiEq.delete();
    e.delete();
  }
  if (perf) {
    const prev = perf.marks['detect.eyes'] || 0;
    perf.set('detect.eyes', prev + eyesMs);
  }
  return count;
}

/**
 * @param {Buffer} buffer
 * @param {{ noFace?: boolean, singleEye?: boolean, mimeOrExt?: string, size?: number, detector?: string, perf?: import('./perf').Perf }} opts
 * @returns {Promise<{ outBuffer: Buffer, eyeCount: number, ext: string, size: number, singleEye: boolean, detector: string, width: number, height: number, faceCounts?: object, timings: object }>}
 */
async function processBuffer(buffer, opts = {}) {
  if (!cv) init();
  const ext = normalizeExt(opts.mimeOrExt);
  if (!ext) throw new Error('仅支持 jpeg / png / webp 图片');
  const size = normalizeSize(opts.size);
  // 默认每脸只遮一只眼
  const singleEye = opts.singleEye !== false;
  const detector = normalizeDetector(opts.detector);
  const perf = opts.perf || null;

  if (detector === 'onnx' && !onnxAvailable()) {
    const err = new Error('onnx 检测器不可用：请放置 models/yunet_2023mar.onnx 后重启');
    err.statusCode = 500;
    throw err;
  }

  if (perf) perf.start('decode');
  const raw = await decodeToRgba(buffer);
  if (perf) perf.end('decode');

  if (perf) perf.start('mat');
  const img = new cv.Mat(raw.height, raw.width, cv.CV_8UC4);
  img.data.set(raw.data);
  const gray = new cv.Mat();
  cv.cvtColor(img, gray, cv.COLOR_RGBA2GRAY);
  if (perf) perf.end('mat');

  let eyeCount = 0;
  const noFace = !!opts.noFace;
  let faceCounts = null;

  try {
    let maskMs = 0;

    if (detector === 'onnx') {
      if (perf) perf.start('detect.yunet');
      const yunetResult = await yunet.detectFaces(raw);
      if (perf) perf.end('detect.yunet');

      const yunetFaces = yunetResult.faces || [];
      const tMask = process.hrtime.bigint();

      // ---- 第 1 轮：YuNet 五点关键点定位逐脸遮挡 ----
      for (const face of yunetFaces) {
        const re = eyeRectFromLandmark(face.rightEye, face, face.leftEye);
        const le = eyeRectFromLandmark(face.leftEye, face, face.rightEye);
        const picks = singleEye ? [re] : [re, le];
        for (const r of picks) {
          maskEye(img, r, size, face);
          eyeCount++;
        }
      }

      // ---- 第 2 轮：Haar 人脸检测兜底（双保险）----
      if (perf) perf.start('detect.haarFallback');
      const haarResult = detectAllFaces(gray, perf);
      const haarFaces = haarResult.faces || [];

      const newHaarFaces = haarFaces.filter((hf) => {
        const hc = { x: hf.x + hf.width / 2, y: hf.y + hf.height / 2 };
        return !yunetFaces.some((yf) => centerInside(hc, yf));
      });

      if (newHaarFaces.length > 0) {
        // === Haar 补获的人脸：先做面部彩绘标记，再检眼遮挡 ===
        for (const hf of newHaarFaces) {
          paintFaceOverlay(img, hf);
        }
        eyeCount += detectEyesInFaces(newHaarFaces, gray, img, size, singleEye, perf);
      }
      if (perf) perf.end('detect.haarFallback');

      faceCounts = {
        onnx: yunetResult.counts || { merged: yunetFaces.length },
        haar: haarResult.counts,
        merged: yunetFaces.length + newHaarFaces.length,
      };

      maskMs += Number(process.hrtime.bigint() - tMask) / 1e6;
    } else {
      let faceList = [];
      if (!noFace) {
        const detected = detectAllFaces(gray, perf);
        faceList = detected.faces;
        faceCounts = detected.counts;
      }

      if (!noFace && faceList.length > 0) {
        // ---- Haar 人脸框 → 逐脸检眼 ----（detectEyesInFaces 内部已设置 detect.eyes）
        eyeCount += detectEyesInFaces(faceList, gray, img, size, singleEye, perf);
      } else {
        // ---- 无脸模式（noFace=1 或 Haar 没检出人脸）----
        const tEye = process.hrtime.bigint();
        eyeCount += detectEyesOnImage(gray, img, size);
        const eyesMs = Number(process.hrtime.bigint() - tEye) / 1e6;
        if (perf) perf.set('detect.eyes', eyesMs);
      }
    }

    if (perf) {
      perf.set('mask', maskMs);
    }

    if (perf) perf.start('encode');
    const outBuffer = await encodeWebp(img.cols, img.rows, img.data);
    if (perf) perf.end('encode');

    return {
      outBuffer,
      eyeCount,
      ext: OUT_EXT,
      size,
      singleEye,
      detector,
      width: raw.width,
      height: raw.height,
      faceCounts,
      timings: perf ? perf.snapshot() : {},
    };
  } finally {
    img.delete();
    gray.delete();
  }
}

module.exports = {
  init,
  initOnnx,
  onnxAvailable,
  defaultDetector,
  normalizeDetector,
  processBuffer,
  normalizeExt,
  normalizeSize,
  DEFAULT_SIZE,
  MIN_SIZE,
  MAX_SIZE,
  MAX_EDGE,
  OUT_EXT,
  WEBP_QUALITY,
  DETECTORS,
};
