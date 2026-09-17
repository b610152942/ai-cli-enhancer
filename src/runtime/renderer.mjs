#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const stateDir = path.join(runtimeDir, 'state');

function readInput() {
  try {
    const text = fs.readFileSync(0, { encoding: 'utf8', flag: 'r' });
    if (text.length > 1024 * 1024) return {};
    return JSON.parse(text || '{}');
  } catch {
    return {};
  }
}

function valueAt(data, candidates) {
  for (const candidate of candidates) {
    let value = data;
    for (const part of candidate.split('.')) value = value?.[part];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function numberAt(data, candidates) {
  const value = Number(valueAt(data, candidates));
  return Number.isFinite(value) ? value : undefined;
}

function sumFirstGroup(data, groups) {
  for (const candidates of groups) {
    let total = 0;
    let found = false;
    for (const candidate of candidates) {
      const value = numberAt(data, [candidate]);
      if (value === undefined) continue;
      total += value;
      found = true;
    }
    if (found) return total;
  }
  return undefined;
}

function compactTokens(value) {
  if (!Number.isFinite(value) || value < 0) return '';
  if (value >= 10_000_000) return `${Math.round(value / 1_000_000)}M`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (value >= 10_000) return `${Math.round(value / 1_000)}k`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(Math.round(value));
}

function cleanTitle(value, limit = 36) {
  const text = String(value || '').replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
}

function shortSession(value) {
  return String(value || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 8);
}

function sessionKey(data, cli) {
  const raw = valueAt(data, ['session_id', 'sessionId', 'conversation_id', 'conversationId']) || `${cli}:${valueAt(data, ['cwd', 'workspace.current_dir', 'workspace.project_dir']) || 'default'}`;
  return crypto.createHash('sha256').update(String(raw)).digest('hex').slice(0, 24);
}

function readRuntimeState(data, cli) {
  try {
    return JSON.parse(fs.readFileSync(path.join(stateDir, `${sessionKey(data, cli)}.json`), 'utf8'));
  } catch {
    return {};
  }
}

function shortProject(cwd) {
  if (!cwd) return '';
  const normalized = String(cwd).replace(/[\\/]+$/, '').replace(/\\/g, '/');
  const home = String(process.env.USERPROFILE || process.env.HOME || '')
    .replace(/[\\/]+$/, '').replace(/\\/g, '/');
  if (home && normalized.toLowerCase() === home.toLowerCase()) return '~';
  return normalized.split('/').filter(Boolean).at(-1) || normalized;
}

function compactAgyModel(model, effort) {
  let value = String(model || 'model')
    .replace(/^gemini[-\s]+(?=\d)/i, '')
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (effort && !value.toLowerCase().includes(String(effort).toLowerCase())) {
    value = `${value} ${effort}`;
  }
  return value;
}

function cachedGit(cwd) {
  if (!cwd) return {};
  const id = crypto.createHash('sha256').update(String(cwd)).digest('hex').slice(0, 20);
  const cacheFile = path.join(stateDir, `git-${id}.json`);
  try {
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (Date.now() - cached.checkedAt < 5000) return cached;
  } catch { /* refresh below */ }

  let result = { checkedAt: Date.now() };
  try {
    const branch = spawnSync('git', ['-C', cwd, 'branch', '--show-current'], {
      encoding: 'utf8', timeout: 180, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (branch.status === 0) {
      result.branch = branch.stdout.trim() || 'detached';
      const dirty = spawnSync('git', ['-C', cwd, 'status', '--porcelain', '--untracked-files=no'], {
        encoding: 'utf8', timeout: 180, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
      });
      result.dirty = dirty.status === 0 && Boolean(dirty.stdout.trim());
    }
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(result));
  } catch { /* git information is optional */ }
  return result;
}

export function normalizeStatus(data, cli = 'cli') {
  const runtime = readRuntimeState(data, cli);
  const cwd = valueAt(data, ['workspace.current_dir', 'workspace.project_dir', 'cwd', 'current_dir']);
  const git = cachedGit(cwd);
  const rawState = String(valueAt(data, ['agent_state', 'state', 'status']) || runtime.state || 'READY').toUpperCase();
  const state = /ERROR|FAIL/.test(rawState) ? 'ERROR'
    : /WAIT|INPUT|PERMISSION|BLOCK/.test(rawState) ? 'WAIT'
      : /RUN|WORK|THINK|BUSY|TOOL|STREAM/.test(rawState) ? 'RUN' : 'READY';
  const model = valueAt(data, ['model.display_name', 'model.id', 'model_name', 'model', 'current_model']) || runtime.model || '';
  const effort = valueAt(data, ['reasoning_effort', 'effort', 'thinking_level', 'model.reasoning_effort']) || '';
  let context = numberAt(data, [
    'context_percent', 'context_used_percent', 'context_window.used_percentage',
    'context_window.used_percent', 'context.usage_percent', 'context.percentage',
  ]);
  if (context !== undefined && context <= 1) context *= 100;
  const contextTokens = sumFirstGroup(data, [
    ['context_window.total_input_tokens', 'context_window.total_output_tokens'],
    [
      'context_window.current_usage.input_tokens', 'context_window.current_usage.output_tokens',
      'context_window.current_usage.cache_creation_input_tokens',
      'context_window.current_usage.cache_read_input_tokens',
    ],
    ['context.tokens', 'context.token_count'],
  ]);
  const contextWindow = numberAt(data, [
    'context_window.context_window_size', 'context_window.size',
    'context.window_size', 'context.limit',
  ]);
  const title = cleanTitle(valueAt(data, [
    'conversation_title', 'conversationTitle', 'session_title', 'sessionTitle',
    'session_name', 'sessionName', 'conversation.name', 'session.name',
  ]));
  const sessionId = shortSession(valueAt(data, [
    'session_id', 'sessionId', 'conversation_id', 'conversationId', 'thread_id', 'threadId',
  ]));
  const permission = String(valueAt(data, ['permission_mode', 'permissions.mode', 'approval_mode', 'sandbox']) || '');
  const agentCount = numberAt(data, ['agent_count', 'active_agents', 'task_count', 'subagent_count']);
  const contextPercent = context === undefined && contextTokens !== undefined && contextWindow > 0
    ? (contextTokens / contextWindow) * 100
    : context;
  return {
    cli,
    state,
    project: shortProject(cwd),
    branch: valueAt(data, ['git_branch', 'git.branch', 'branch']) || git.branch || '',
    dirty: Boolean(valueAt(data, ['git_dirty', 'git.dirty', 'dirty']) ?? git.dirty),
    model: String(model),
    effort: String(effort),
    title,
    sessionId,
    contextPercent: contextPercent === undefined
      ? undefined
      : Math.max(0, Math.min(100, Math.round(contextPercent))),
    contextTokens,
    contextWindow,
    permission,
    agentCount: agentCount && agentCount > 0 ? Math.floor(agentCount) : 0,
  };
}

function fit(primary, optional, width) {
  let parts = [...primary];
  for (const item of optional) {
    const candidate = [...parts, item].filter(Boolean).join(' | ');
    if (candidate.length <= width) parts.push(item);
  }
  let line = parts.filter(Boolean).join(' | ');
  if (line.length > width) line = width > 3 ? `${line.slice(0, width - 3)}...` : line.slice(0, width);
  return line;
}

export function renderStatus(status, width = 120) {
  const isAgy = String(status.cli || '').toLowerCase() === 'agy';
  const directory = `cwd ${status.project || '?'}`;
  const branch = status.branch ? `${status.branch}${status.dirty ? '*' : ''}` : '';
  const model = status.effort ? `${status.model}/${status.effort}` : status.model;
  const session = status.title || (status.sessionId ? `#${status.sessionId}` : isAgy ? 'new' : '');
  const headline = session || directory;
  const primary = [`[${status.state}]${headline ? ` ${headline}` : ''}`];
  if (session && !isAgy) primary.push(directory);
  const optional = [];
  if (status.contextTokens !== undefined) {
    const window = status.contextWindow ? `/${compactTokens(status.contextWindow)}` : '';
    const percent = status.contextPercent !== undefined ? ` (${status.contextPercent}%)` : '';
    optional.push(`ctx ${compactTokens(status.contextTokens)}${window}${percent}`);
  } else if (status.contextPercent !== undefined) optional.push(`ctx ${status.contextPercent}%`);
  if (isAgy) {
    const lineWidth = Math.max(24, Number(width) || 120);
    const agyModel = compactAgyModel(status.model, status.effort);
    const details = [directory, ...optional];
    const extras = [branch, status.agentCount > 0 ? `agents ${status.agentCount}` : ''];
    if (/bypass|danger|unrestricted|yolo|never|full/i.test(status.permission)) extras.push('unrestricted');
    const singleLine = [...primary, agyModel, ...details, ...extras].filter(Boolean).join(' | ');
    if (singleLine.length <= lineWidth) return singleLine;
    const summary = fit(primary, [agyModel], lineWidth);
    return `${summary}\n${fit(details, extras, lineWidth)}`;
  }
  primary.push(model || 'model');
  if (branch) optional.push(branch);
  if (status.agentCount > 0) optional.push(`agents ${status.agentCount}`);
  if (/bypass|danger|unrestricted|yolo|never|full/i.test(status.permission)) optional.push('unrestricted');
  return fit(primary, optional, Math.max(24, Number(width) || 120));
}

export function main() {
  const cliIndex = process.argv.indexOf('--cli');
  const cli = cliIndex >= 0 ? process.argv[cliIndex + 1] : 'cli';
  const data = readInput();
  const width = numberAt(data, ['terminal.width', 'terminal_width', 'columns']) || process.stdout.columns || process.env.COLUMNS || 120;
  process.stdout.write(renderStatus(normalizeStatus(data, cli), width));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch { process.stdout.write(''); }
}
