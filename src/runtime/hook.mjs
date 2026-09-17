#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dispatchNotification } from './notifier-client.mjs';

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
  const activeAgents = Number(first(data, ['agent_count', 'active_agents', 'task_count', 'subagent_count']) || 0);
  const lower = String(event).toLowerCase();
  const notificationType = String(first(data, ['notification_type', 'type', 'reason']) || '').toLowerCase();

  if (/userprompt|beforeagent|agent_start|sessionstart/.test(lower)) {
    const now = Date.now();
    writeState(session, { state: 'RUN', startedAt: now, updatedAt: now });
    return;
  }

  if (/notification|pretooluse/.test(lower)) {
    const isError = /error|fail/.test(notificationType) || Boolean(data.error);
    const needsAnswer = notificationNeedsAnswer(event, notificationType, isError);
    writeState(session, { state: isError ? 'ERROR' : 'WAIT', updatedAt: Date.now() });
    dispatchNotification('Notify', {
      session, cli, project,
      category: isError ? 'error' : 'attention',
      title: isError ? `${cli} error` : needsAnswer ? `${cli} needs answer` : `${cli} needs attention`,
      body: String(first(data, ['message', 'error', 'toolCall.args.questions.0.question']) || 'Open the CLI to continue.').slice(0, 240),
      immediate: true,
      requiresAnswer: needsAnswer,
    });
    return;
  }

  if (/stop|afteragent|agent_settled|agent_end/.test(lower)) {
    const previous = readState(session);
    if (activeAgents > 0) {
      writeState(session, {
        state: 'RUN', agentCount: activeAgents,
        startedAt: previous.startedAt || previous.updatedAt || Date.now(), updatedAt: Date.now(),
      });
      return;
    }
    writeState(session, { state: 'READY', updatedAt: Date.now() });
    const startedAt = previous.startedAt || previous.updatedAt;
    if (!startedAt || Date.now() - startedAt < 30000) return;
    dispatchNotification('Notify', {
      session, cli, project, category: 'complete', title: `${cli} complete`,
      body: project ? `${project} is ready for input.` : 'Ready for input.', immediate: false,
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
