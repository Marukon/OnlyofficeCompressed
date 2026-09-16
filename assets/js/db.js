/**
 * db.js - 本地文档持久化管理（IndexedDB）
 * 支持文档内容二进制存储、修改时间、文件大小及元数据记录
 */

const DB_NAME = 'OfficeDocManagerDB';
const DB_VERSION = 1;
const STORE_NAME = 'documents';

class DocDB {
  constructor() {
    this.db = null;
    this.initPromise = this.init();
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error('[DocDB] IndexedDB 打开失败:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  async ready() {
    if (!this.db) {
      await this.initPromise;
    }
    return this.db;
  }

  /**
   * 获取所有最近文档（按修改时间倒序）
   */
  async getAllDocuments() {
    const db = await this.ready();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('updatedAt');
      const request = index.openCursor(null, 'prev'); // 倒序
      const results = [];

      request.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          // 不携带可能很大的完整二进制以提升列表读取性能
          const { data, ...meta } = cursor.value;
          results.push(meta);
          cursor.continue();
        } else {
          resolve(results);
        }
      };

      request.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * 根据 ID 获取完整文档（含二进制数据）
   */
  async getDocument(id) {
    const db = await this.ready();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * 保存或更新文档
   */
  async saveDocument(doc) {
    const db = await this.ready();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      const record = {
        id: doc.id || ('doc_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7)),
        title: doc.title || '未命名文档.docx',
        fileType: doc.fileType || (doc.title ? doc.title.split('.').pop().toLowerCase() : 'docx'),
        size: doc.size || (doc.data ? doc.data.byteLength : 0),
        updatedAt: doc.updatedAt || Date.now(),
        createdAt: doc.createdAt || Date.now(),
        data: doc.data || null,
      };

      const request = store.put(record);
      request.onsuccess = () => resolve(record);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * 删除文档
   */
  async deleteDocument(id) {
    const db = await this.ready();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(id);
      request.onsuccess = () => resolve(true);
      request.onerror = (e) => reject(e.target.error);
    });
  }
}

export const docDB = new DocDB();
