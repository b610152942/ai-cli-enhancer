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

export default function (pi) {
  let state = 'READY';
  let startedAt = 0;
  let requestRender = () => {};
  let currentContext;

  pi.on('session_start', async (_event, ctx) => {
    currentContext = ctx;
    if (ctx.mode !== 'tui') return;
    ctx.ui.setFooter((tui, _theme, footerData) => {
      requestRender = () => tui.requestRender();
      const unsubscribe = footerData.onBranchChange(requestRender);
      return {
        dispose() { unsubscribe(); },
        invalidate() {},
        render(width) {
          const usage = ctx.getContextUsage();
          const branch = footerData.getGitBranch();
          const project = path.basename(ctx.cwd);
          const model = ctx.model?.id || 'model';
          const effort = ctx.thinkingLevel ? `/${ctx.thinkingLevel}` : '';
          const parts = [`[${state}]`, branch || project, `${model}${effort}`];
          if (usage?.percent !== null && usage?.percent !== undefined) parts.push(`ctx ${Math.round(usage.percent)}%`);
          return [truncate(parts.join(' | '), Math.max(24, width))];
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
