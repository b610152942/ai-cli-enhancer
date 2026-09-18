import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const extensionDir = path.dirname(fileURLToPath(import.meta.url));
const notifyScript = path.resolve(extensionDir, '..', 'runtime', 'notify.ps1');

function windowsPath(file) {
  if (process.platform === 'win32') return file;
  const mounted = file.match(/^\/mnt\/([a-z])\/(.*)$/i);
  if (mounted) return `${mounted[1].toUpperCase()}:\\${mounted[2].replaceAll('/', '\\')}`;
  return '';
}

function notify(mode, payload) {
  try {
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
    const directScript = windowsPath(notifyScript);
    const scriptArgs = directScript
      ? ['-File', directScript, '-Mode', mode, '-PayloadBase64', encoded]
      : ['-Command', "& (Join-Path $env:LOCALAPPDATA 'AI-CLI-Enhancer\\runtime\\notify.ps1') -Mode $env:AI_CLI_ENHANCER_NOTIFY_MODE -PayloadBase64 $env:AI_CLI_ENHANCER_NOTIFY_PAYLOAD"];
    spawnSync('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      ...scriptArgs,
    ], {
      windowsHide: true,
      stdio: 'ignore',
      timeout: 2500,
      env: {
        ...process.env,
        AI_CLI_ENHANCER_NOTIFY_MODE: mode,
        AI_CLI_ENHANCER_NOTIFY_PAYLOAD: encoded,
      },
    });
  } catch { /* notifications never affect Pi */ }
}

function truncate(text, width) {
  if (text.length <= width) return text;
  return width > 3 ? `${text.slice(0, width - 3)}...` : text.slice(0, width);
}

export function formatTokens(count) {
  if (!Number.isFinite(count) || count < 0) return '';
  if (count >= 10_000_000) return `${Math.round(count / 1_000_000)}M`;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(Math.round(count));
}

function addUsage(total, usage) {
  if (!usage) return total;
  return total + ['input', 'output', 'cacheRead', 'cacheWrite']
    .reduce((sum, key) => sum + (Number.isFinite(usage[key]) ? usage[key] : 0), 0);
}

export function sessionTokens(entries = []) {
  let total = 0;
  for (const entry of entries) {
    if (entry?.type === 'message' && entry.message?.role === 'assistant') {
      total = addUsage(total, entry.message.usage);
    } else if (entry?.type === 'message' && entry.message?.role === 'toolResult') {
      total = addUsage(total, entry.message.usage);
    } else if (entry?.type === 'branch_summary' || entry?.type === 'compaction') {
      total = addUsage(total, entry.usage);
    }
  }
  return total;
}

function cleanTitle(value, limit = 30) {
  const text = String(value || '').replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
}

function piContextColor(percent) {
  if (percent === null || percent === undefined || percent < 70) return 'success';
  if (percent >= 90) return 'error';
  return 'warning';
}

export function colorizeFooter(line, theme, details = {}) {
  if (!theme || Object.hasOwn(process.env, 'NO_COLOR')) return line;
  const separator = theme.fg('dim', ' | ');
  return line.split(' | ').map((part, index) => {
    if (index === 0) {
      const color = details.state === 'RUN' ? 'accent' : details.state === 'ERROR' ? 'error' : 'success';
      return part.replace(/^\[[^\]]+\]/, (value) => theme.fg(color, theme.bold(value)));
    }
    if (part.startsWith('cwd ')) return theme.fg('dim', part);
    if (part.startsWith('ctx ')) return theme.fg(piContextColor(details.contextPercent), part);
    if (part.startsWith('used ')) return theme.fg('muted', part);
    if (part === details.model) return theme.fg('accent', part);
    if (part === details.branch) return theme.fg('warning', part);
    return part;
  }).join(separator);
}

export default function (pi) {
  let state = 'READY';
  let startedAt = 0;
  let requestRender = () => {};
  let currentContext;

  pi.on('session_start', async (_event, ctx) => {
    currentContext = ctx;
    if (ctx.mode !== 'tui') return;
    ctx.ui.setFooter((tui, theme, footerData) => {
      requestRender = () => tui.requestRender();
      const unsubscribe = footerData.onBranchChange(requestRender);
      return {
        dispose() { unsubscribe(); },
        invalidate() {},
        render(width) {
          const usage = ctx.getContextUsage();
          const title = cleanTitle(pi.getSessionName?.());
          const sessionId = String(ctx.sessionManager.getSessionId?.() || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 8);
          const session = title || (sessionId ? `#${sessionId}` : '');
          const branch = footerData.getGitBranch();
          const project = path.basename(ctx.cwd);
          const model = ctx.model?.id || 'model';
          const effort = ctx.thinkingLevel ? `/${ctx.thinkingLevel}` : '';
          const modelLabel = `${model}${effort}`;
          const parts = [`[${state}]${session ? ` ${session}` : ''}`, `cwd ${project}`, modelLabel];
          if (usage?.tokens !== null && usage?.tokens !== undefined) {
            const window = usage.contextWindow ? `/${formatTokens(usage.contextWindow)}` : '';
            parts.push(`ctx ${formatTokens(usage.tokens)}${window}`);
          } else if (usage?.percent !== null && usage?.percent !== undefined) {
            parts.push(`ctx ${Math.round(usage.percent)}%`);
          }
          const used = sessionTokens(ctx.sessionManager.getEntries?.() || []);
          if (used > 0) parts.push(`used ${formatTokens(used)}`);
          if (branch) parts.push(branch);
          const line = truncate(parts.join(' | '), Math.max(24, width));
          return [colorizeFooter(line, theme, {
            state, model: modelLabel, branch,
            contextPercent: usage?.percent ?? (usage?.tokens !== null && usage?.tokens !== undefined && usage?.contextWindow
              ? (usage.tokens / usage.contextWindow) * 100 : undefined),
          })];
        },
      };
    });
  });

  pi.on('agent_start', async (_event, ctx) => {
    state = 'RUN';
    startedAt = Date.now();
    currentContext = ctx;
    requestRender();
  });

  pi.on('agent_settled', async (_event, ctx) => {
    state = ctx.hasPendingMessages() ? 'RUN' : 'READY';
    currentContext = ctx;
    requestRender();
    if (state === 'READY' && startedAt && Date.now() - startedAt >= 30000) {
      notify('Notify', {
        session: ctx.sessionManager.getSessionId(), cli: 'Pi', project: path.basename(ctx.cwd),
        category: 'complete', title: 'Pi complete', body: `${path.basename(ctx.cwd)} is ready for input.`, immediate: false,
        startedAt,
      });
    }
  });

  pi.on('session_shutdown', async () => {
    currentContext?.ui.setFooter(undefined);
  });
}
