import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeStatus, renderStatus, formatDirectory } from '../src/runtime/renderer.mjs';

test('renders only useful normalized fields without ANSI colors', () => {
  const line = renderStatus({
    state: 'RUN', branch: 'develop', dirty: true, project: 'demo',
    model: 'gpt-5.6-sol', effort: 'xhigh', contextPercent: 27,
    agentCount: 2, permission: 'bypassPermissions',
  }, 120);
  assert.equal(line, '[RUN] demo | gpt-5.6-sol/xhigh | ctx 27% | develop* | agents 2 | unrestricted');
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
  const previousHome = process.env.HOME;
  const previousProfile = process.env.USERPROFILE;
  process.env.HOME = '/home/example-user';
  delete process.env.USERPROFILE;
  try {
    const status = normalizeStatus({ cwd: '/home/example-user', model: 'gemini-test' }, 'Agy');
    assert.equal(status.project, '~');
    assert.equal(status.directory, '~');
    assert.equal(renderStatus(status), '[READY] new | gemini-test | ~');
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previousProfile;
  }
});

test('Agy shows session, directory, context, agents, and a compact model', () => {
  const line = renderStatus({
    cli: 'Agy', state: 'RUN', branch: '', dirty: false, project: 'demo',
    model: 'gemini-test', effort: 'high', contextPercent: 12,
    agentCount: 2, permission: '',
  });
  assert.equal(line, '[RUN] new | gemini-test high | demo | ctx 12% | agents 2');
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
  assert.equal(renderStatus(status), '[READY] Fix auth module | gemini-test | ? | ctx 24.5k/1M (2%)');
});

