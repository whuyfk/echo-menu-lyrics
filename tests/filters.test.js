import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FilterRunner } from '../plugin/src/filters.js';
import { sanitizeConfig } from '../plugin/src/core.js';
import { BrowserWorker } from './worker-adapter.js';
globalThis.Worker = BrowserWorker;

test('the real isolated evaluator handles credit and custom rules', async () => {
  const runner = new FilterRunner();
  try {
    const result = await runner.run([{ original: '吉他：某人', translation: '' }, { original: 'hello', translation: '再见' }], sanitizeConfig({ customFilters: ['再见'] }));
    assert.deepEqual(result, [true, true]);
  } finally { runner.dispose(); }
});
test('catastrophic backtracking is terminated and the next task still works', async () => {
  const runner = new FilterRunner();
  try {
    await assert.rejects(runner.run([{ original: 'a'.repeat(200) + '!', translation: '' }], sanitizeConfig({ customFilters: ['^(a+)+$'] })), /超时/);
    const result = await runner.run([{ original: 'real lyric', translation: '' }], sanitizeConfig());
    assert.deepEqual(result, [false]);
  } finally { runner.dispose(); }
});
test('replacing a filter run cancels the old worker without corrupting the replacement', async () => {
  const runner = new FilterRunner();
  const first = runner.run([{ original: 'a'.repeat(200) + '!', translation: '' }], sanitizeConfig({ customFilters: ['^(a+)+$'] }));
  const rejected = assert.rejects(first, error => error.name === 'AbortError');
  const second = await runner.run([{ original: '作词：某人', translation: '' }], sanitizeConfig());
  await rejected; assert.deepEqual(second, [true]); runner.dispose();
});
