/**
 * Timelines IndexedDB 增量持久化缓存模块
 *
 * 用于在浏览器端持久化保存各个聊天会话的消息数据与拓扑骨架。
 * 当 IndexedDB 不可用（如隐身模式或权限受限）时，自动降级为会话级内存缓存。
 */

const DB_NAME = 'st_timelines_cache_v1';
const DB_VERSION = 1;
const STORE_CHATS = 'chats';
const STORE_META = 'metadata';

class TimelinesCache {
    constructor() {
        this._db = null;
        this._initPromise = null;
        this._isSupported = typeof indexedDB !== 'undefined';
        this._memoryFallback = new Map(); // scopeKey:fileName -> entry
    }

    /**
     * 打开并初始化 IndexedDB 数据库
     *
     * @returns {Promise<IDBDatabase|null>}
     */
    async openDatabase() {
        if (!this._isSupported) {
            return null;
        }
        if (this._db) {
            return this._db;
        }
        if (this._initPromise) {
            return this._initPromise;
        }

        this._initPromise = new Promise((resolve) => {
            try {
                const request = indexedDB.open(DB_NAME, DB_VERSION);

                request.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    if (!db.objectStoreNames.contains(STORE_CHATS)) {
                        const chatStore = db.createObjectStore(STORE_CHATS, { keyPath: 'storageKey' });
                        chatStore.createIndex('scopeKey', 'scopeKey', { unique: false });
                        chatStore.createIndex('updatedAt', 'updatedAt', { unique: false });
                    }
                    if (!db.objectStoreNames.contains(STORE_META)) {
                        db.createObjectStore(STORE_META, { keyPath: 'scopeKey' });
                    }
                };

                request.onsuccess = (event) => {
                    this._db = event.target.result;
                    this._db.onclose = () => {
                        this._db = null;
                        this._initPromise = null;
                    };
                    resolve(this._db);
                };

                request.onerror = (event) => {
                    console.warn('Timelines: 打开 IndexedDB 失败，降级为内存缓存：', event?.target?.error);
                    this._db = null;
                    resolve(null);
                };
            } catch (err) {
                console.warn('Timelines: IndexedDB 抛出异常，降级为内存缓存：', err);
                this._db = null;
                resolve(null);
            }
        });

