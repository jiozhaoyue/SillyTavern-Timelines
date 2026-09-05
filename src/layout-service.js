/**
 * LayoutService: 管理 Web Worker 异步布局与主线程自动降级
 */

class LayoutService {
    constructor() {
        this._worker = null;
        this._msgId = 1;
        this._pendingRequests = new Map();
        this._workerDisabled = false;
    }

    /**
     * 初始化或获取已有 Worker
     */
    _getWorker() {
        if (this._workerDisabled || typeof Worker === 'undefined') {
            return null;
        }
        if (this._worker) {
            return this._worker;
        }

        try {
            const workerUrl = new URL('./layout.worker.js', import.meta.url);
            this._worker = new Worker(workerUrl, { type: 'module' });

            this._worker.onmessage = (event) => {
                const { id, type, positions, error } = event.data || {};
                const pending = this._pendingRequests.get(id);
                if (!pending) return;

                this._pendingRequests.delete(id);
                if (type === 'LAYOUT_SUCCESS' && positions) {
                    pending.resolve({ success: true, positions });
                } else {
                    console.warn('Timelines LayoutWorker 返回错误：', error);
                    pending.resolve({ success: false, error });
                }
            };

            this._worker.onerror = (err) => {
                console.warn('Timelines LayoutWorker 遇到异常，降级为主线程布局：', err);
                for (const pending of this._pendingRequests.values()) {
                    pending.resolve({ success: false, error: err });
                }
                this._pendingRequests.clear();
                this._workerDisabled = true;
                this._worker = null;
            };

            return this._worker;
        } catch (e) {
            console.warn('Timelines 无法创建 Web Worker，降级为主线程布局：', e);
            this._workerDisabled = true;
            return null;
        }
    }

    /**
     * 异步计算节点布局坐标
     *
     * @param {Array} cyElements - 包含 nodes 和 edges 的 Cytoscape 数据集
     * @param {Object} layoutOptions - 布局选项参数 (rankDir, nodeSep, rankSep 等)
     * @param {number} [timeoutMs=10000] - 超时时间
     * @returns {Promise<{ success: boolean, positions: Object|null }>}
     */
    async computeLayout(cyElements, layoutOptions, timeoutMs = 10000) {
        const worker = this._getWorker();
        if (!worker) {
            return { success: false, positions: null };
        }

        const nodes = [];
        const edges = [];
        for (const ele of cyElements || []) {
            if (ele.group === 'nodes' && ele.data?.id) {
                nodes.push({
                    id: ele.data.id,
                    width: ele.data.nodeWidth || Number(layoutOptions.nodeWidth) || 25,
                    height: ele.data.nodeHeight || Number(layoutOptions.nodeHeight) || 25,
                });
            } else if (ele.group === 'edges' && ele.data?.source && ele.data?.target) {
                edges.push({
                    id: ele.data.id || `${ele.data.source}->${ele.data.target}`,
                    source: ele.data.source,
                    target: ele.data.target,
                });
            }
        }

        const id = this._msgId++;
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                if (this._pendingRequests.has(id)) {
                    this._pendingRequests.delete(id);
                    console.warn(`Timelines 异步布局超时 (${timeoutMs}ms)，降级为主线程布局。`);
                    resolve({ success: false, positions: null });
                }
            }, timeoutMs);

            this._pendingRequests.set(id, {
                resolve: (res) => {
                    clearTimeout(timer);
                    resolve(res);
                },
            });

            // 过滤掉不可序列化的函数，避免 postMessage 触发 DataCloneError
            const serializableOptions = {};
            for (const [k, v] of Object.entries(layoutOptions || {})) {
                if (typeof v !== 'function') {
                    serializableOptions[k] = v;
                }
            }

            try {
                worker.postMessage({
                    id,
                    type: 'CALCULATE_LAYOUT',
                    nodes,
                    edges,
                    layoutOptions: serializableOptions,
                });
            } catch (err) {
                clearTimeout(timer);
                this._pendingRequests.delete(id);
                console.warn('Timelines: 发送 Worker 布局任务失败：', err);
                resolve({ success: false, positions: null });
            }
        });
    }

    /**
     * 销毁并终止 Worker
     */
    terminate() {
        if (this._worker) {
            this._worker.terminate();
            this._worker = null;
        }
        this._pendingRequests.clear();
    }
}

export const layoutService = new LayoutService();
