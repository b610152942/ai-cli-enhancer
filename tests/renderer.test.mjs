import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeStatus, renderStatus } from '../src/runtime/renderer.mjs';

test('renders only useful normalized fields without ANSI colors', () => {
  const line = renderStatus({
    state: 'RUN', branch: 'develop', dirty: true, project: 'demo',
    model: 'gpt-5.6-sol', effort: 'xhigh', contextPercent: 27,
    agentCount: 2, permission: 'bypassPermissions',
  }, 120);
  assert.equal(line, '[RUN] cwd demo | gpt-5.6-sol/xhigh | ctx 27% | develop* | agents 2 | unrestricted');
  assert.equal(line.includes('\u001b'), false);
});

test('keeps one line and drops optional fields on narrow terminals', () => {
  const line = renderStatus({
    state: 'WAIT', branch: 'feature/long-branch', dirty: false, project: 'demo',
    model: 'very-long-model-name', effort: 'maximum', contextPercent: 88,
    agentCount: 12, permission: 'unrestricted',
  }, 44);
  assert.equal(line.includes('\n'), false);
  assert.ok(line.length <= 44);
  assert.match(line, /^\[WAIT\]/);
});

test('adds semantic ANSI colors after fitting without changing visible text', () => {
  const status = {
    cli: 'Agy', state: 'WAIT', branch: 'main', dirty: true, project: 'demo',
    model: 'Gemini 3.8 Flash (High)', effort: '', title: 'Review changes', sessionId: '',
    contextTokens: 920000, contextWindow: 1000000, contextPercent: 92,
    agentCount: 2, permission: 'unrestricted',
  };
  const plain = renderStatus(status, 160);
  const colored = renderStatus(status, 160, { colors: true });
  assert.equal(colored.replace(/\x1b\[[0-9;]*m/g, ''), plain);
  assert.match(colored, /\x1b\[1m\x1b\[33m\[WAIT\]/);
  assert.match(colored, /\x1b\[31mctx 920k\/1M \(92%\)/);
  assert.match(colored, /\x1b\[35m3\.8 Flash High/);
});

test('uses a compact home marker for the current directory', () => {
  const previous = process.env.HOME;
  process.env.HOME = '/home/example-user';
  try {
    const status = normalizeStatus({ cwd: '/home/example-user', model: 'gemini-test' }, 'Agy');
    assert.equal(status.project, '~');
    assert.equal(renderStatus(status), '[READY] new | gemini-test | cwd ~');
  } finally {
    if (previous === undefined) delete process.env.HOME;
    else process.env.HOME = previous;
  }
});

test('Agy shows session, directory, context, agents, and a compact model', () => {
  const line = renderStatus({
    cli: 'Agy', state: 'RUN', branch: '', dirty: false, project: 'demo',
    model: 'gemini-test', effort: 'high', contextPercent: 12,
    agentCount: 2, permission: '',
  });
  assert.equal(line, '[RUN] new | gemini-test high | cwd demo | ctx 12% | agents 2');
});

test('renders a sanitized title and exact context tokens when provided', () => {
  const status = normalizeStatus({
    session_id: '12345678-abcd',
    conversation_title: '  Fix auth\nmodule  ',
    model: { display_name: 'gemini-test' },
    context_window: {
      total_input_tokens: 22000,
      total_output_tokens: 2500,
      context_window_size: 1000000,
      used_percentage: 2.45,
    },
  }, 'Agy');
  assert.equal(status.title, 'Fix auth module');
  assert.equal(renderStatus(status), '[READY] Fix auth module | gemini-test | cwd ? | ctx 25k/1M (2%)');
});

test('Agy uses one line when all conversation details fit', () => {
  const line = renderStatus({
    cli: 'Agy', state: 'RUN', project: 'demo', branch: 'main', dirty: false,
    model: 'Gemini 3.8 Flash (High)', effort: '', title: 'Fix auth', sessionId: '',
    contextTokens: 25000, contextWindow: 1000000, contextPercent: 3,
    agentCount: 2, permission: '',
  }, 120);
  assert.equal(line, '[RUN] Fix auth | 3.8 Flash High | cwd demo | ctx 25k/1M (3%) | main | agents 2');
  assert.equal(line.includes('\n'), false);
});

test('Agy keeps session, directory, and exact context on a narrow terminal', () => {
  const line = renderStatus({
    cli: 'Agy', state: 'READY', project: '~', branch: '', dirty: false,
    model: 'Gemini 3.8 Flash (High)', effort: '', title: '', sessionId: '',
    contextTokens: 0, contextWindow: 1000000, contextPercent: 0,
    agentCount: 0, permission: '',
  }, 50);
  assert.equal(line, '[READY] new | 3.8 Flash High\ncwd ~ | ctx 0/1M (0%)');
  assert.ok(line.split('\n').every((part) => part.length <= 50));
});

test('falls back to a short session id when no title is available', () => {
  const status = normalizeStatus({ session_id: 'abcdef12-3456', model: 'test-model' }, 'CodeBuddy');
  assert.equal(renderStatus(status), '[READY] #abcdef12 | cwd ? | test-model');
});

test('Agy reads an exact cached metadata title without reading conversation history', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-title-'));
  const previous = process.env.AI_CLI_ENHANCER_AGY_HOME;
  const sessionId = '12345678-abcd-4abc-8def-1234567890ab';
  try {
    const cacheDir = path.join(root, '.gemini', 'antigravity-cli', 'cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, 'conversation_metadata.json'), JSON.stringify({
      conversations: { [sessionId]: { summary: { Title: 'Repair Agy display' } } },
    }));
    process.env.AI_CLI_ENHANCER_AGY_HOME = root;
    const status = normalizeStatus({ session_id: sessionId, model: 'gemini-test' }, 'Agy');
    assert.equal(status.title, 'Repair Agy display');
    assert.equal(renderStatus(status), '[READY] Repair Agy display | gemini-test | cwd ?');
  } finally {
    if (previous === undefined) delete process.env.AI_CLI_ENHANCER_AGY_HOME;
    else process.env.AI_CLI_ENHANCER_AGY_HOME = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Agy labels its compact session fallback explicitly', () => {
  const status = normalizeStatus({ session_id: '1d1ed82a-9260-4f9e-ae7a-c5ad1f275cb7', model: 'gemini-test' }, 'Agy');
  assert.equal(status.sessionId, '1d1ed82a-9260-4f9e-ae7a-c5ad1f275cb7');
  assert.equal(renderStatus(status), '[READY] sid 1d1ed82a | gemini-test | cwd ?');
});
