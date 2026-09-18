#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  // node:sqlite unsupported or unavailable
}

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

function cleanSession(value) {
  return String(value || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 128);
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

function queryAgySqlite(dbFile, sessionId) {
  if (!DatabaseSync || !fs.existsSync(dbFile)) return '';
  try {
    const db = new DatabaseSync(dbFile, { readOnly: true });
    try {
      const stmt = db.prepare('SELECT title, preview FROM conversation_summaries WHERE conversation_id = ?');
      const row = stmt.get(sessionId);
      if (row) {
        const found = cleanTitle(row.title) || cleanTitle(row.preview);
        if (found) return found;
      }
    } finally {
      db.close();
    }
  } catch { /* ignore db read errors */ }
  return '';
}

function agyMetadataTitle(sessionId) {
  if (!sessionId) return '';
  const cacheFile = path.join(stateDir, `agy-title-${crypto.createHash('sha256').update(sessionId).digest('hex').slice(0, 24)}.json`);
  let cached = {};
  try { cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch { /* refresh below */ }

  const homes = [
    process.env.AI_CLI_ENHANCER_AGY_HOME,
    process.env.USERPROFILE,
    process.env.HOME,
  ].filter(Boolean);

  // In WSL environment, also check Windows host home if accessible
  if (process.platform === 'linux') {
    try {
      if (fs.existsSync('/mnt/c/Users')) {
        const users = fs.readdirSync('/mnt/c/Users').filter((u) => !['Public', 'Default', 'Default User', 'All Users'].includes(u));
        for (const u of users) {
          homes.push(`/mnt/c/Users/${u}`);
        }
      }
    } catch { /* ignore fs check errors */ }
  }

  for (const home of [...new Set(homes)]) {
    // 1. Try real-time SQLite database first
    const dbFile = path.join(home, '.gemini', 'antigravity-cli', 'conversation_summaries.db');
    try {
      const stat = fs.statSync(dbFile);
      if (cached.sourceFile === dbFile && cached.mtimeMs === stat.mtimeMs && cached.title) {
        return cached.title;
      }
      const title = queryAgySqlite(dbFile, sessionId);
      if (title) {
        fs.mkdirSync(stateDir, { recursive: true });
        fs.writeFileSync(cacheFile, JSON.stringify({ sourceFile: dbFile, mtimeMs: stat.mtimeMs, title }));
        return title;
      }
    } catch { /* sqlite db is optional */ }

    // 2. Fallback to conversation_metadata.json
    const metadataFile = path.join(home, '.gemini', 'antigravity-cli', 'cache', 'conversation_metadata.json');
    try {
      const stat = fs.statSync(metadataFile);
      if (stat.size > 5 * 1024 * 1024) continue;
      if (cached.sourceFile === metadataFile && cached.mtimeMs === stat.mtimeMs && cached.title) {
        return cached.title;
      }
      const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
      const conv = metadata?.conversations?.[sessionId];
      const title = cleanTitle(conv?.summary?.Title) || cleanTitle(conv?.summary?.Preview);
      if (title) {
        fs.mkdirSync(stateDir, { recursive: true });
        fs.writeFileSync(cacheFile, JSON.stringify({ sourceFile: metadataFile, mtimeMs: stat.mtimeMs, title }));
        return title;
      }
    } catch { /* metadata is optional */ }
  }
  return '';
}

export function formatDirectory(cwd) {
  if (!cwd) return '';
  const normalized = String(cwd).replace(/[\\/]+$/, '').replace(/\\/g, '/');
  const homeCandidates = [
    process.env.HOME,
    process.env.USERPROFILE,
  ].filter(Boolean).map((h) => String(h).replace(/[\\/]+$/, '').replace(/\\/g, '/'));

  for (const home of homeCandidates) {
    if (normalized.toLowerCase() === home.toLowerCase()) return '~';
    if (normalized.toLowerCase().startsWith(`${home.toLowerCase()}/`)) {
      return `~${normalized.slice(home.length)}`;
    }
  }
  return normalized;
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

export function extractAgentCount(data, runtime = {}) {
  const direct = numberAt(data, [
    'agent_count', 'agentCount',
    'active_agents', 'activeAgents',
    'running_agents', 'runningAgents',
    'subagent_count', 'subagentCount',
    'active_subagents', 'activeSubagents',
    'running_subagents', 'runningSubagents',
    'task_count', 'taskCount',
    'active_tasks', 'activeTasks',
    'running_tasks', 'runningTasks',
  ]);
  if (direct !== undefined && direct > 0) return Math.floor(direct);

  const arrayCandidates = [
    'subagents', 'sub_agents',
    'active_subagents', 'running_subagents',
    'agents', 'active_agents', 'running_agents',
    'tasks', 'active_tasks', 'running_tasks',
  ];
  for (const candidate of arrayCandidates) {
    const list = valueAt(data, [candidate]);
    if (Array.isArray(list) && list.length > 0) {
      const active = list.filter((item) => {
        if (typeof item === 'object' && item !== null) {
          const st = String(item.state || item.status || item.run_state || 'running').toLowerCase();
          return !/complete|completed|done|finished|settled|stopped|stop|fail|failed|error/i.test(st);
        }
        return true;
      }).length;
      if (active > 0) return active;
    }
  }

  if (typeof runtime?.agentCount === 'number' && runtime.agentCount > 0) {
    return Math.floor(runtime.agentCount);
  }
  return 0;
}

export function normalizeStatus(data, cli = 'cli') {
  const runtime = readRuntimeState(data, cli);
  const cwd = valueAt(data, ['workspace.current_dir', 'workspace.project_dir', 'cwd', 'current_dir']);
  const git = cachedGit(cwd);
  const rawState = String(valueAt(data, ['agent_state', 'state', 'status']) || runtime.state || 'READY').toUpperCase();
  const state = /ERROR|FAIL/.test(rawState) ? 'ERROR'
    : /WAIT|INPUT|PERMISSION|BLOCK/.test(rawState) ? 'WAIT'
      : /RUN|WORK|THINK|BUSY|TOOL|STREAM/.test(rawState) ? 'RUN' : 'READY';
  const model = valueAt(data, [
    'session_model',
    'session.model',
    'override_model',
    'session.requestOptions.model',
    'session.options.model',
    'model.display_name',
    'model.id',
    'model_name',
    'model',
    'current_model',
  ]) || runtime.model || '';
  const effort = valueAt(data, ['reasoning_effort', 'effort', 'thinking_level', 'model.reasoning_effort']) || '';
  let context = numberAt(data, [
    'context_percent', 'context_used_percent', 'context_window.used_percentage',
    'context_window.used_percent', 'context.usage_percent', 'context.percentage',
  ]);
  if (context !== undefined && context <= 1) context *= 100;
  let contextTokens = sumFirstGroup(data, [
    [
      'context_window.current_usage.input_tokens',
      'context_window.current_usage.cache_read_input_tokens',
      'context_window.current_usage.cache_creation_input_tokens',
    ],
    ['context.tokens', 'context.token_count', 'context_tokens', 'context_window.context_tokens'],
    ['context_window.input_tokens'],
    ['context_window.total_input_tokens', 'context_window.total_output_tokens'],
    ['context_window.total_input_tokens'],
  ]);
  const contextWindow = numberAt(data, [
    'context_window.context_window_size', 'context_window.size',
    'context.window_size', 'context.limit',
  ]);
  if (contextTokens !== undefined && contextWindow > 0 && contextTokens > contextWindow && context !== undefined) {
    contextTokens = Math.round(contextWindow * (context / 100));
  }
  const sessionId = cleanSession(valueAt(data, [
    'session_id', 'sessionId', 'conversation_id', 'conversationId', 'thread_id', 'threadId',
  ]));
  const suppliedTitle = cleanTitle(valueAt(data, [
    'conversation_title', 'conversationTitle', 'session_title', 'sessionTitle',
    'session_name', 'sessionName', 'conversation.name', 'session.name',
  ]));
  const title = suppliedTitle || (String(cli).toLowerCase() === 'agy' ? agyMetadataTitle(sessionId) : '');
  const permission = String(valueAt(data, ['permission_mode', 'permissions.mode', 'approval_mode', 'sandbox']) || '');
  const agentCount = extractAgentCount(data, runtime);
  const contextPercent = context === undefined && contextTokens !== undefined && contextWindow > 0
    ? (contextTokens / contextWindow) * 100
    : context;
  const directory = formatDirectory(cwd);
  return {
    cli,
    state,
    directory,
    project: directory,
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

const ANSI = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m',
};

function ansi(code, text) {
  return `${code}${text}${ANSI.reset}`;
}

function contextColor(percent) {
  if (percent === undefined) return ANSI.green;
  if (percent >= 90) return ANSI.red;
  if (percent >= 70) return ANSI.yellow;
  return ANSI.green;
}

export function colorizeStatus(line, status) {
  const isAgy = String(status.cli || '').toLowerCase() === 'agy';
  const branch = status.branch ? `${status.branch}${status.dirty ? '*' : ''}` : '';
  const models = new Set([
    status.effort ? `${status.model}/${status.effort}` : status.model,
    isAgy ? compactAgyModel(status.model, status.effort) : '',
  ].filter(Boolean));
  const stateColor = status.state === 'ERROR' ? ANSI.red
    : status.state === 'WAIT' ? ANSI.yellow
      : status.state === 'RUN' ? ANSI.cyan : ANSI.green;
  const separator = ansi(ANSI.dim, ' | ');

  return line.split('\n').map((row, rowIndex) => row.split(' | ').map((part, index) => {
    if (rowIndex === 0 && index === 0) {
      return part.replace(/^\[[^\]]+\]/, (value) => ansi(`${ANSI.bold}${stateColor}`, value));
    }
    if (part === status.directory || part === status.project || part.startsWith('cwd ')) return ansi(ANSI.dim, part);
    if (part.startsWith('ctx ')) return ansi(contextColor(status.contextPercent), part);
    if (part.startsWith('agents ')) return ansi(ANSI.blue, part);
    if (part === 'unrestricted') return ansi(`${ANSI.bold}${ANSI.red}`, part);
    if (part === branch) return ansi(status.dirty ? ANSI.yellow : ANSI.cyan, part);
    if (models.has(part)) return ansi(ANSI.magenta, part);
    return part;
  }).join(separator)).join('\n');
}

export function renderStatus(status, width = 120, options = {}) {
  const isAgy = String(status.cli || '').toLowerCase() === 'agy';
  const directory = status.directory || status.project || '?';

  const branch = status.branch ? `${status.branch}${status.dirty ? '*' : ''}` : '';
  const model = status.effort ? `${status.model}/${status.effort}` : status.model;
  const session = status.title || (status.sessionId
    ? isAgy ? `sid ${shortSession(status.sessionId)}` : `#${shortSession(status.sessionId)}`
    : isAgy ? 'new' : '');
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
    if (singleLine.length <= lineWidth) return options.colors ? colorizeStatus(singleLine, status) : singleLine;
    const summary = fit(primary, [agyModel], lineWidth);
    const line = `${summary}\n${fit(details, extras, lineWidth)}`;
    return options.colors ? colorizeStatus(line, status) : line;
  }
  primary.push(model || 'model');
  if (branch) optional.push(branch);
  if (status.agentCount > 0) optional.push(`agents ${status.agentCount}`);
  if (/bypass|danger|unrestricted|yolo|never|full/i.test(status.permission)) optional.push('unrestricted');
  const line = fit(primary, optional, Math.max(24, Number(width) || 120));
  return options.colors ? colorizeStatus(line, status) : line;
}

export function main() {
  const cliIndex = process.argv.indexOf('--cli');
  const cli = cliIndex >= 0 ? process.argv[cliIndex + 1] : 'cli';
  const data = readInput();
  const width = numberAt(data, ['terminal.width', 'terminal_width', 'columns']) || process.stdout.columns || process.env.COLUMNS || 120;
  const colors = !Object.hasOwn(process.env, 'NO_COLOR') && process.env.TERM !== 'dumb';
  process.stdout.write(renderStatus(normalizeStatus(data, cli), width, { colors }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch { process.stdout.write(''); }
}
