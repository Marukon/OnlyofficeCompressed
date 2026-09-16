/**
 * ONLYOFFICE x2t WebAssembly Web Worker
 * 方案 1 实施：通过浏览器原生 DecompressionStream("gzip") 流式解压 x2t.wasm.gz，
 * 在内存中完成 WebAssembly 二进制准备，规避 EdgeOne Pages 25MB 上限。
 */

let x2t = null;
let initPromise = null;

const AvsFileType = {
  AVS_FILE_UNKNOWN: 0x0000,
  AVS_FILE_DOCUMENT_DOCX: 0x0041,
  AVS_FILE_DOCUMENT_DOC: 0x0042,
  AVS_FILE_SPREADSHEET_XLSX: 0x0101,
  AVS_FILE_PRESENTATION_PPTX: 0x0081,
  AVS_FILE_CROSSPLATFORM_PDF: 0x0201,
  AVS_FILE_CROSSPLATFORM_PDFA: 0x0209
};

/**
 * 初始化 x2t 转换引擎并流式解压 wasm
 */
async function initX2t() {
  if (x2t) return;

  const baseUrl = new URL('./', self.location.href).href;
  const wasmGzUrl = baseUrl + 'x2t.wasm.gz';
  const scriptUrl = baseUrl + 'x2t.js';

  console.log('[x2t.worker] 开始获取压缩版 WASM:', wasmGzUrl);

  const response = await fetch(wasmGzUrl);
  if (!response.ok) {
    throw new Error(`加载 WASM 失败: ${response.status} ${response.statusText}`);
  }

  // 现代浏览器原生 DecompressionStream 流式秒级解压
  console.log('[x2t.worker] 使用原生 DecompressionStream("gzip") 内存解压...');
  const ds = new DecompressionStream('gzip');
  const decompressedStream = response.body.pipeThrough(ds);
  const wasmBinary = await new Response(decompressedStream).arrayBuffer();
  console.log(`[x2t.worker] WASM 内存解压完成，原始体积: ${(wasmBinary.byteLength / 1024 / 1024).toFixed(2)} MB`);

  // 将解压后的二进制直接赋给 Emscripten Module
  self.Module = {
    wasmBinary: wasmBinary,
    noInitialRun: true,
    noExitRuntime: true,
    locateFile: function(path, prefix) {
      return baseUrl + path;
    }
  };

  Object.assign(self, {
    __filename: baseUrl
  });

  // 导入 Emscripten 胶水脚本
  importScripts(scriptUrl);

  x2t = self.Module;

  // 等待运行时就绪
  await new Promise((resolve) => {
    if (x2t.calledRun) {
      resolve();
    } else {
      x2t.onRuntimeInitialized = () => resolve();
    }
  });

  // 创建内存工作目录
  try {
    x2t.FS.mkdir('/working');
    x2t.FS.mkdir('/working/media');
    x2t.FS.mkdir('/working/fonts');
    x2t.FS.mkdir('/working/themes');
  } catch (err) {
    // 目录若已存在则忽略
  }

  console.log('[x2t.worker] ONLYOFFICE x2t 转换器初始化成功！');
}

async function ensureInit() {
  if (!initPromise) {
    initPromise = initX2t();
  }
  return initPromise;
}

// Worker 启动时自动初始化
ensureInit().catch((err) => {
  console.error('[x2t.worker] 自动初始化异常:', err);
});

function cleanupFiles(files) {
  for (const file of files) {
    try {
      x2t.FS.unlink(file);
    } catch (err) {}
  }
  cleanMedia();
}

function cleanMedia() {
  try {
    const mediaFiles = x2t.FS.readdir('/working/media/');
    for (const file of mediaFiles) {
      if (file !== '.' && file !== '..') {
        x2t.FS.unlink('/working/media/' + file);
      }
    }
  } catch (err) {}
}

