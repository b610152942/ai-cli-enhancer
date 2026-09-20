import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  notificationNeedsAnswer,
  cleanTaskTitle,
  cleanProjectName,
  formatDuration,
  buildNotificationContent,
} from '../src/runtime/hook.mjs';

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

test('cleanTaskTitle cleans prompts, strips markdown/commands, and splits clauses', () => {
  assert.equal(cleanTaskTitle(''), '');
  assert.equal(cleanTaskTitle('修复状态栏显示'), '修复状态栏显示');
  assert.equal(
    cleanTaskTitle('修复状态栏显示，并且排查其他cli是否还存在这样的问题'),
    '修复状态栏显示'
  );
  assert.equal(
    cleanTaskTitle('开发用户管理列表接口。请注意增加分页和权限校验'),
    '开发用户管理列表接口'
  );
  assert.equal(cleanTaskTitle('/commit feat: 修复状态栏'), 'feat: 修复状态栏');
  assert.equal(cleanTaskTitle('```bash\nnpm run build\n```\n开始构建代码'), '开始构建代码');
  assert.equal(
    cleanTaskTitle('<local-command-caveat>warning</local-command-caveat>修复问题'),
    '修复问题'
  );
  assert.equal(
    cleanTaskTitle('超长无标点任务名称用于测试截断功能是否完全正常工作'),
    '超长无标点任务名称用于测试截断功能是否完全正常…'
  );
});

test('formatDuration formats elapsed time in readable Chinese', () => {
  assert.equal(formatDuration(0), '');
  assert.equal(formatDuration(500), '');
  assert.equal(formatDuration(15000), '15 秒');
  assert.equal(formatDuration(42000), '42 秒');
  assert.equal(formatDuration(75000), '1 分 15 秒');
  assert.equal(formatDuration(120000), '2 分钟');
});

test('buildNotificationContent builds intuitive Chinese notifications with title abbreviation', () => {
  // 1. Task complete with title and project
  const completeWithTitle = buildNotificationContent({
    cli: 'CodeBuddy',
    project: 'stm-paisi',
    title: '修复状态栏显示',
    fullTitle: '修复状态栏显示并检查全 CLI',
    category: 'complete',
    elapsed: 45000,
  });
  assert.equal(completeWithTitle.title, '【CodeBuddy · stm-paisi】修复状态栏显示 · 任务完成');
  assert.equal(completeWithTitle.body, '任务「修复状态栏显示并检查全 CLI」已完成 (耗时 45 秒)，等待输入。');

  // 2. Task complete with project only
  const completeProjectOnly = buildNotificationContent({
    cli: 'Claude',
    project: 'ai-cli-enhancer',
    category: 'complete',
    elapsed: 32000,
  });
  assert.equal(completeProjectOnly.title, '【Claude · ai-cli-enhancer】任务完成');
  assert.equal(completeProjectOnly.body, '任务已执行完成 (耗时 32 秒)，等待输入。');

  // 3. Task needs answer / user confirmation
  const needsAnswer = buildNotificationContent({
    cli: 'Agy',
    project: 'stm-paisi',
    title: '重构数据库连接池',
    category: 'attention',
    needsAnswer: true,
    detail: '是否允许执行命令: npm test?',
  });
  assert.equal(needsAnswer.title, '【Agy · stm-paisi】重构数据库连接池 · 等待确认');
  assert.equal(needsAnswer.body, '等待确认：是否允许执行命令: npm test?。请切回终端处理。');

  // 4. Execution error
  const errorNotif = buildNotificationContent({
    cli: 'CodeBuddy',
    project: 'stm-paisi',
    title: '单元测试',
    category: 'error',
    detail: 'Exit code 1',
  });
  assert.equal(errorNotif.title, '【CodeBuddy · stm-paisi】单元测试 · 执行出错');
  assert.equal(errorNotif.body, '遇到错误：Exit code 1。请切回窗口排查。');
});

test('hook preserves prompt title across UserPromptSubmit and Stop lifecycle', () => {
  const sessionId = 'test-session-' + Date.now();
  const input = JSON.stringify({
    session_id: sessionId,
    cwd: 'D:/ai-coding/stm-paisi',
    prompt: '修复状态栏显示，并且排查其他cli是否还存在这样的问题',
  });
  const resPrompt = spawnSync(process.execPath, [hook, '--cli', 'CodeBuddy', '--event', 'UserPromptSubmit'], {
    input, encoding: 'utf8', timeout: 5000,
  });
  assert.equal(resPrompt.status, 0);

  const hash = crypto.createHash('sha256').update(sessionId).digest('hex').slice(0, 24);
  const statePath = path.join(root, 'src', 'runtime', 'state', `${hash}.json`);
  assert.ok(fs.existsSync(statePath), 'state file should exist');

  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.equal(state.state, 'RUN');
  assert.equal(state.title, '修复状态栏显示');
  assert.equal(state.project, 'stm-paisi');

  try { fs.unlinkSync(statePath); } catch {}
});
