/**
 * Office文档管理器 - 前端应用主逻辑
 * 集成 IndexedDB 本地文档库、ONLYOFFICE 离线组件及 WebAssembly 流式解压运行
 */

import { docDB } from './db.js';
import {
  EditorServer,
  MockSocket,
  io,
  createXHRProxy,
  createFetchProxy,
  getDocumentType,
  getFileExt,
  isExtendedPdfFile,
  defaultConverter,
} from './editor-runtime.js';
import { emptyDocx, emptyPdf, emptyPptx, emptyXlsx } from './empty.js';

// SVG 图标集合（高保真还原）
const ICONS = {
  word: `<svg viewBox="0 0 40 40" width="36" height="36" fill="none">
    <rect width="40" height="40" rx="8" fill="#2563eb"/>
    <path d="M11 13h4.2l3 10.5 3-10.5h4.2l3.4 14h-3.6l-1.8-8.5-2.9 8.5h-3.8l-2.9-8.5-1.8 8.5H8.6L11 13z" fill="#ffffff"/>
  </svg>`,
  excel: `<svg viewBox="0 0 40 40" width="36" height="36" fill="none">
    <rect width="40" height="40" rx="8" fill="#16a34a"/>
    <path d="M12 13h4.5l3.5 6.2 3.5-6.2H28l-5.8 8.5 6 8.5h-4.6L20 23.5l-3.6 5.5H12l6-8.5L12 13z" fill="#ffffff"/>
  </svg>`,
  ppt: `<svg viewBox="0 0 40 40" width="36" height="36" fill="none">
    <rect width="40" height="40" rx="8" fill="#ea580c"/>
    <path d="M13 13h7.5c3.6 0 6 2 6 5s-2.4 5-6 5H17v6h-4V13zm4 3.5v3h3.5c1.4 0 2.2-.6 2.2-1.5s-.8-1.5-2.2-1.5H17z" fill="#ffffff"/>
  </svg>`,
  pdf: `<svg viewBox="0 0 40 40" width="36" height="36" fill="none">
    <rect width="40" height="40" rx="8" fill="#dc2626"/>
    <path d="M12 13h10.5c3.2 0 5.5 1.8 5.5 4.5s-2.3 4.5-5.5 4.5H16v7h-4V13zm4 3.2v3.1h6.2c1.2 0 2-.6 2-1.55s-.8-1.55-2-1.55H16z" fill="#ffffff"/>
    <circle cx="28" cy="27" r="2" fill="#ffffff"/>
  </svg>`,
  defaultDoc: `<svg viewBox="0 0 40 40" width="36" height="36" fill="none">
    <rect width="40" height="40" rx="8" fill="#64748b"/>
    <path d="M14 12h12v3H14v-3zm0 6h12v3H14v-3zm0 6h8v3H14v-3z" fill="#ffffff"/>
  </svg>`,
};

function getDocIcon(type) {
  const t = (type || '').toLowerCase();
  if (['docx', 'doc', 'word', 'dotx', 'dotm', 'rtf', 'txt'].includes(t)) return ICONS.word;
  if (['xlsx', 'xls', 'cell', 'csv', 'xlsm', 'xltx'].includes(t)) return ICONS.excel;
  if (['pptx', 'ppt', 'slide', 'potx', 'potm'].includes(t)) return ICONS.ppt;
  if (['pdf'].includes(t)) return ICONS.pdf;
  return ICONS.defaultDoc;
}

function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 KB';
  if (bytes < 1024) return bytes + ' Bytes';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function formatDateTime(timestamp) {
  if (!timestamp) return '未知时间';
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });
}

class AppManager {
  constructor() {
    this.server = new EditorServer({
      onSaveDocument: (doc) => this.handleDocumentSaved(doc),
    });
    this.currentEditor = null;
    this.activeDocId = null;

    this.initElements();
    this.bindEvents();
    this.initRecentDocuments();
  }

