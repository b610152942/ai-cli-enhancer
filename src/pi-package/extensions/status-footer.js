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
      : ['-Command', `& (Join-Path $env:LOCALAPPDATA 'AI-CLI-Enhancer\\runtime\\notify.ps1') -Mode ${mode} -PayloadBase64 ${encoded}`];
    spawnSync('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      ...scriptArgs,
    ], {
      windowsHide: true,
      stdio: 'ignore',
      timeout: 2500,
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

function cleanTaskTitle(value, limit = 24) {
  if (!value) return '';
  let text = String(value)
    .replace(/<(local-command-caveat|system-reminder|thinking)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/?[a-zA-Z0-9_:-]+[^>]*>/g, ' ')
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

function cleanProjectName(value, limit = 18) {
  if (!value) return '';
  const text = String(value).trim();
  if (text.length > limit) {
    return `${text.slice(0, limit - 1)}…`;
  }
  return text;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 1000) return '';
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds} 秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分钟`;
}

function buildNotificationContent({
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

function piContextColor(percent) {
  if (percent === null || percent === undefined || percent < 70) return 'success';
  if (percent >= 90) return 'error';
  return 'warning';
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

export function colorizeFooter(line, theme, details = {}) {
  if (!theme || Object.hasOwn(process.env, 'NO_COLOR')) return line;
  const separator = theme.fg('dim', ' | ');
  return line.split(' | ').map((part, index) => {
    if (index === 0) {
      const color = details.state === 'RUN' ? 'accent' : details.state === 'ERROR' ? 'error' : 'success';
      return part.replace(/^\[[^\]]+\]/, (value) => theme.fg(color, theme.bold(value)));
    }
    if (part === details.directory || part.startsWith('cwd ')) return theme.fg('dim', part);
    if (part.startsWith('ctx ')) return theme.fg(piContextColor(details.contextPercent), part);
    if (part.startsWith('used ')) return theme.fg('muted', part);
    if (part.startsWith('agents ')) return theme.fg('accent', part);
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
          const directory = formatDirectory(ctx.cwd);
          const model = ctx.model?.id || 'model';
          const effort = ctx.thinkingLevel ? `/${ctx.thinkingLevel}` : '';
          const modelLabel = `${model}${effort}`;
          const parts = [`[${state}]${session ? ` ${session}` : ''}`, directory, modelLabel];
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
            state, model: modelLabel, branch, directory,
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
    if (state === 'READY') {
      const turnDuration = startedAt ? Date.now() - startedAt : 0;
      startedAt = undefined;
      if (turnDuration >= 3000 && turnDuration < 4 * 60 * 60 * 1000) {
        const rawTitle = pi.getSessionName?.() || '';
        const project = path.basename(ctx.cwd);
        const sessionId = String(ctx.sessionManager.getSessionId?.() || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 8);
        const notif = buildNotificationContent({
          cli: 'Pi',
          project,
          title: rawTitle,
          fullTitle: rawTitle,
          sessionId,
          category: 'complete',
          elapsed: turnDuration,
        });
        notify('Notify', {
          session: ctx.sessionManager.getSessionId(), cli: 'Pi', project,
          category: 'complete', title: notif.title, body: notif.body, immediate: false,
          startedAt: Date.now() - turnDuration,
        });
      }
    }
  });

  pi.on('session_shutdown', async () => {
    currentContext?.ui.setFooter(undefined);
  });
}