        return this._initPromise;
    }

    /**
     * 生成统一的缓存主键
     */
    makeStorageKey(scopeKey, fileName) {
        return `${scopeKey}::${fileName.replace('.jsonl', '')}`;
    }

    /**
     * 获取单个聊天缓存
     *
     * @param {string} scopeKey - 角色或群组标识
     * @param {string} fileName - 聊天文件名
     * @returns {Promise<Object|null>}
     */
    async getChat(scopeKey, fileName) {
        const storageKey = this.makeStorageKey(scopeKey, fileName);
        const db = await this.openDatabase();

        if (!db) {
            return this._memoryFallback.get(storageKey) || null;
        }

        return new Promise((resolve) => {
            try {
                const tx = db.transaction(STORE_CHATS, 'readonly');
                const store = tx.objectStore(STORE_CHATS);
                const req = store.get(storageKey);

                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => resolve(this._memoryFallback.get(storageKey) || null);
            } catch (e) {
                resolve(this._memoryFallback.get(storageKey) || null);
            }
        });
    }

    /**
     * 批量获取指定聊天文件的缓存记录
     *
     * @param {string} scopeKey - 角色或群组标识
     * @param {Array<string>} fileNames - 文件名列表
     * @returns {Promise<Map<string, Object>>}
     */
    async getBatchChats(scopeKey, fileNames) {
        const result = new Map();
        if (!Array.isArray(fileNames) || fileNames.length === 0) {
            return result;
        }

        const db = await this.openDatabase();
        if (!db) {
            for (const fn of fileNames) {
                const key = this.makeStorageKey(scopeKey, fn);
                const item = this._memoryFallback.get(key);
                if (item) result.set(fn, item);
            }
            return result;
        }

        return new Promise((resolve) => {
            try {
                const tx = db.transaction(STORE_CHATS, 'readonly');
                const store = tx.objectStore(STORE_CHATS);

                let completed = 0;
                for (const fn of fileNames) {
                    const key = this.makeStorageKey(scopeKey, fn);
                    const req = store.get(key);
                    req.onsuccess = () => {
                        if (req.result) {
                            result.set(fn, req.result);
                        }
                        completed += 1;
                        if (completed === fileNames.length) resolve(result);
                    };
                    req.onerror = () => {
                        completed += 1;
                        if (completed === fileNames.length) resolve(result);
                    };
                }
            } catch (e) {
                resolve(result);
            }
        });
    }

    /**
     * 保存单个聊天文件缓存
     *
     * @param {string} scopeKey - 角色或群组标识
     * @param {string} fileName - 文件名
     * @param {Array} messages - 消息列表
     * @param {Object} [meta] - 额外元数据
     */
    async setChat(scopeKey, fileName, messages, meta = {}) {
        const storageKey = this.makeStorageKey(scopeKey, fileName);
        const lastMsg = Array.isArray(messages) && messages.length > 0 ? messages[messages.length - 1] : null;

        const entry = {
            storageKey,
            scopeKey,
            fileName,
            messages,
            messageCount: messages?.length ?? 0,
            lastMessageText: lastMsg?.mes ?? '',
            lastMessageDate: lastMsg?.send_date ?? '',
            updatedAt: Date.now(),
            ...meta,
        };

        this._memoryFallback.set(storageKey, entry);
        const db = await this.openDatabase();
        if (!db) return;

        return new Promise((resolve) => {
            try {
                const tx = db.transaction(STORE_CHATS, 'readwrite');
                const store = tx.objectStore(STORE_CHATS);
                store.put(entry);
                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve();
            } catch (e) {
                resolve();
            }
        });
    }

    /**
     * 删除指定作用域下的单个聊天缓存
     *
     * @param {string} scopeKey - 角色或群组标识
     * @param {string} fileName - 聊天文件名
     */
    async removeChat(scopeKey, fileName) {
        const storageKey = this.makeStorageKey(scopeKey, fileName);
        this._memoryFallback.delete(storageKey);

        const db = await this.openDatabase();
        if (!db) return;

        return new Promise((resolve) => {
            try {
                const tx = db.transaction(STORE_CHATS, 'readwrite');
                const store = tx.objectStore(STORE_CHATS);
                store.delete(storageKey);
                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve();
            } catch (e) {
                resolve();
            }
        });
    }

    /**
     * 删除指定作用域（如某角色）的所有缓存
     *
     * @param {string} scopeKey - 角色或群组标识
     */
    async clearScope(scopeKey) {
        // 清理内存回退
        for (const [key] of this._memoryFallback) {
            if (key.startsWith(`${scopeKey}::`)) {
                this._memoryFallback.delete(key);
            }
        }

        const db = await this.openDatabase();
        if (!db) return;

        return new Promise((resolve) => {
            try {
                const tx = db.transaction(STORE_CHATS, 'readwrite');
                const store = tx.objectStore(STORE_CHATS);
                const index = store.index('scopeKey');
                const req = index.openKeyCursor(IDBKeyRange.only(scopeKey));

                req.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (cursor) {
                        store.delete(cursor.primaryKey);
                        cursor.continue();
                    }
                };
                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve();
            } catch (e) {
                resolve();
            }
        });
    }

    /**
     * 清空全部缓存
     */
    async clearAll() {
        this._memoryFallback.clear();
        const db = await this.openDatabase();
        if (!db) return;

        return new Promise((resolve) => {
            try {
                const tx = db.transaction([STORE_CHATS, STORE_META], 'readwrite');
                tx.objectStore(STORE_CHATS).clear();
                tx.objectStore(STORE_META).clear();
                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve();
            } catch (e) {
                resolve();
            }
        });
    }

    /**
     * 获取当前缓存占用统计
     *
     * @returns {Promise<{ chatCount: number, estimatedBytes: number }>}
     */
    async getStorageUsage() {
        const db = await this.openDatabase();
        if (!db) {
            let totalBytes = 0;
            for (const item of this._memoryFallback.values()) {
                totalBytes += JSON.stringify(item).length;
            }
            return { chatCount: this._memoryFallback.size, estimatedBytes: totalBytes };
        }

        return new Promise((resolve) => {
            try {
                const tx = db.transaction(STORE_CHATS, 'readonly');
                const store = tx.objectStore(STORE_CHATS);
                const countReq = store.count();

                countReq.onsuccess = () => {
                    // 读取所有估算体积
                    let totalBytes = 0;
                    const cursorReq = store.openCursor();
                    cursorReq.onsuccess = (e) => {
                        const cursor = e.target.result;
                        if (cursor) {
                            totalBytes += JSON.stringify(cursor.value).length;
                            cursor.continue();
                        } else {
                            resolve({
                                chatCount: countReq.result || 0,
                                estimatedBytes: totalBytes,
                            });
                        }
                    };
                    cursorReq.onerror = () => resolve({ chatCount: countReq.result || 0, estimatedBytes: totalBytes });
                };
                countReq.onerror = () => resolve({ chatCount: 0, estimatedBytes: 0 });
            } catch (e) {
                resolve({ chatCount: 0, estimatedBytes: 0 });
            }
        });
    }
}

export const timelinesCache = new TimelinesCache();
