import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  applyJsonPatches, restoreJsonPatches, applyTomlKeys, restoreTomlKeys, readJson, writeJsonAtomic,
} from '../src/config-store.mjs';

test('JSON rollback restores only values still owned by the enhancer', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enhancer-json-'));
  const file = path.join(root, 'settings.json');
  writeJsonAtomic(file, { model: 'keep', ui: { footer: ['old'] } });
  const messages = [];
  const record = applyJsonPatches(file, [
    { path: ['ui', 'footer'], value: ['new'] },
    { path: ['notifications'], value: true },
  ], {}, (level, message) => messages.push([level, message]));
  const changed = readJson(file);
  changed.ui.footer = ['user-choice'];
  writeJsonAtomic(file, changed);
  const result = restoreJsonPatches(record, (level, message) => messages.push([level, message]));
  const restored = readJson(file);
  assert.deepEqual(restored.ui.footer, ['user-choice']);
  assert.equal('notifications' in restored, false);
  assert.equal(restored.model, 'keep');
  assert.equal(result.conflicts, 1);
});

test('TOML rollback preserves unrelated sections and comments', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enhancer-toml-'));
  const file = path.join(root, 'config.toml');
  fs.writeFileSync(file, '# user config\nmodel = "demo"\n\n[features]\nhooks = true\n');
  const record = applyTomlKeys(file, 'tui', {
    notifications: 'true',
    status_line: '["run-state", "model"]',
  });
  assert.match(fs.readFileSync(file, 'utf8'), /\[tui\]/);
  restoreTomlKeys(record);
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /# user config/);
  assert.match(text, /\[features\]\nhooks = true/);
  assert.doesNotMatch(text, /\[tui\]/);
});
