import test from 'node:test';
import assert from 'node:assert/strict';
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
