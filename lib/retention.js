'use strict';

const fs = require('fs');
const path = require('path');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayStamp(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDateStamp(stamp) {
  if (!DATE_RE.test(stamp)) return null;
  const [y, m, d] = stamp.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function daysBetween(a, b) {
  const ms = 24 * 60 * 60 * 1000;
  const a0 = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const b0 = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.floor((b0 - a0) / ms);
}

/**
 * 删除 rootDir 下超过 retentionDays 的 YYYY-MM-DD 子目录。
 * @returns {string[]} 被删除的目录名
 */
function purgeOldDateDirs(rootDir, retentionDays) {
  const days = Number(retentionDays);
  if (!Number.isFinite(days) || days < 0) return [];
  if (!fs.existsSync(rootDir)) return [];

  const today = new Date();
  const removed = [];
  for (const name of fs.readdirSync(rootDir)) {
    if (!DATE_RE.test(name)) continue;
    const full = path.join(rootDir, name);
    let st;
    try { st = fs.statSync(full); } catch (_) { continue; }
    if (!st.isDirectory()) continue;
    const dirDate = parseDateStamp(name);
    if (!dirDate) continue;
    if (daysBetween(dirDate, today) > days) {
      fs.rmSync(full, { recursive: true, force: true });
      removed.push(name);
    }
  }
  return removed;
}

module.exports = { todayStamp, purgeOldDateDirs, parseDateStamp };
