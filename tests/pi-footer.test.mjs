import test from 'node:test';
import assert from 'node:assert/strict';
import { colorizeFooter, formatTokens, sessionTokens } from '../src/pi-package/extensions/status-footer.js';

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

test('Pi footer uses its active theme for semantic fields', () => {
  const previous = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  const theme = {
    fg: (color, text) => `<${color}>${text}</${color}>`,
    bold: (text) => `<bold>${text}</bold>`,
  };
  try {
    const line = colorizeFooter('[RUN] Fix auth | cwd demo | model-x | ctx 92k/100k | main', theme, {
      state: 'RUN', model: 'model-x', branch: 'main', contextPercent: 92,
    });
    assert.match(line, /<accent><bold>\[RUN\]<\/bold><\/accent>/);
    assert.match(line, /<dim>cwd demo<\/dim>/);
    assert.match(line, /<accent>model-x<\/accent>/);
    assert.match(line, /<error>ctx 92k\/100k<\/error>/);
    assert.match(line, /<warning>main<\/warning>/);
  } finally {
    if (previous === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = previous;
  }
});

test('Pi footer respects NO_COLOR', () => {
  const previous = process.env.NO_COLOR;
  process.env.NO_COLOR = '1';
  try {
    const plain = '[READY] | cwd demo';
    assert.equal(colorizeFooter(plain, { fg: () => 'colored', bold: (text) => text }), plain);
  } finally {
    if (previous === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = previous;
  }
});
