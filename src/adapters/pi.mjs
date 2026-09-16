import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { homeFile } from './shared.mjs';

function runPi(action, source, ctx, cwd) {
  if (process.env.AI_CLI_ENHANCER_SKIP_PI_COMMAND === '1') return;
  const isWindows = process.platform === 'win32';
  const executable = isWindows ? 'powershell.exe' : 'pi';
  const args = isWindows
    ? ['-NoProfile', '-NonInteractive', '-Command', '& pi.cmd $env:AI_CLI_ENHANCER_PI_ACTION $env:AI_CLI_ENHANCER_PI_SOURCE']
    : [action, source];
  const env = isWindows ? {
    ...process.env,
    AI_CLI_ENHANCER_PI_ACTION: action,
    AI_CLI_ENHANCER_PI_SOURCE: source,
  } : process.env;
  const result = spawnSync(executable, args, {
    encoding: 'utf8', windowsHide: true, env, cwd, timeout: 30000,
  });
  if (result.error || result.status !== 0) {
    const detail = `${result.stdout || ''}\n${result.stderr || result.error?.message || ''}`.trim();
    if (action === 'remove' && /not installed|not found|no package|no matching package/i.test(detail)) return;
    throw new Error(`pi ${action} failed: ${detail}`);
  }
  if (result.stdout?.trim()) ctx.report('info', result.stdout.trim());
}

export const pi = {
  id: 'pi',
  description: 'Pi package with a compact native footer',
  needsRuntime: false,
  install(ctx, state) {
    const agentDir = homeFile('.pi', 'agent');
    const packageRoot = path.join(agentDir, 'ai-cli-enhancer');
    const portableSource = './ai-cli-enhancer';
    if (state.packageSource && state.packageSource !== portableSource) {
      runPi('remove', state.packageSource, ctx, agentDir);
    }
    ctx.syncTree(path.join(ctx.projectRoot, 'src', 'pi-package'), packageRoot);
    ctx.syncTree(path.join(ctx.projectRoot, 'src', 'runtime'), path.join(packageRoot, 'runtime'));
    runPi('install', portableSource, ctx, agentDir);
    if (state.packageSource && state.packageSource !== portableSource) {
      ctx.removeManagedRoots([path.join(ctx.installRoot, 'pi-package')]);
    }
    state.packageSource = portableSource;
    state.packageRoot = packageRoot;
  },
  disable(ctx, state) {
    if (state.packageSource) runPi('remove', state.packageSource, ctx, path.dirname(state.packageRoot || homeFile('.pi', 'agent', 'x')));
  },
  uninstall(ctx, state) {
    if (!state.packageRoot) return;
    ctx.removeGeneratedState([state.packageRoot]);
    ctx.removeManagedRoots([state.packageRoot]);
  },
};
