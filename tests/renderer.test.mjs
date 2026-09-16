import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStatus, renderStatus } from '../src/runtime/renderer.mjs';

test('renders only useful normalized fields without ANSI colors', () => {
  const line = renderStatus({
    state: 'RUN', branch: 'develop', dirty: true, project: 'demo',
    model: 'gpt-5.6-sol', effort: 'xhigh', contextPercent: 27,
    agentCount: 2, permission: 'bypassPermissions',
  }, 120);
  assert.equal(line, '[RUN] develop* | gpt-5.6-sol/xhigh | ctx 27% | agents 2 | unrestricted');
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

test('does not expose the user directory name as a project', () => {
  const previous = process.env.HOME;
  process.env.HOME = '/home/example-user';
  try {
    const status = normalizeStatus({ cwd: '/home/example-user', model: 'gemini-test' }, 'Agy');
    assert.equal(status.project, '');
    assert.equal(renderStatus(status), '[READY]');
  } finally {
    if (previous === undefined) delete process.env.HOME;
    else process.env.HOME = previous;
  }
});

test('Agy omits model and directory already shown by its native header', () => {
  const line = renderStatus({
    cli: 'Agy', state: 'RUN', branch: '', dirty: false, project: 'demo',
    model: 'gemini-test', effort: 'high', contextPercent: 12,
    agentCount: 2, permission: '',
  });
  assert.equal(line, '[RUN] | ctx 12% | agents 2');
});
