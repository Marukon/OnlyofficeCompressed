const fs = require('fs');
const path = require('path');

const targetStr = '<base href="/v9.3.0.24-1/';
const replaceStr = '<base href="https://office-editor.ziziyi.com/v9.3.0.24-1/';

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