  initElements() {
    // 容器与视图
    this.mainWrapper = document.getElementById('main-wrapper');
    this.editorContainer = document.getElementById('editor-container');
    this.editorPlaceholder = document.getElementById('editor-placeholder');
    this.loadingMask = document.getElementById('loading-mask');
    this.loadingTitle = document.getElementById('loading-title');
    this.loadingSubtitle = document.getElementById('loading-subtitle');
    this.toastEl = document.getElementById('toast');

    // 顶部与状态
    this.docTitleEl = document.getElementById('editor-doc-title');
    this.saveStatusEl = document.getElementById('save-status');

    // 按钮与输入
    this.btnBack = document.getElementById('btn-back');
    this.btnSave = document.getElementById('btn-save');
    this.btnDownload = document.getElementById('btn-download');
    this.fileInput = document.getElementById('file-input');
    this.btnSelectFile = document.getElementById('btn-select-file');
    this.dropzone = document.getElementById('dropzone');
    this.urlInput = document.getElementById('url-input');
    this.btnOpenUrl = document.getElementById('btn-open-url');
    this.recentListEl = document.getElementById('recent-list');
  }

  bindEvents() {
    // 4个新建卡片点击
    document.querySelectorAll('.create-card').forEach((card) => {
      card.addEventListener('click', () => {
        const type = card.getAttribute('data-type');
        this.createNewDocument(type);
      });
    });

    // 选择本地文件
    this.btnSelectFile.addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) {
        this.openLocalFile(file);
        this.fileInput.value = '';
      }
    });

    // 拖拽文件到 dropzone
    ['dragenter', 'dragover'].forEach((eventName) => {
      this.dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.dropzone.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach((eventName) => {
      this.dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.dropzone.classList.remove('dragover');
      });
    });

    this.dropzone.addEventListener('drop', (e) => {
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        this.openLocalFile(files[0]);
      }
    });

    // 打开网络链接
    this.btnOpenUrl.addEventListener('click', () => {
      const url = this.urlInput.value.trim();
      if (!url) {
        this.showToast('请输入有效的网络文档链接');
        return;
      }
      this.openUrlDocument(url);
    });

    this.urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.btnOpenUrl.click();
      }
    });

    // 编辑器导航栏按钮
    this.btnBack.addEventListener('click', () => this.closeEditor());

    this.btnSave.addEventListener('click', () => {
      if (this.currentEditor) {
        this.showToast('正在触发保存...');
        // ONLYOFFICE 核心保存指令
        try {
          this.currentEditor.downloadAs?.();
        } catch (err) {
          console.error('保存触发异常:', err);
        }
      }
    });

    this.btnDownload.addEventListener('click', () => {
      if (this.currentEditor) {
        try {
          const doc = this.server.getDocument();
          this.currentEditor.downloadAs?.({ title: doc.title });
        } catch (err) {
          console.error('下载触发异常:', err);
        }
      }
    });
  }

  showLoading(title, subtitle = '基于原生 DecompressionStream 极速流式解压') {
    this.loadingTitle.textContent = title;
    this.loadingSubtitle.textContent = subtitle;
    this.loadingMask.style.display = 'flex';
  }

  hideLoading() {
    this.loadingMask.style.display = 'none';
  }

  showToast(message) {
    this.toastEl.textContent = message;
    this.toastEl.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      this.toastEl.classList.remove('show');
    }, 2800);
  }

  setSaveStatus(saved = true) {
    if (saved) {
      this.saveStatusEl.innerHTML = `🟢 已保存`;
      this.saveStatusEl.style.background = '#dcfce7';
      this.saveStatusEl.style.color = '#166534';
    } else {
      this.saveStatusEl.innerHTML = `🟡 未保存更改`;
      this.saveStatusEl.style.background = '#fef9c3';
      this.saveStatusEl.style.color = '#854d0e';
    }
  }

  /**
   * 处理编辑器保存回调，持久化更新至 IndexedDB
   */
  async handleDocumentSaved(doc) {
    try {
      console.log('[AppManager] 收到文档保存通知:', doc.title);
      await docDB.saveDocument({
        id: this.activeDocId || doc.id,
        title: doc.title,
        fileType: doc.fileType,
        size: doc.data ? doc.data.byteLength : 0,
        updatedAt: Date.now(),
        createdAt: Date.now(),
        data: doc.data,
      });
      this.setSaveStatus(true);
      this.showToast('文档已自动保存到本地库');
    } catch (e) {
      console.error('[AppManager] handleDocumentSaved 失败:', e);
    }
  }

  /**
   * 初始化最近文档（默认为空，清理历史预置种子数据）
   */
  async initRecentDocuments() {
    try {
      let docs = await docDB.getAllDocuments();
      // 清除历史测试种子数据（如以 seed- 开头的默认数据）
      const seeds = docs.filter((d) => d.id && String(d.id).startsWith('seed-'));
      if (seeds.length > 0) {
        for (const s of seeds) {
          await docDB.deleteDocument(s.id);
        }
        docs = await docDB.getAllDocuments();
      }
      this.renderRecentDocuments(docs);
    } catch (err) {
      console.error('加载最近文档错误:', err);
    }
  }

  /**
   * 渲染最近文档列表
   */
  renderRecentDocuments(docs) {
    this.recentListEl.innerHTML = '';
    if (!docs || docs.length === 0) {
      this.recentListEl.innerHTML = `<div class="empty-state">暂无最近打开的文档，可在上方新建或打开文档</div>`;
      return;
    }

    docs.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'recent-item';
      row.innerHTML = `
        <div class="item-left">
          <div class="item-icon">${getDocIcon(item.fileType || getFileExt(item.title))}</div>
          <div class="item-info">
            <div class="item-name" title="${item.title}">${item.title}</div>
            <div class="item-meta">大小: ${formatFileSize(item.size)} | 修改时间: ${formatDateTime(item.updatedAt)}</div>
          </div>
        </div>
        <div class="item-actions">
          <button class="btn-action-open" data-id="${item.id}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            打开
          </button>
          <button class="btn-action-delete" data-id="${item.id}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
            删除
          </button>
        </div>
      `;

      // 绑定行按钮
      row.querySelector('.btn-action-open').addEventListener('click', () => {
        this.openRecentDocument(item.id);
      });

      row.querySelector('.btn-action-delete').addEventListener('click', async (e) => {
        e.stopPropagation();
        await docDB.deleteDocument(item.id);
        this.showToast(`已删除文档: ${item.title}`);
        const newDocs = await docDB.getAllDocuments();
        this.renderRecentDocuments(newDocs);
      });

      this.recentListEl.appendChild(row);
    });
  }

  /**
   * 新建文档并打开
   */
  async createNewDocument(type) {
    this.showLoading(`正在创建${type.toUpperCase()}文档...`, '正在加载内置模板');
    try {
      this.server.openNew(type);
      const doc = this.server.getDocument();

      // 在 IndexedDB 中登记该新文档
      const initialRecord = await docDB.saveDocument({
        title: doc.title,
        fileType: doc.fileType,
        size: 0,
        updatedAt: Date.now(),
        createdAt: Date.now(),
      });
      this.activeDocId = initialRecord.id;

      await this.launchEditor();
    } catch (err) {
      this.hideLoading();
      this.showToast('创建文档失败: ' + err.message);
      console.error(err);
    }
  }

  /**
   * 打开本地选择的文件
   */
  async openLocalFile(file) {
    this.showLoading(`正在打开本地文档: ${file.name}`, '通过 DecompressionStream 准备 x2t 转换内核');
    try {
      const buffer = await file.arrayBuffer();
      const ext = getFileExt(file.name) || 'docx';

      await this.server.openBinary(buffer, file.name, ext);

      // 保存到 IndexedDB
      const record = await docDB.saveDocument({
        title: file.name,
        fileType: ext,
        size: file.size,
        updatedAt: file.lastModified || Date.now(),
        createdAt: Date.now(),
        data: buffer,
      });
      this.activeDocId = record.id;

      await this.launchEditor();
    } catch (err) {
      this.hideLoading();
      this.showToast('打开文件失败: ' + err.message);
      console.error(err);
    }
  }

  /**
   * 打开网络链接文档
   */
  async openUrlDocument(url) {
    this.showLoading('正在下载并解析网络文档...', url);
    try {
      await this.server.openUrl(url);
      const doc = this.server.getDocument();

      const record = await docDB.saveDocument({
        title: doc.title,
        fileType: doc.fileType,
        size: 0,
        updatedAt: Date.now(),
        createdAt: Date.now(),
      });
      this.activeDocId = record.id;

      await this.launchEditor();
    } catch (err) {
      this.hideLoading();
      this.showToast('无法打开网络文档: ' + err.message);
      console.error(err);
    }
  }

  /**
   * 从 IndexedDB 打开最近文档
   */
  async openRecentDocument(id) {
    this.showLoading('正在从本地数据库加载文档...', '加载中');
    try {
      const record = await docDB.getDocument(id);
      if (!record) {
        throw new Error('未找到该文档记录');
      }

      this.activeDocId = id;
      if (record.data) {
        await this.server.openBinary(record.data, record.title, record.fileType);
      } else {
        // 如果未存二进制，则按文件类型打开新建空模板
        this.server.openNew(record.fileType || 'docx');
      }

      await this.launchEditor();
    } catch (err) {
      this.hideLoading();
      this.showToast('打开历史文档失败: ' + err.message);
      console.error(err);
    }
  }

  /**
   * 启动并挂载 ONLYOFFICE 编辑器实例
   */
  async launchEditor() {
    const doc = this.server.getDocument();
    const user = this.server.getUser();
    const documentType = getDocumentType(doc.fileType);

    this.docTitleEl.textContent = doc.title;
    this.setSaveStatus(true);

    // 切换视图到编辑器
    this.mainWrapper.style.display = 'none';
    this.editorContainer.style.display = 'flex';

    // 绑定 MockSocket
    MockSocket.on('connect', this.server.handleConnect);
    MockSocket.on('disconnect', this.server.handleDisconnect);

    // 确保 API 脚本已加载
    await this.ensureDocsApi();

    // 清理旧 DOM 占位符
    this.editorPlaceholder.innerHTML = '';

    const onAppReady = () => {
      console.log('[AppManager] ONLYOFFICE onAppReady 触发，注入 Iframe 代理...');
      const iframe = document.querySelector('iframe[name="frameEditor"]');
      if (!iframe) return;
      const win = iframe.contentWindow;
      if (!win) return;

      const xhr = createXHRProxy(win.XMLHttpRequest, win);
      const fetchProxy = createFetchProxy(win, win);
      const _Worker = win.Worker;

      xhr.use((req) => this.server.handleRequest(req));
      fetchProxy.use((req) => this.server.handleRequest(req));

      Object.assign(win, {
        io: io,
        XMLHttpRequest: xhr,
        fetch: fetchProxy,
        Worker: function (url, options) {
          const u = new URL(url, location.origin);
          return new _Worker(u.href.replace(u.origin, location.origin), options);
        },
      });
    };

    if (window.DocsAPI?.DocEditor?.version) {
      this.server.setClient({
        buildVersion: window.DocsAPI.DocEditor.version(),
      });
    }

    // 实例化 DocEditor
    this.currentEditor = new window.DocsAPI.DocEditor('editor-placeholder', {
      document: {
        fileType: doc.fileType,
        key: doc.key,
        title: doc.title,
        url: doc.url,
        // PDF 必须先确定 isForm：原生实现会加载 common 引导帧，
        // 再向服务端 POST /downloadfile/{key} 探测文档是否为扩展 PDF 表单。
        // 静态离线环境没有该接口，这里用相同的签名规则在本地判定，
        // 既保证表单类 PDF 仍进入表单编辑器，也彻底消除该额外请求。
        ...(documentType === 'pdf' ? { isForm: isExtendedPdfFile(this.server.sourceData) } : {}),
        permissions: {
          edit: doc.fileType !== 'pdf',
          chat: false,
          rename: true,
          protect: true,
          review: false,
          print: true,
        },
      },
      documentType: documentType,
      editorConfig: {
        lang: 'zh-CN',
        coEditing: {
          mode: 'fast',
          change: false,
        },
        user: {
          ...user,
        },
        customization: {
          uiTheme: 'default',
          // 编辑器默认的“帮助/反馈”入口会跳转到 onlyoffice.com（helpcenter / feedback / support），
          // 本项目全部资源与页面都走自己的域名，这里关闭这两个纯外部跳转的入口。
          // 需要恢复时删掉下面两行即可。
          help: false,
          feedback: false,
          features: {
            spellcheck: {
              change: false,
            },
          },
          logo: {
            image: location.origin + '/logo-name_black.svg',
            imageDark: location.origin + '/logo-name_white.svg',
            url: location.origin,
          },
        },
      },
      events: {
        onAppReady: () => {
          onAppReady();
        },
        onDocumentReady: () => {
          console.log('[AppManager] 文档渲染完毕！');
          this.hideLoading();
        },
        onDocumentStateChange: (e) => {
          if (e.data) {
            this.setSaveStatus(false);
          }
        },
        onError: (err) => {
          console.error('[AppManager] 编辑器报错详情:', JSON.stringify(err), err?.data, err?.message, err?.description);
          this.hideLoading();
          this.showToast('编辑器提示: ' + (err?.data || ''));
        },
      },
      type: 'desktop',
      width: '100%',
      height: '100%',
    });
  }

  /**
   * 文档保存回调（当用户保存或下载时自动持久化到本地数据库）
   */
  async handleDocumentSaved({ id, title, fileType, data }) {
    console.log('[AppManager] 收到文档保存通知，同步至 IndexedDB:', title);
    try {
      await docDB.saveDocument({
        id: this.activeDocId || ('doc_' + Date.now()),
        title: title,
        fileType: fileType,
        size: data ? data.byteLength : 0,
        updatedAt: Date.now(),
        data: data,
      });
      this.setSaveStatus(true);
      this.showToast('文档已安全同步至本地数据库！');
    } catch (e) {
      console.error('同步保存至 IndexedDB 失败:', e);
    }
  }

  /**
   * 关闭编辑器，返回管理器主界面
   */
  async closeEditor() {
    this.showLoading('正在返回文档管理器...');
    try {
      if (this.currentEditor) {
        MockSocket.off('connect', this.server.handleConnect);
        MockSocket.off('disconnect', this.server.handleDisconnect);
        try {
          this.currentEditor.destroyEditor?.();
        } catch (e) {}
        this.currentEditor = null;
      }

      this.editorPlaceholder.innerHTML = '';
      this.editorContainer.style.display = 'none';
      this.mainWrapper.style.display = 'block';

      // 刷新最近文件列表
      const docs = await docDB.getAllDocuments();
      this.renderRecentDocuments(docs);
    } finally {
      this.hideLoading();
    }
  }

  ensureDocsApi() {
    return new Promise((resolve, reject) => {
      if (window.DocsAPI && window.DocsAPI.DocEditor) {
        resolve();
        return;
      }
      const scriptUrl = './v9.3.0.24-1/web-apps/apps/api/documents/api.js';
      const existing = document.querySelector(`script[src="${scriptUrl}"]`);
      if (existing) {
        existing.onload = () => resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = scriptUrl;
      script.onload = () => resolve();
      script.onerror = (e) => reject(new Error('加载 ONLYOFFICE api.js 失败'));
      document.head.appendChild(script);
    });
  }
}

// 页面加载完成后启动应用
window.addEventListener('DOMContentLoaded', () => {
  window.app = new AppManager();
});
