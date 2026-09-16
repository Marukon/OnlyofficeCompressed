/**
 * ONLYOFFICE Offline In-Browser Editor Runtime
 * Implements client-side EditorServer, MockSocket, XHR/Fetch interception,
 * and Web Worker x2t wasm conversion.
 */

import { emptyDocx, emptyPdf, emptyPptx, emptyXlsx } from './empty.js';

export const AscSaveTypes = {
  PartStart: 0,
  Part: 1,
  Complete: 2,
  CompleteAll: 3,
};

export const DocumentType = {
  Word: 'word',
  Cell: 'cell',
  Slide: 'slide',
  Pdf: 'pdf',
};

export const docTypeMap = {
  docx: 'word', doc: 'word', odt: 'word', rtf: 'word', txt: 'word', html: 'word',
  mht: 'word', epub: 'word', fb2: 'word', mobi: 'word', docm: 'word', dotx: 'word',
  dotm: 'word', oform: 'word', docxf: 'word',
  pptx: 'slide', ppt: 'slide', odp: 'slide', ppsx: 'slide', pptm: 'slide',
  ppsm: 'slide', potx: 'slide', potm: 'slide', otp: 'slide', odg: 'slide',
  xlsx: 'cell', xls: 'cell', ods: 'cell', csv: 'cell', xlsm: 'cell',
  xltx: 'cell', xltm: 'cell', xlsb: 'cell', ots: 'cell',
  pdf: 'pdf',
};

