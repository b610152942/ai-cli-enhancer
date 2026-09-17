import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { notificationNeedsAnswer } from '../src/runtime/hook.mjs';

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

test('only answer-required notifications use the prominent form', () => {
  assert.equal(notificationNeedsAnswer('PreToolUse', ''), true);
  assert.equal(notificationNeedsAnswer('Notification', 'agent_needs_input'), true);
  assert.equal(notificationNeedsAnswer('Notification', 'elicitation_dialog'), true);
  assert.equal(notificationNeedsAnswer('Notification', 'permission_prompt'), false);
  assert.equal(notificationNeedsAnswer('Notification', 'idle_prompt'), false);
  assert.equal(notificationNeedsAnswer('PreToolUse', 'error', true), false);
});
