'use strict';

const path = require('path');

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg']);
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov']);

const MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/wave': '.wav',
  'audio/mp4': '.m4a',
  'audio/m4a': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/aac': '.aac',
  'audio/ogg': '.ogg',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
};

const EXT_MIME = {
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
};

const LIMITS = {
  image: 10 * 1024 * 1024,
  audio: 5 * 1024 * 1024,
  video: 10 * 1024 * 1024,
};

function kindOfExt(ext) {
  const e = String(ext || '').toLowerCase();
  if (IMAGE_EXTS.has(e)) return 'image';
  if (AUDIO_EXTS.has(e)) return 'audio';
  if (VIDEO_EXTS.has(e)) return 'video';
  return null;
}

/** 从 mime 或文件名解析扩展名；不支持则返回 null */
function normalizeMediaExt(mimeOrName) {
  const raw = String(mimeOrName || '').trim().toLowerCase();
  if (!raw) return null;
  if (MIME_TO_EXT[raw]) return MIME_TO_EXT[raw];
  const ext = path.extname(raw).toLowerCase();
  if (kindOfExt(ext)) return ext === '.jpeg' ? '.jpg' : ext;
  // 裸扩展名如 "png"
  const dotted = raw.startsWith('.') ? raw : '.' + raw;
  if (kindOfExt(dotted)) return dotted === '.jpeg' ? '.jpg' : dotted;
  return null;
}

function resolveUploadMeta(file) {
  const ext =
    normalizeMediaExt(file && file.mime) ||
    normalizeMediaExt(file && file.filename);
  if (!ext) {
    return {
      error: '仅支持 jpg/png/webp/gif、mp3/wav/m4a/aac/ogg、mp4/webm/mov',
      statusCode: 400,
    };
  }
  const kind = kindOfExt(ext);
  const maxBytes = LIMITS[kind];
  const size = file && file.buffer ? file.buffer.length : 0;
  if (size > maxBytes) {
    const mb = Math.round(maxBytes / (1024 * 1024));
    return {
      error: `${kind === 'audio' ? '音频' : kind === 'video' ? '视频' : '图片'}过大（上限 ${mb}MB）`,
      statusCode: 413,
    };
  }
  return { ext, kind, maxBytes, mime: EXT_MIME[ext] || 'application/octet-stream' };
}

function mimeForExt(ext) {
  return EXT_MIME[String(ext || '').toLowerCase()] || 'application/octet-stream';
}

module.exports = {
  LIMITS,
  normalizeMediaExt,
  resolveUploadMeta,
  mimeForExt,
  kindOfExt,
};