test('CodeBuddy accurately renders current_usage (136.7k) instead of cumulative session total (4.2M)', () => {
  const status = normalizeStatus({
    session_id: '01a0aedd-9201-7ef8-9cdd-dc582e447009',
    conversation_title: 'Add Amap MCP config to CodeBuddy',
    cwd: 'D:\\AI项目开发\\国庆',
    model: { id: 'deepseek-v4-pro', display_name: 'Deepseek-V4-Pro' },
    permission_mode: 'unrestricted',
    context_window: {
      total_input_tokens: 4153557,
      total_output_tokens: 45296,
      context_window_size: 1000000,
      used_percentage: 14,
      current_usage: {
        input_tokens: 136698,
        output_tokens: 2723,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  }, 'CodeBuddy');
  assert.equal(status.contextTokens, 136698);
  assert.equal(status.contextPercent, 14);
  assert.equal(status.directory, 'D:/AI项目开发/国庆');
  assert.equal(renderStatus(status), '[READY] Add Amap MCP config to CodeBuddy | D:/AI项目开发/国庆 | Deepseek-V4-Pro | ctx 136.7k/1M (14%) | unrestricted');
});

test('Claude Code includes cached tokens in current_usage for context calculation', () => {
  const status = normalizeStatus({
    session_id: 'claude-test-session',
    conversation_title: 'Implement search',
    cwd: '/workspace/project',
    model: { display_name: 'claude-3-7-sonnet' },
    context_window: {
      total_input_tokens: 1800000,
      total_output_tokens: 20000,
      context_window_size: 200000,
      used_percentage: 27,
      current_usage: {
        input_tokens: 4000,
        output_tokens: 800,
        cache_creation_input_tokens: 1000,
        cache_read_input_tokens: 48500,
      },
    },
  }, 'Claude');
  assert.equal(status.contextTokens, 53500);
  assert.equal(status.contextPercent, 27);
  assert.equal(renderStatus(status), '[READY] Implement search | /workspace/project | claude-3-7-sonnet | ctx 53.5k/200k (27%)');
});

test('Defends against cumulative overflow when only total_input_tokens exceeds context_window_size', () => {
  const status = normalizeStatus({
    session_id: 'overflow-test',
    conversation_title: 'Overflow check',
    cwd: '/workspace/test',
    model: { display_name: 'test-model' },
    context_window: {
      total_input_tokens: 3500000,
      total_output_tokens: 50000,
      context_window_size: 200000,
      used_percentage: 15,
    },
  }, 'CodeBuddy');
  assert.equal(status.contextTokens, 30000); // 200000 * 15%
  assert.equal(status.contextPercent, 15);
  assert.equal(renderStatus(status), '[READY] Overflow check | /workspace/test | test-model | ctx 30k/200k (15%)');
});

test('Agy uses one line when all conversation details fit', () => {
  const line = renderStatus({
    cli: 'Agy', state: 'RUN', project: 'demo', branch: 'main', dirty: false,
    model: 'Gemini 3.8 Flash (High)', effort: '', title: 'Fix auth', sessionId: '',
    contextTokens: 25000, contextWindow: 1000000, contextPercent: 3,
    agentCount: 2, permission: '',
  }, 120);
  assert.equal(line, '[RUN] Fix auth | 3.8 Flash High | demo | ctx 25k/1M (3%) | main | agents 2');
  assert.equal(line.includes('\n'), false);
});

test('Agy keeps session, directory, and exact context on a narrow terminal', () => {
  const line = renderStatus({
    cli: 'Agy', state: 'READY', project: '~', branch: '', dirty: false,
    model: 'Gemini 3.8 Flash (High)', effort: '', title: '', sessionId: '',
    contextTokens: 0, contextWindow: 1000000, contextPercent: 0,
    agentCount: 0, permission: '',
  }, 40);
  assert.equal(line, '[READY] new | 3.8 Flash High\n~ | ctx 0/1M (0%)');
  assert.ok(line.split('\n').every((part) => part.length <= 40));
});

test('falls back to a short session id when no title is available', () => {
  const status = normalizeStatus({ session_id: 'abcdef12-3456', model: 'test-model' }, 'CodeBuddy');
  assert.equal(renderStatus(status), '[READY] #abcdef12 | ? | test-model');
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
    assert.equal(renderStatus(status), '[READY] Repair Agy display | gemini-test | ?');
  } finally {
    if (previous === undefined) delete process.env.AI_CLI_ENHANCER_AGY_HOME;
    else process.env.AI_CLI_ENHANCER_AGY_HOME = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Agy labels its compact session fallback explicitly', () => {
  const status = normalizeStatus({ session_id: 'ffffffff-9260-4f9e-ae7a-c5ad1f275cb7', model: 'gemini-test' }, 'Agy');
  assert.equal(status.sessionId, 'ffffffff-9260-4f9e-ae7a-c5ad1f275cb7');
  assert.equal(renderStatus(status), '[READY] sid ffffffff | gemini-test | ?');
});

test('formatDirectory respects home marker and preserves external full path', () => {
  const previousHome = process.env.HOME;
  const previousProfile = process.env.USERPROFILE;
  process.env.HOME = '/home/ubuntu';
  delete process.env.USERPROFILE;
  try {
    assert.equal(formatDirectory('/home/ubuntu'), '~');
    assert.equal(formatDirectory('/home/ubuntu/projects/code'), '~/projects/code');
    assert.equal(formatDirectory('/mnt/d/ai项目开发/stm-paisi'), '/mnt/d/ai项目开发/stm-paisi');
    assert.equal(formatDirectory('D:\\ai-coding\\ai-cli-enhancer'), 'D:/ai-coding/ai-cli-enhancer');
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previousProfile;
  }
});

test('Agy reads title or preview from conversation_summaries.db', async () => {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch {
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-db-'));
  const previous = process.env.AI_CLI_ENHANCER_AGY_HOME;
  const session1 = 'session-with-title';
  const session2 = 'session-with-preview-only';
  try {
    const agyDir = path.join(root, '.gemini', 'antigravity-cli');
    fs.mkdirSync(agyDir, { recursive: true });
    const dbFile = path.join(agyDir, 'conversation_summaries.db');
    const db = new DatabaseSync(dbFile);
    db.exec(`
      CREATE TABLE conversation_summaries (
        conversation_id TEXT PRIMARY KEY,
        title TEXT,
        preview TEXT
      );
      INSERT INTO conversation_summaries (conversation_id, title, preview) VALUES
        ('session-with-title', 'Optimize Code Execution', 'Initial prompt text'),
        ('session-with-preview-only', '', '用户首句提问意图：修复状态栏显示');
    `);
    db.close();

    process.env.AI_CLI_ENHANCER_AGY_HOME = root;
    const status1 = normalizeStatus({ session_id: session1, model: 'gemini-test' }, 'Agy');
    assert.equal(status1.title, 'Optimize Code Execution');

    const status2 = normalizeStatus({ session_id: session2, model: 'gemini-test' }, 'Agy');
    assert.equal(status2.title, '用户首句提问意图：修复状态栏显示');
  } finally {
    if (previous === undefined) delete process.env.AI_CLI_ENHANCER_AGY_HOME;
    else process.env.AI_CLI_ENHANCER_AGY_HOME = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