export function getFileExt(name) {
  if (!name) return '';
  const parts = name.split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

export function getDocumentType(ext) {
  const cleanExt = (ext || '').toLowerCase().replace(/^\./, '');
  return docTypeMap[cleanExt] || 'word';
}

function mergeBuffers(buffers) {
  const totalLength = buffers.reduce((acc, buffer) => acc + buffer.length, 0);
  const mergedBuffer = new Uint8Array(totalLength);
  let offset = 0;
  for (const buffer of buffers) {
    mergedBuffer.set(buffer, offset);
    offset += buffer.length;
  }
  return mergedBuffer;
}

function randomId() {
  return Math.random().toString(36).substring(2, 9);
}

function getBlobUrl(data, type = 'application/octet-stream') {
  const blob = new Blob([data], { type });
  return URL.createObjectURL(blob);
}

/**
 * Lightweight EventEmitter for in-browser messaging
 */
export class SimpleEventEmitter {
  constructor() {
    this._events = new Map();
  }

  on(event, listener) {
    if (!this._events.has(event)) {
      this._events.set(event, []);
    }
    this._events.get(event).push(listener);
    return this;
  }

  once(event, listener) {
    const onceWrapper = (...args) => {
      this.off(event, onceWrapper);
      listener(...args);
    };
    return this.on(event, onceWrapper);
  }

  off(event, listener) {
    if (!this._events.has(event)) return this;
    if (!listener) {
      this._events.delete(event);
      return this;
    }
    const listeners = this._events.get(event);
    const index = listeners.indexOf(listener);
    if (index !== -1) {
      listeners.splice(index, 1);
    }
    return this;
  }

  removeAllListeners(event) {
    if (event) {
      this._events.delete(event);
    } else {
      this._events.clear();
    }
    return this;
  }

  emit(event, ...args) {
    if (!this._events.has(event)) return false;
    const listeners = [...this._events.get(event)];
    for (const listener of listeners) {
      try {
        listener(...args);
      } catch (err) {
        console.error(`[EventEmitter] Error in event '${event}':`, err);
      }
    }
    return true;
  }
}

/**
 * Mock Socket.io for ONLYOFFICE communication
 */
export class MockSocket {
  static _staticEmitter = new SimpleEventEmitter();

  static on(event, listener) {
    MockSocket._staticEmitter.on(event, listener);
  }

  static off(event, listener) {
    MockSocket._staticEmitter.off(event, listener);
  }

  constructor(options = {}) {
    this.active = true;
    this.connected = false;
    this.disconnected = true;
    this.id = '';
    this._clientEmitter = new SimpleEventEmitter();
    this._serverEmitter = new SimpleEventEmitter();
    this.io = {
      setOpenToken: () => {},
      setSessionToken: () => {},
      on: () => {},
      reconnectionAttempts: () => {},
      reconnectionDelay: () => {},
      reconnectionDelayMax: () => {},
      timeout: () => {},
      transports: () => {},
      upgrade: () => {},
      upgradeTransport: () => {},
      upgradeTimeout: () => {},
    };

    this.server = {
      on: (event, listener) => this._serverEmitter.on(event, listener),
      off: (event, listener) => this._serverEmitter.off(event, listener),
      emit: (event, ...args) => this._clientEmitter.emit(event, ...args),
    };

    this.connect();
  }

  connect() {
    this.connected = true;
    this.disconnected = false;
    this.id = Math.random().toString(36).substring(2, 15);
    setTimeout(() => {
      this._clientEmitter.emit('connect');
      MockSocket._staticEmitter.emit('connect', { socket: this });
    }, 0);
    return this;
  }

  disconnect() {
    this.connected = false;
    this.disconnected = true;
    this._clientEmitter.emit('disconnect');
    MockSocket._staticEmitter.emit('disconnect', { socket: this });
    return this;
  }

  close() {
    return this.disconnect();
  }

  on(event, listener) {
    this._clientEmitter.on(event, listener);
    return this;
  }

  once(event, listener) {
    this._clientEmitter.once(event, listener);
    return this;
  }

  off(event, listener) {
    this._clientEmitter.off(event, listener);
    return this;
  }

  removeAllListeners(event) {
    this._clientEmitter.removeAllListeners(event);
    return this;
  }

  send(...args) {
    if (!this.connected) return this;
    this.emit('message', ...args);
    return this;
  }

  emit(event, ...args) {
    if (!this.connected) return this;
    setTimeout(() => {
      this._serverEmitter.emit(event, ...args);
    }, 0);
    return this;
  }
}

export function io(url, options) {
  return new MockSocket(options);
}

/**
 * Creates an XMLHttpRequest proxy class that intercepts ONLYOFFICE document server calls
 */
export function createXHRProxy(BaseXHR = globalThis.XMLHttpRequest) {
  return class ProxyXMLHttpRequest extends BaseXHR {
    static _middlewares = [];

    static use(middleware) {
      this._middlewares.push(middleware);
    }

    static clearMiddlewares() {
      this._middlewares = [];
    }

    constructor() {
      super();
      this._isMocked = false;
      this._requestMethod = 'GET';
      this._requestUrl = '';
      this._requestHeaders = new Headers();
      this._requestBody = null;
    }

    open(method, url, async = true, username = null, password = null) {
      this._requestMethod = method;
      this._requestUrl = url.toString();
      this._requestHeaders = new Headers();
      this._isMocked = false;
      super.open(method, url, async, username, password);
    }

    setRequestHeader(name, value) {
      this._requestHeaders.append(name, value);
      if (!this._isMocked) {
        super.setRequestHeader(name, value);
      }
    }

    send(body = null) {
      this._requestBody = body;
      this._tryMiddlewares()
        .then((handled) => {
          if (!handled) {
            super.send(body);
          }
        })
        .catch((err) => {
          console.error('[ProxyXMLHttpRequest] middleware error:', err);
          super.send(body);
        });
    }

    async _tryMiddlewares() {
      let request;
      try {
        const reqInit = {
          method: this._requestMethod,
          headers: this._requestHeaders,
          body: this._requestBody,
          mode: 'cors',
        };
        if (this.withCredentials) {
          reqInit.credentials = 'include';
        }
        request = new Request(this._requestUrl, reqInit);
      } catch (e) {
        return false;
      }

      for (const mw of ProxyXMLHttpRequest._middlewares) {
        const response = await mw(request.clone());
        if (response) {
          this._isMocked = true;
          await this._handleMockResponse(response);
          return true;
        }
      }
      return false;
    }

    async _handleMockResponse(response) {
      this.dispatchEvent(new ProgressEvent('loadstart'));

      Object.defineProperty(this, 'readyState', { value: 2, writable: false, configurable: true });
      this.dispatchEvent(new Event('readystatechange'));

      Object.defineProperty(this, 'readyState', { value: 3, writable: false, configurable: true });
      this.dispatchEvent(new Event('readystatechange'));

      try {
        let responseData;
        if (this.responseType === 'json') {
          responseData = await response.json();
        } else if (this.responseType === 'arraybuffer') {
          responseData = await response.arrayBuffer();
        } else if (this.responseType === 'blob') {
          responseData = await response.blob();
        } else if (this.responseType === 'document') {
          const text = await response.text();
          responseData = new DOMParser().parseFromString(text, 'text/xml');
        } else {
          responseData = await response.text();
        }

        Object.defineProperty(this, 'status', { value: response.status, writable: false, configurable: true });
        Object.defineProperty(this, 'statusText', { value: response.statusText, writable: false, configurable: true });
        Object.defineProperty(this, 'response', { value: responseData, writable: false, configurable: true });
        Object.defineProperty(this, 'responseText', {
          value: typeof responseData === 'string' ? responseData : JSON.stringify(responseData),
          writable: false,
          configurable: true,
        });
        Object.defineProperty(this, 'responseURL', { value: response.url, writable: false, configurable: true });

        this.dispatchEvent(new ProgressEvent('progress', { lengthComputable: true, loaded: 100, total: 100 }));

        Object.defineProperty(this, 'readyState', { value: 4, writable: false, configurable: true });
        this.dispatchEvent(new Event('readystatechange'));
        this.dispatchEvent(new ProgressEvent('load'));
        this.dispatchEvent(new ProgressEvent('loadend'));
      } catch (e) {
        console.error('[ProxyXMLHttpRequest] response handle error:', e);
        Object.defineProperty(this, 'readyState', { value: 4, writable: false, configurable: true });
        this.dispatchEvent(new Event('readystatechange'));
        this.dispatchEvent(new ProgressEvent('error'));
        this.dispatchEvent(new ProgressEvent('loadend'));
      }
    }
  };
}

/**
 * Creates a fetch proxy supporting middleware interception
 */
export function createFetchProxy(target = globalThis.fetch) {
  const middlewares = [];
  const BaseFetch = typeof target === 'function' ? target : target.fetch.bind(target);

  const proxy = async (input, init) => {
    let request;
    try {
      request = new Request(input, init);
    } catch (e) {
      return BaseFetch(input, init);
    }

    try {
      for (const mw of middlewares) {
        const response = await mw(request.clone());
        if (response) return response;
      }
    } catch (err) {
      console.error('[ProxyFetch] middleware error:', err);
    }

    return BaseFetch(request);
  };

  proxy.use = (mw) => middlewares.push(mw);
  proxy.clearMiddlewares = () => { middlewares.length = 0; };
  return proxy;
}

/**
 * X2t WebAssembly Converter proxy using Web Worker
 */
export class X2tConverter {
  constructor(workerUrl = './x2t/x2t.worker.js') {
    this.workerUrl = workerUrl;
    this.worker = null;
    this.initPromise = null;
    this.messageId = 0;
    this.pendingMessages = new Map();
    if (globalThis.Worker) {
      this.init();
    }
  }

  init() {
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      try {
        this.worker = new Worker(this.workerUrl);
        this.worker.onmessage = (event) => {
          const { id, type, payload, error } = event.data;
          if (type === 'ready') {
            console.log('[X2tConverter] Web Worker 就绪！');
            resolve();
            return;
          }
          const pending = this.pendingMessages.get(id);
          if (!pending) return;
          this.pendingMessages.delete(id);
          if (type === 'error' || error) {
            pending.reject(new Error(error || 'Worker error'));
          } else {
            pending.resolve(payload);
          }
        };

        this.worker.onerror = (err) => {
          console.error('[X2tConverter] Worker 异常:', err);
          for (const [, pending] of this.pendingMessages) {
            pending.reject(err);
          }
          this.pendingMessages.clear();
        };

        // Fallback resolve in case ready message was emitted before handler
        setTimeout(resolve, 800);
      } catch (err) {
        this.initPromise = null;
        reject(err);
      }
    });

    return this.initPromise;
  }

  async convert(params) {
    await this.init();
    const id = ++this.messageId;

    return new Promise((resolve, reject) => {
      this.pendingMessages.set(id, { resolve, reject });

      // Clone buffer to avoid detaching caller's reference
      let dataPayload = params.data;
      const transferables = [];
      if (params.data instanceof ArrayBuffer) {
        dataPayload = params.data.slice(0);
        transferables.push(dataPayload);
      }

      this.worker.postMessage(
        {
          id,
          type: 'convert',
          payload: {
            ...params,
            data: dataPayload,
          },
        },
        transferables
      );
    });
  }
}

