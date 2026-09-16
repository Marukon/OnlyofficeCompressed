const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB Tencent Cloud EdgeOne Pages limit
const rootDir = path.resolve(__dirname, '..');

console.log('====================================================');
console.log('🔍 正在检测仓库内所有文件是否符合 EdgeOne Pages 25MB 上限限制...');
console.log('====================================================');

let violations = [];
let totalFiles = 0;
let totalSize = 0;
let largestFiles = [];

function scanDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDir(fullPath);
    } else if (entry.isFile()) {
      totalFiles++;
      const stat = fs.statSync(fullPath);
      totalSize += stat.size;
      const relPath = path.relative(rootDir, fullPath);
      largestFiles.push({ path: relPath, size: stat.size });

      if (stat.size > MAX_BYTES) {
        violations.push({ path: relPath, size: stat.size });
      }
    }
  }
}

scanDir(rootDir);

largestFiles.sort((a, b) => b.size - a.size);

console.log(`\n📊 扫描完成: 共 ${totalFiles} 个文件，总大小 ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
console.log('\n🔝 体积最大的前 5 个文件:');
largestFiles.slice(0, 5).forEach((f, idx) => {
  console.log(`   ${idx + 1}. [${(f.size / 1024 / 1024).toFixed(2)} MB] ${f.path}`);
});

if (violations.length > 0) {
  console.error('\n❌ 检测失败！以下文件超过 25MB 限制:');
  violations.forEach((v) => {
    console.error(`   - ${v.path} (${(v.size / 1024 / 1024).toFixed(2)} MB)`);
  });
  process.exit(1);
} else {
  console.log('\n✅ 校验通过！全项目没有任何文件超过 25MB，完全符合 EdgeOne Pages 部署要求！');
}

// 验证 x2t.wasm.gz 完整性与解压
const gzPath = path.join(rootDir, 'x2t', 'x2t.wasm.gz');
if (fs.existsSync(gzPath)) {
  console.log('\n🧪 正在验证 x2t.wasm.gz 二进制解压完整性...');
  const gzBuf = fs.readFileSync(gzPath);
  const decompressed = zlib.gunzipSync(gzBuf);
  console.log(`✅ x2t.wasm.gz 成功解压！解压后体积: ${(decompressed.length / 1024 / 1024).toFixed(2)} MB`);
  // 检查 wasm 魔数 \0asm (0x00, 0x61, 0x73, 0x6d)
  const isWasm = decompressed[0] === 0x00 && decompressed[1] === 0x61 && decompressed[2] === 0x73 && decompressed[3] === 0x6d;
  if (isWasm) {
    console.log('✅ WebAssembly 魔数验证成功: \\0asm');
  } else {
    console.error('❌ WebAssembly 文件头异常');
    process.exit(1);
  }
}

console.log('\n🎉 所有构建与体积规范验证全部通过！');
