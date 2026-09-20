#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dispatchNotification } from './notifier-client.mjs';
import { agyMetadataTitle } from './renderer.mjs';

const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const stateDir = path.join(runtimeDir, 'state');

function arg(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function readInput() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    if (raw.length > 1024 * 1024) return {};
    return JSON.parse(raw || '{}');
  } catch { return null; }
}

function first(data, keys) {
  for (const key of keys) {
    let value = data;
    for (const part of key.split('.')) value = value?.[part];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function identity(data, cli) {
  return String(first(data, ['session_id', 'sessionId', 'conversation_id', 'conversationId']) || `${cli}:${first(data, ['cwd', 'workspace.current_dir']) || 'default'}`);
}

function stateFile(session) {
  const hash = crypto.createHash('sha256').update(session).digest('hex').slice(0, 24);
  return path.join(stateDir, `${hash}.json`);
}

function writeState(session, value) {
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    const file = stateFile(session);
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(value));
    fs.renameSync(temp, file);
  } catch { /* display state is optional */ }
}

function readState(session) {
  try { return JSON.parse(fs.readFileSync(stateFile(session), 'utf8')); } catch { return {}; }
}

function projectName(data) {
  const cwd = String(first(data, ['cwd', 'workspace.current_dir', 'workspace.project_dir']) || '');
  return cwd.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).at(-1) || '';
}

export function cleanTaskTitle(value, limit = 24) {
  if (!value) return '';
  let text = String(value)
    .replace(/<[a-zA-Z0-9_-]+[^>]*>[\s\S]*?<\/[a-zA-Z0-9_-]+>/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0) || '';

  text = text.replace(/^\/[a-zA-Z0-9_-]+\s*/, '');
  text = text.replace(/[*_~#]+/g, '');
  text = text.replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return '';

  const clauseMatch = text.match(/^([^，。；！？\n]+)[，。；！？]/);
  if (clauseMatch && clauseMatch[1].trim().length >= 4 && clauseMatch[1].trim().length <= limit) {
    return clauseMatch[1].trim();
  }
  if (text.length > limit) {
    return `${text.slice(0, limit - 1)}…`;
  }
  return text;
}

export function cleanProjectName(value, limit = 18) {
  if (!value) return '';
  const text = String(value).trim();
  if (text.length > limit) {
    return `${text.slice(0, limit - 1)}…`;
  }
  return text;
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 1000) return '';
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds} 秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分钟`;
}

export function buildNotificationContent({
  cli = 'CLI',
  project = '',
  title = '',
  fullTitle = '',
  sessionId = '',
  category = 'complete',
  needsAnswer = false,
  elapsed = 0,
  detail = '',
} = {}) {
  const isError = category === 'error';
  const statusZh = isError
    ? '执行出错'
    : (needsAnswer ? '等待确认' : (category === 'complete' ? '任务完成' : '需要关注'));

  const compactTitle = cleanTaskTitle(title, 24);
  const compactProject = cleanProjectName(project, 18);
  const shortId = sessionId ? String(sessionId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 8) : '';

  let header = `【${cli}`;
  if (compactProject) {
    header += ` · ${compactProject}`;
  } else if (!compactTitle && shortId) {
    header += ` · #${shortId}`;
  }
  header += '】';

  let notifTitle = '';
  if (compactTitle) {
    notifTitle = `${header}${compactTitle} · ${statusZh}`;
  } else {
    notifTitle = `${header}${statusZh}`;
  }

  const duration = formatDuration(elapsed);
  const taskName = fullTitle || title || '';
  let notifBody = '';

  if (category === 'complete') {
    if (taskName) {
      notifBody = `任务「${cleanTaskTitle(taskName, 48)}」已完成${duration ? ` (耗时 ${duration})` : ''}，等待输入。`;
    } else if (duration) {
      notifBody = `任务已执行完成 (耗时 ${duration})，等待输入。`;
    } else {
      notifBody = '任务已执行完成，等待输入。';
    }
  } else if (isError) {
    notifBody = detail ? `遇到错误：${cleanTaskTitle(detail, 80)}。请切回窗口排查。` : '命令执行遇到异常，请切回窗口排查。';
  } else if (needsAnswer) {
    notifBody = detail ? `等待确认：${cleanTaskTitle(detail, 80)}。请切回终端处理。` : '终端等待您的确认或回答，请切回窗口继续。';
  } else {
    notifBody = detail ? `提示：${cleanTaskTitle(detail, 80)}。请切回窗口查看。` : 'CLI 需要交互处理，请切回窗口查看。';
  }

  return { title: notifTitle, body: notifBody };
}