export const defaultConverter = new X2tConverter('./x2t/x2t.worker.js');

/**
 * ONLYOFFICE In-Browser Document Server
 */
export class EditorServer {
  constructor(options = {}) {
    this.options = options;
    this.converter = options.converter || defaultConverter;
    this.onSaveDocument = options.onSaveDocument || null;

    this.id = '';
    this.socket = null;
    this.sessionId = 'session-' + randomId();
    this.user = { id: 'uid-local', name: '我' };
    this.client = { buildVersion: '9.3.0', buildNumber: 24 };
    this.participants = [];
    this.syncChangesIndex = 0;
    this.loadPromise = null;

    this.fileType = 'docx';
    this.title = '未命名文档.docx';
    this.fsMap = new Map();
    this.urlsMap = new Map();

    this.downloadId = '';
    this.downloadParts = [];

    this.handleConnect = this.handleConnect.bind(this);
    this.handleDisconnect = this.handleDisconnect.bind(this);
    this.handleMessage = this.handleMessage.bind(this);
    this.handleRequest = this.handleRequest.bind(this);
  }

  setUser(user) {
    this.user = { ...this.user, ...user };
  }

  getUser() {
    return this.user;
  }

  setClient(info) {
    this.client = { ...this.client, ...info };
  }

  getDocument() {
    return {
      fileType: this.fileType,
      key: this.id,
      title: this.title,
      url: '/' + this.id,
    };
  }

