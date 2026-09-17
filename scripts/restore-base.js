/**
 * 把 <base href> 从站点相对地址还原为“外部资源服务器绝对地址”。
 *
 * 项目已完全本地化（base href 一律为 /v9.3.0.24-1/...，不依赖任何外部域名），
 * 因此这里不再内置任何上游域名：必须显式给出来源地址才会执行，避免误把
 * 编辑器资源重新指回第三方 CDN。
 *
 *   ASSET_SOURCE_BASE=https://cdn.example.com/v9.3.0.24-1 node scripts/restore-base.js
 */
const fs = require('fs');
const path = require('path');

const SOURCE_BASE = process.env.ASSET_SOURCE_BASE;
if (!SOURCE_BASE) {
  console.error('ASSET_SOURCE_BASE is required, e.g. https://cdn.example.com/v9.3.0.24-1');
  process.exit(1);
}

const targetStr = '<base href="/v9.3.0.24-1/';
const replaceStr = '<base href="' + SOURCE_BASE.replace(/\/+$/, '') + '/';

let count = 0;

function processDir(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '.git') processDir(full);
    } else if (entry.name.endsWith('.html')) {
      let content = fs.readFileSync(full, 'utf8');
      if (content.includes(targetStr)) {
        count++;
        content = content.replaceAll(targetStr, replaceStr);
        fs.writeFileSync(full, content, 'utf8');
      }
    }
  }
}

processDir(path.resolve(__dirname, '../v9.3.0.24-1'));
console.log('Restored base href in', count, 'files.');
