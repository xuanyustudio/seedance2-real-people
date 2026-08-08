'use strict';

const { Client } = require('ssh2');

const PASS = process.env.DEPLOY_PASS;
if (!PASS) {
  console.error('缺少 DEPLOY_PASS');
  process.exit(1);
}

const HOST = process.env.DEPLOY_HOST;
const USER = process.env.DEPLOY_USER || 'root';
if (!HOST) {
  console.error('缺少环境变量: DEPLOY_HOST（以及 DEPLOY_PASS；可选 DEPLOY_USER）');
  process.exit(1);
}

const cmd = [
  "echo '--- grep 83zi ---'",
  "grep -RIl '83zi.com' /etc/apache2 /etc/httpd /www /usr/local 2>/dev/null | head -50",
  "echo '--- bt apache ---'",
  "ls -la /www/server/panel/vhost/apache 2>/dev/null || true",
  "echo '--- bt nginx ---'",
  "ls -la /www/server/panel/vhost/nginx 2>/dev/null || true",
  "echo '--- sites-enabled ---'",
  "ls -la /etc/apache2/sites-enabled 2>/dev/null || true",
  "ls -la /etc/nginx/sites-enabled 2>/dev/null || true",
  "echo '--- apachectl ---'",
  "apachectl -S 2>/dev/null | head -80 || true",
  "httpd -S 2>/dev/null | head -80 || true",
].join('\n');

const conn = new Client();
conn
  .on('ready', () => {
    conn.exec(cmd, (err, stream) => {
      if (err) {
        console.error(err);
        process.exit(1);
      }
      let out = '';
      stream.on('data', (d) => {
        out += d.toString();
      });
      stream.stderr.on('data', (d) => {
        out += d.toString();
      });
      stream.on('close', () => {
        console.log(out);
        conn.end();
      });
    });
  })
  .on('error', (e) => {
    console.error(e);
    process.exit(1);
  })
  .connect({
    host: HOST,
    port: 22,
    username: USER,
    password: PASS,
    readyTimeout: 20000,
  });
