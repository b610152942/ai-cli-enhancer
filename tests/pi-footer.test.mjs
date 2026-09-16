import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTokens, sessionTokens } from '../src/pi-package/extensions/status-footer.js';

test('Pi footer totals only usage-bearing session entries', () => {
  const total = sessionTokens([
    { type: 'message', message: { role: 'assistant', usage: { input: 1000, output: 200, cacheRead: 300, cacheWrite: 40 } } },
    { type: 'message', message: { role: 'toolResult', usage: { input: 20, output: 10, cacheRead: 0, cacheWrite: 0 } } },
    { type: 'message', message: { role: 'user', usage: { input: 9999 } } },
    { type: 'compaction', usage: { input: 400, output: 30, cacheRead: 0, cacheWrite: 0 } },
  ]);
  assert.equal(total, 2000);
  assert.equal(formatTokens(total), '2k');
});
