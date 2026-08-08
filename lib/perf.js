'use strict';

const fs = require('fs');
const path = require('path');

/**
 * 请求级耗时打点。单位 ms，保留 2 位小数。
 */
class Perf {
  constructor() {
    this.marks = Object.create(null);
    this._t0 = process.hrtime.bigint();
    this._starts = Object.create(null);
  }

  start(name) {
    this._starts[name] = process.hrtime.bigint();
  }

  end(name) {
    const t = this._starts[name];
    if (t == null) return 0;
    const ms = Number(process.hrtime.bigint() - t) / 1e6;
    this.marks[name] = roundMs(ms);
    delete this._starts[name];
    return this.marks[name];
  }

  set(name, ms) {
    this.marks[name] = roundMs(ms);
  }

  /** 自创建以来的总耗时 */
  total() {
    return roundMs(Number(process.hrtime.bigint() - this._t0) / 1e6);
  }

  snapshot() {
    return { ...this.marks, total: this.total() };
  }
}

function roundMs(ms) {
  return Math.round(ms * 100) / 100;
}

/**
 * 写一行 JSONL 到 data/logs/日期.log，并打印到控制台。
 * @param {string} logDir absolute path to data/logs
 * @param {object} record
 */
function writePerfLog(logDir, record) {
  const line = JSON.stringify(record);
  console.log('[perf]', line);
  try {
    fs.mkdirSync(logDir, { recursive: true });
    const day = record.date || new Date().toISOString().slice(0, 10);
    fs.appendFileSync(path.join(logDir, day + '.jsonl'), line + '\n');
  } catch (err) {
    console.error('[perf] 写日志失败:', err.message || err);
  }
}

module.exports = { Perf, writePerfLog, roundMs };