  openNew(type = 'docx') {
    this.fileType = (type || 'docx').toLowerCase();
    this.id = randomId();
    const docType = getDocumentType(this.fileType);

    const extNames = {
      docx: '新建Word文档.docx',
      xlsx: '新建Excel表格.xlsx',
      pptx: '新建PowerPoint演示.pptx',
      pdf: '新建PDF文档.pdf',
    };
    this.title = extNames[this.fileType] || `新建文档.${this.fileType}`;

    let binData = null;
    switch (docType) {
      case 'word':
        binData = Uint8Array.from(emptyDocx, (v) => v.charCodeAt(0));
        break;
      case 'cell':
        binData = Uint8Array.from(emptyXlsx, (v) => v.charCodeAt(0));
        break;
      case 'slide':
        binData = Uint8Array.from(emptyPptx, (v) => v.charCodeAt(0));
        break;
      case 'pdf':
        binData = Uint8Array.from(emptyPdf, (v) => v.charCodeAt(0));
        break;
    }

    if (!binData) {
      throw new Error(`不支持创建此类型的新文档: ${this.fileType}`);
    }

    this._cleanupUrls();
    this.fsMap.set('Editor.bin', binData);
    this.urlsMap.set('Editor.bin', getBlobUrl(binData));
    this.loadPromise = Promise.resolve();

    return { id: this.id, documentType: docType, title: this.title };
  }

  async openBinary(buffer, fileName, fileType) {
    const ext = (fileType || getFileExt(fileName) || 'docx').toLowerCase();
    this.fileType = ext;
    this.title = fileName || `文档.${ext}`;
    this.id = randomId();
    const docType = getDocumentType(this.fileType);

    this.loadPromise = this._loadDocument(buffer, this.fileType);
    await this.loadPromise;

    return { id: this.id, documentType: docType, title: this.title };
  }

  async openFile(file) {
    const buffer = await file.arrayBuffer();
    return this.openBinary(buffer, file.name, getFileExt(file.name));
  }

