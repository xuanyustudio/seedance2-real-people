'use strict';

const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');

const HOST = process.env.DEPLOY_HOST;
const USER = process.env.DEPLOY_USER || 'root';
const PASS = process.env.DEPLOY_PASS;
const REMOTE = process.env.DEPLOY_PATH;
const ROOT = path.resolve(__dirname, '..');

if (!HOST || !PASS || !REMOTE) {
  console.error('缺少环境变量: DEPLOY_HOST, DEPLOY_PASS, DEPLOY_PATH（可选 DEPLOY_USER，默认 root）');
  process.exit(1);
}

const FILES = [
  'server.js',
  'index.html',
  'debug.html',
  'package.json',
  'package-lock.json',
  'README.md',
  'docs/API.md',
  'lib/detect-eyes.js',
  'lib/multipart.js',
  'lib/fetch-image.js',
  'lib/hosting.js',
  'lib/retention.js',
  'lib/perf.js',
  'lib/detectors/yunet.js',
  'models/yunet_2023mar.onnx',
  'scripts/download-yunet.bat',
];

function exec(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = '';
      let errOut = '';
      stream.on('close', (code) => resolve({ code, out, errOut }));
      stream.on('data', (d) => { out += d.toString(); });
      stream.stderr.on('data', (d) => { errOut += d.toString(); });
    });
  });
}

function sftpMkdir(sftp, dir) {
  return new Promise((resolve) => {
    sftp.mkdir(dir, () => resolve());
  });
}

function sftpPut(sftp, local, remote) {
  return new Promise((resolve, reject) => {
    sftp.fastPut(local, remote, (err) => (err ? reject(err) : resolve()));
  });
}

async function main() {
  const conn = new Client();
  await new Promise((resolve, reject) => {
    conn.on('ready', resolve).on('error', reject).connect({
      host: HOST,
      port: 22,
      username: USER,
      password: PASS,
      readyTimeout: 20000,
    });
  });

  console.log('[ssh] connected');
  let r = await exec(conn, `ls -la ${REMOTE} && echo '---' && (pm2 list || true) && echo '---' && (pm2 jlist || true)`);
  console.log(r.out || r.errOut);

  const sftp = await new Promise((resolve, reject) => {
    conn.sftp((err, s) => (err ? reject(err) : resolve(s)));
  });

  await sftpMkdir(sftp, `${REMOTE}/lib`);
  await sftpMkdir(sftp, `${REMOTE}/lib/detectors`);
  await sftpMkdir(sftp, `${REMOTE}/models`);
  await sftpMkdir(sftp, `${REMOTE}/docs`);
  await sftpMkdir(sftp, `${REMOTE}/scripts`);

  for (const rel of FILES) {
    const local = path.join(ROOT, rel);
    if (!fs.existsSync(local)) {
      console.warn('[skip missing]', rel);
      continue;
    }
    const remote = `${REMOTE}/${rel.replace(/\\/g, '/')}`;
    process.stdout.write(`[put] ${rel} ... `);
    await sftpPut(sftp, local, remote);
    console.log('ok');
  }

  console.log('[remote] npm install + pm2 restart face');
  r = await exec(
    conn,
    [
      'export NVM_DIR="$HOME/.nvm"',
      '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"',
      'nvm use 22 >/dev/null',
      `cd ${REMOTE}`,
      'node -v',
      'npm install --omit=dev',
      'test -f models/yunet_2023mar.onnx',
      'pm2 restart face --update-env',
      'pm2 list',
    ].join(' && ')
  );
  console.log(r.out);
  if (r.errOut) console.log(r.errOut);
  if (r.code !== 0) {
    console.error('[fail] exit', r.code);
    conn.end();
    process.exit(1);
  }

  conn.end();
  console.log('[done]');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