function readMedia() {
  const media = {};
  try {
    const files = x2t.FS.readdir('/working/media/');
    for (const file of files) {
      if (file !== '.' && file !== '..') {
        const fileData = x2t.FS.readFile('/working/media/' + file, { encoding: 'binary' });
        media[file] = fileData;
      }
    }
  } catch (e) {
    console.error('[x2t.worker] readMedia error:', e);
  }
  return media;
}

const xmlPath = '/working/params.xml';

function writeInputs({ fileFrom, fileTo, formatFrom, formatTo, data, media }) {
  const params = {
    m_sFileFrom: fileFrom,
    m_sThemeDir: '/working/themes',
    m_sFileTo: fileTo,
    m_nFormatFrom: formatFrom,
    m_nFormatTo: formatTo,
    m_bIsPDFA: formatTo === AvsFileType.AVS_FILE_CROSSPLATFORM_PDFA,
    m_bIsNoBase64: false,
    m_sFontDir: '/working/fonts/',
  };

  const content = Object.entries(params)
    .filter(([k, v]) => v)
    .reduce((a, [k, v]) => a + `<${k}>${v}</${k}>\n`, '');

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<TaskQueueDataConvert xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
${content}
</TaskQueueDataConvert>`;

  x2t.FS.writeFile(xmlPath, xml);
  if (data) {
    x2t.FS.writeFile(fileFrom, new Uint8Array(data));
  }

  if (media) {
    cleanMedia();
    for (const [key, value] of Object.entries(media)) {
      try {
        x2t.FS.writeFile('/working/' + key, value);
      } catch (err) {
        console.error(key, err);
      }
    }
  }
}

async function convert({ data, fileFrom, fileTo, formatFrom, formatTo, media, fonts, themes }) {
  const fromPath = '/working/' + fileFrom;
  const toPath = '/working/' + fileTo;
  const files = [fromPath, toPath, xmlPath];

  writeInputs({
    fileFrom: fromPath,
    fileTo: toPath,
    formatFrom,
    formatTo,
    data,
    media
  });

  if (fileFrom.endsWith('.doc') || formatFrom === AvsFileType.AVS_FILE_DOCUMENT_DOC) {
    const viaPath = fromPath + '.docx';
    writeInputs({
      fileFrom: fromPath,
      fileTo: viaPath,
      data: null
    });
    x2t.ccall('main1', ['number'], ['string'], [xmlPath]);
    writeInputs({
      fileFrom: viaPath,
      fileTo: toPath,
      data: null
    });
    files.push(viaPath);
  }

  try {
    const pathInfo = x2t.FS.analyzePath(toPath);
    if (pathInfo.exists) {
      x2t.FS.unlink(toPath);
    }
  } catch (err) {}

  try {
    x2t.ccall('main1', ['number'], ['string'], [xmlPath]);
  } catch (e) {
    console.error('[x2t.worker] ccall error:', e);
  }

  let output = null;
  try {
    output = x2t.FS.readFile(toPath);
  } catch (e) {
    console.error('[x2t.worker] readFile error:', e);
  }

  const outputMedia = readMedia();

  setTimeout(() => {
    cleanupFiles(files);
  });

  return { output, media: outputMedia };
}

self.onmessage = async (event) => {
  const { id, type, payload } = event.data;

  try {
    switch (type) {
      case 'convert': {
        await ensureInit();
        const result = await convert(payload);

        const transferables = [];
        if (result.output) {
          transferables.push(result.output.buffer);
        }
        if (result.media) {
          Object.values(result.media).forEach((m) => {
            if (m && m.buffer) transferables.push(m.buffer);
          });
        }

        self.postMessage(
          { id, type: 'convert:done', payload: result },
          transferables
        );
        break;
      }
      default:
        self.postMessage({ id, type: 'error', error: `Unknown message type: ${type}` });
    }
  } catch (error) {
    self.postMessage({ id, type: 'error', error: error instanceof Error ? error.message : String(error) });
  }
};

self.postMessage({ type: 'ready' });
