import { Worker as NodeWorker } from 'node:worker_threads';
import { resolveObjectURL } from 'node:buffer';

// Runs the production browser worker source in a real isolated Node worker.
export class BrowserWorker {
  constructor(url) {
    const blob = resolveObjectURL(url);
    this.terminated = false;
    this.queue = [];
    this.ready = blob.text().then(source => {
      if (this.terminated) return;
      this.worker = new NodeWorker(`const {parentPort}=require('node:worker_threads');let onmessage;const postMessage=data=>parentPort.postMessage(data);${source}\nparentPort.on('message',data=>onmessage({data}));`, { eval: true });
      this.worker.on('message', data => this.onmessage?.({ data }));
      this.worker.on('error', error => this.onerror?.(error));
      this.queue.forEach(value => this.worker.postMessage(value)); this.queue = [];
    }).catch(error => this.onerror?.(error));
  }
  postMessage(message) { if (this.worker) this.worker.postMessage(message); else this.queue.push(message); }
  terminate() { this.terminated = true; this.worker?.terminate(); }
}
