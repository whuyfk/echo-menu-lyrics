import { evaluateFilters } from './core.js';

export class FilterRunner {
  constructor() { this.pending = null; this.destroyed = false; }
  cancel() { this.pending?.cancel(); this.pending = null; }
  async run(lines, config) {
    this.cancel();
    if (this.destroyed) throw new Error('过滤器已关闭');
    if (!config.filterCredits && !config.customFilters.length) return lines.map(() => false);
    const source = `const evaluate = ${evaluateFilters.toString()}; onmessage = e => { try { postMessage({ result: evaluate(e.data.lines, e.data.config) }); } catch(error) { postMessage({ error: error.message }); } };`;
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    let worker;
    try { worker = new Worker(url); } finally { URL.revokeObjectURL(url); }
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (error, result) => {
        if (settled) return; settled = true; clearTimeout(timer); worker.terminate();
        if (this.pending === task) this.pending = null;
        if (error) reject(error); else resolve(result);
      };
      const task = { cancel: () => done(new DOMException('过滤任务已替换', 'AbortError')) };
      const timer = setTimeout(() => done(new Error('过滤执行超时，请简化正则；本次自定义过滤未应用')), 350);
      this.pending = task;
      worker.onmessage = event => event.data.error ? done(new Error(event.data.error)) : done(null, event.data.result);
      worker.onerror = event => done(new Error(event.message || '过滤器启动失败'));
      worker.postMessage({ lines, config });
    });
  }
  dispose() { this.destroyed = true; this.cancel(); }
}
