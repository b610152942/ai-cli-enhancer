import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const hook = path.join(root, 'src', 'runtime', 'hook.mjs');

test('hook fails open on malformed input', () => {
  const result = spawnSync(process.execPath, [hook, '--cli', 'Test', '--event', 'Stop'], {
    input: '{bad json', encoding: 'utf8', timeout: 3000,
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
});

test('agy decision hook always emits valid allow JSON', () => {
  const result = spawnSync(process.execPath, [hook, '--cli', 'Agy', '--event', 'PreToolUse', '--protocol', 'agy'], {
    input: '{bad json', encoding: 'utf8', timeout: 3000,
  });
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), { decision: 'allow' });
});