  async openUrl(url, fileName, fileType) {
    const title = fileName || decodeURIComponent(url.split('/').pop().split('?')[0] || '文档.docx');
    const ext = fileType || getFileExt(title) || 'docx';

    this.fileType = ext;
    this.title = title;
    this.id = randomId();
    const docType = getDocumentType(this.fileType);

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`无法获取网络文档 (${res.status} ${res.statusText})`);
    }
    const buffer = await res.arrayBuffer();
    this.loadPromise = this._loadDocument(buffer, ext);
    await this.loadPromise;

    return { id: this.id, documentType: docType, title: this.title };
  }

  _cleanupUrls() {
    for (const url of this.urlsMap.values()) {
      try {
        URL.revokeObjectURL(url);
      } catch (e) {}
    }
    this.urlsMap.clear();
    this.fsMap.clear();
  }

  async _loadDocument(buffer, fileType) {
    let output = null;
    let media = {};

    if (fileType === 'pdf') {
      output = new Uint8Array(buffer);
    } else {
      console.log(`[EditorServer] 正在将 ${fileType} 转换为 Editor.bin ...`);
      const result = await this.converter.convert({
        data: buffer,
        fileFrom: 'doc.' + fileType,
        fileTo: 'Editor.bin',
      });
      output = result.output;
      media = result.media || {};
    }

    if (!output) {
      throw new Error('文档格式转换失败');
    }

    this._cleanupUrls();
    this.fsMap.set('Editor.bin', output);
    this.urlsMap.set('Editor.bin', getBlobUrl(output));

    for (const name in media) {
      const pathname = 'media/' + name;
      const url = getBlobUrl(media[name]);
      this.fsMap.set(pathname, media[name]);
      this.urlsMap.set(pathname, url);
    }
    console.log('[EditorServer] 文档转换完成并已装载至内存！');
  }

  handleConnect({ socket }) {
    console.log('[EditorServer] MockSocket 客户端已连接');
    this.socket = socket;
    this.participants = [
      {
        connectionId: this.sessionId,
        encrypted: false,
        id: this.user.id,
        idOriginal: this.user.id,
        indexUser: 1,
        isCloseCoAuthoring: false,
        isLiveViewer: false,
        username: this.user.name,
        view: false,
      },
    ];

    socket.server.on('message', this.handleMessage);

    this.send({
      maxPayload: 100000000,
      pingInterval: 25000,
      pingTimeout: 20000,
      sid: this.sessionId,
      upgrades: [],
    });

    this.send({
      type: 'license',
      license: {
        type: 3,
        buildNumber: this.client.buildNumber || 24,
        buildVersion: this.client.buildVersion || '9.3.0',
        light: false,
        mode: 0,
        rights: 1,
        protectionSupport: true,
        isAnonymousSupport: true,
        liveViewerSupport: true,
        branding: false,
        customization: true,
        advancedApi: false,
      },
    });
  }

  handleDisconnect({ socket }) {
    console.log('[EditorServer] MockSocket 断开连接');
    this.socket = null;
  }

  send(...msg) {
    if (!this.socket) return;
    this.socket.server.emit('message', ...msg);
  }

  async handleMessage(msg) {
    const type = typeof msg === 'object' && msg ? msg.type : null;

    switch (type) {
      case 'auth': {
        this.send({ type: 'authChanges', changes: [] });
        this.send({
          type: 'auth',
          result: 1,
          sessionId: this.sessionId,
          participants: this.participants,
          locks: [],
          indexUser: 1,
          buildVersion: this.client.buildVersion || '9.3.0',
          buildNumber: this.client.buildNumber || 24,
          licenseType: 3,
          editorType: 2,
          mode: 'edit',
          permissions: {
            comment: true,
            chat: false,
            download: true,
            edit: true,
            fillForms: true,
            modifyFilter: true,
            protect: true,
            print: true,
            review: false,
            copy: true,
          },
        });

        try {
          if (this.loadPromise) {
            await this.loadPromise;
          }
          this.send({
            type: 'documentOpen',
            data: {
              type: 'open',
              status: 'ok',
              data: Object.fromEntries(this.urlsMap),
            },
          });
        } catch (err) {
          console.error('[EditorServer] documentOpen 错误:', err);
          this.send({
            type: 'documentOpen',
            data: {
              type: 'open',
              status: 'error',
              data: { 'Editor.bin': '' },
            },
          });
        }
        break;
      }
      case 'isSaveLock': {
        this.send({ type: 'saveLock', saveLock: false });
        break;
      }
      case 'saveChanges': {
        this.send({
          type: 'unSaveLock',
          index: -1,
          syncChangesIndex: ++this.syncChangesIndex,
          time: +new Date(),
        });
        break;
      }
      case 'getLock': {
        this.send({
          type: 'getLock',
          locks: {
            [msg.block]: {
              time: +new Date(),
              user: this.user?.id,
              block: msg.block,
            },
          },
        });
        this.send({
          type: 'releaseLock',
          locks: {
            [msg.block]: {
              time: +new Date(),
              user: this.user?.id,
              block: msg.block,
            },
          },
        });
        break;
      }
    }
  }

  async handleRequest(req) {
    const u = new URL(req.url);
    const key = this.id;

    if (u.pathname.endsWith('/downloadas/' + key)) {
      const cmd = JSON.parse(u.searchParams.get('cmd') || '{}');
      const buffer = await req.arrayBuffer();

      console.log('[EditorServer] downloadAs 请求:', cmd);

      const targetTitle = cmd.title || this.title || 'document.docx';
      const fileToExt = targetTitle.split('.').pop() || this.fileType;
      const fileTo = 'doc.' + fileToExt;
      let formatTo = cmd.outputformat;
      if (!formatTo && fileTo.endsWith('.pdf')) {
        formatTo = 513;
      }

      const executeSave = async () => {
        const input = mergeBuffers(this.downloadParts);
        let fileFrom = 'from.bin';
        if (cmd.format === 'pdf') {
          fileFrom = 'from.pdf';
        }

        let { output } = await this.converter.convert({
          data: input.buffer,
          fileFrom: fileFrom,
          fileTo: fileTo,
          formatTo: formatTo,
          media: Object.fromEntries(this.fsMap),
        });

        if (!output && cmd.format === 'pdf') {
          output = input;
        }

        if (!output) {
          console.error('[EditorServer] 格式导出转换失败');
          return { status: 'error' };
        }

        const finalData = new Uint8Array(output);

        // Trigger browser download if triggered by user download
        const blob = new Blob([finalData]);
        const downloadUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = targetTitle;
        a.click();
        URL.revokeObjectURL(downloadUrl);

        // Notify callback (for auto-saving into IndexedDB)
        if (typeof this.onSaveDocument === 'function') {
          try {
            this.onSaveDocument({
              id: this.id,
              title: targetTitle,
              fileType: fileToExt,
              data: finalData.buffer,
            });
          } catch (e) {
            console.error('[EditorServer] onSaveDocument 回调异常:', e);
          }
        }

        return { status: 'ok' };
      };

      let result = { status: 'ok' };

      switch (cmd.savetype) {
        case AscSaveTypes.PartStart:
          this.downloadId = '_' + Math.round(Math.random() * 1000);
          this.downloadParts = [new Uint8Array(buffer)];
          break;
        case AscSaveTypes.Part:
          this.downloadParts.push(new Uint8Array(buffer));
          break;
        case AscSaveTypes.Complete:
          this.downloadParts.push(new Uint8Array(buffer));
          result = await executeSave();
          this.downloadParts = [];
          break;
        case AscSaveTypes.CompleteAll:
          this.downloadId = '_' + Math.round(Math.random() * 1000);
          this.downloadParts = [new Uint8Array(buffer)];
          result = await executeSave();
          this.downloadParts = [];
          break;
      }

      setTimeout(() => {
        this.send({
          type: 'documentOpen',
          data: {
            type: 'save',
            status: result.status,
            data: 'data:,',
            filetype: fileToExt,
          },
        });
      }, 100);

      return Response.json({
        status: result.status,
        type: 'save',
        data: this.downloadId,
      });
    }

    if (u.pathname.endsWith('/upload/' + key)) {
      const buffer = await req.arrayBuffer();
      const data = new Uint8Array(buffer);
      const filename = Date.now() + '.png';
      const pathname = 'media/' + filename;
      const url = getBlobUrl(data);
      this.fsMap.set(pathname, data);
      this.urlsMap.set(pathname, url);
      return Response.json({ [pathname]: url });
    }

    if (u.pathname === '/plugins.json') {
      return Response.json({ url: '', pluginsData: [], autostart: [] });
    }

    return null;
  }
}