export function notificationNeedsAnswer(event, notificationType, isError = false) {
  if (isError) return false;
  const lowerEvent = String(event || '').toLowerCase();
  const lowerType = String(notificationType || '').toLowerCase();
  return /pretooluse/.test(lowerEvent) || /agent_needs_input|elicitation_dialog|ask_question/.test(lowerType);
}

function handle(data) {
  const cli = arg('cli', 'CLI');
  const event = arg('event', first(data, ['hook_event_name']) || '');
  const session = identity(data, cli);
  const project = projectName(data);
  let activeAgents = Number(first(data, [
    'agent_count', 'agentCount',
    'active_agents', 'activeAgents',
    'running_agents', 'runningAgents',
    'subagent_count', 'subagentCount',
    'active_subagents', 'activeSubagents',
    'task_count', 'taskCount',
    'active_tasks', 'activeTasks',
  ]) || 0);
  if (!activeAgents) {
    const list = first(data, ['subagents', 'sub_agents', 'active_subagents', 'agents', 'tasks']);
    if (Array.isArray(list)) {
      activeAgents = list.filter((item) => {
        if (typeof item === 'object' && item !== null) {
          const st = String(item.state || item.status || item.run_state || 'running').toLowerCase();
          return !/complete|completed|done|finished|settled|stopped|stop|fail|failed|error/i.test(st);
        }
        return true;
      }).length;
    }
  }
  const lower = String(event).toLowerCase();
  const notificationType = String(first(data, ['notification_type', 'type', 'reason']) || '').toLowerCase();

  if (/subagent_start|subagentstart/.test(lower)) {
    const previous = readState(session);
    const count = activeAgents > 0 ? activeAgents : (previous.agentCount || 0) + 1;
    writeState(session, {
      ...previous,
      state: 'RUN', agentCount: count,
      startedAt: previous.startedAt || previous.updatedAt || Date.now(), updatedAt: Date.now(),
    });
    return;
  }

  if (/subagent_stop|subagentstop|subagent_end/.test(lower)) {
    const previous = readState(session);
    const count = activeAgents > 0 ? activeAgents : Math.max(0, (previous.agentCount || 1) - 1);
    writeState(session, {
      ...previous,
      state: count > 0 ? 'RUN' : (previous.state || 'RUN'),
      agentCount: count,
      startedAt: previous.startedAt || previous.updatedAt || Date.now(), updatedAt: Date.now(),
    });
    return;
  }

  if (/userprompt|beforeagent|agent_start|sessionstart/.test(lower)) {
    const now = Date.now();
    const previous = readState(session);
    const rawPrompt = first(data, ['prompt', 'user_prompt', 'message']);
    const promptSummary = rawPrompt ? cleanTaskTitle(rawPrompt, 24) : '';
    const fullPrompt = rawPrompt ? cleanTaskTitle(rawPrompt, 60) : '';
    const suppliedTitle = cleanTaskTitle(first(data, [
      'conversation_title', 'conversationTitle', 'title', 'session_title', 'sessionTitle', 'session_name', 'sessionName',
    ]), 36);
    let title = suppliedTitle || promptSummary || previous.title || '';
    if (!title && String(cli).toLowerCase() === 'agy') {
      try { title = agyMetadataTitle(session) || ''; } catch {}
    }
    const fullTitle = suppliedTitle || fullPrompt || previous.fullTitle || title || '';
    writeState(session, {
      ...previous,
      state: 'RUN',
      title,
      fullTitle,
      project: project || previous.project || '',
      startedAt: now,
      updatedAt: now,
    });
    return;
  }

  if (/notification|pretooluse/.test(lower)) {
    const previous = readState(session);
    const isError = /error|fail/.test(notificationType) || Boolean(data.error);
    const needsAnswer = notificationNeedsAnswer(event, notificationType, isError);
    writeState(session, { ...previous, state: isError ? 'ERROR' : 'WAIT', updatedAt: Date.now() });

    const suppliedTitle = cleanTaskTitle(first(data, [
      'conversation_title', 'conversationTitle', 'title', 'session_title', 'sessionTitle', 'session_name', 'sessionName',
    ]), 36);
    let title = suppliedTitle || previous.title || '';
    if (!title && String(cli).toLowerCase() === 'agy') {
      try { title = agyMetadataTitle(session) || ''; } catch {}
    }
    const fullTitle = previous.fullTitle || title;
    const proj = project || previous.project || '';
    const detail = String(first(data, ['message', 'error', 'toolCall.args.questions.0.question']) || '').trim();

    const { title: notifTitle, body: notifBody } = buildNotificationContent({
      cli,
      project: proj,
      title,
      fullTitle,
      sessionId: session,
      category: isError ? 'error' : 'attention',
      needsAnswer,
      detail,
    });

    dispatchNotification('Notify', {
      session, cli, project: proj,
      category: isError ? 'error' : 'attention',
      title: notifTitle,
      body: notifBody,
      immediate: true,
      requiresAnswer: needsAnswer,
    });
    return;
  }

  if (/stop|afteragent|agent_settled|agent_end/.test(lower)) {
    const previous = readState(session);
    if (activeAgents > 0) {
      writeState(session, {
        ...previous,
        state: 'RUN', agentCount: activeAgents,
        startedAt: previous.startedAt || previous.updatedAt || Date.now(), updatedAt: Date.now(),
      });
      return;
    }
    writeState(session, { ...previous, state: 'READY', updatedAt: Date.now() });
    const startedAt = previous.startedAt || previous.updatedAt;
    if (!startedAt || Date.now() - startedAt < 30000) return;

    const suppliedTitle = cleanTaskTitle(first(data, [
      'conversation_title', 'conversationTitle', 'title', 'session_title', 'sessionTitle', 'session_name', 'sessionName',
    ]), 36);
    let title = suppliedTitle || previous.title || '';
    if (!title && String(cli).toLowerCase() === 'agy') {
      try { title = agyMetadataTitle(session) || ''; } catch {}
    }
    const fullTitle = previous.fullTitle || title;
    const proj = project || previous.project || '';
    const elapsed = Date.now() - startedAt;

    const { title: notifTitle, body: notifBody } = buildNotificationContent({
      cli,
      project: proj,
      title,
      fullTitle,
      sessionId: session,
      category: 'complete',
      elapsed,
    });

    dispatchNotification('Notify', {
      session, cli, project: proj, category: 'complete', title: notifTitle,
      body: notifBody, immediate: false,
      startedAt,
    });
  }

}

export function main() {
  try {
    const data = readInput();
    if (data) handle(data);
    const protocol = arg('protocol');
    if (protocol === 'gemini') process.stdout.write('{}\n');
    if (protocol === 'agy') process.stdout.write(arg('event').toLowerCase() === 'pretooluse' ? '{"decision":"allow"}\n' : '{}\n');
  } catch {
    const protocol = arg('protocol');
    if (protocol === 'gemini' || protocol === 'agy') process.stdout.write('{}\n');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
