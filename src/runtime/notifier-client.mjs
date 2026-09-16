import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const localScript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'notify.ps1');

function windowsPath(file) {
  if (process.platform === 'win32') return file;
  const mounted = file.match(/^\/mnt\/([a-z])\/(.*)$/i);
  if (mounted) return `${mounted[1].toUpperCase()}:\\${mounted[2].replaceAll('/', '\\')}`;
  return '';
}

export function dispatchNotification(mode, payload) {
  try {
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
    const directScript = windowsPath(localScript);
    const scriptArgs = directScript
      ? ['-File', directScript, '-Mode', mode, '-PayloadBase64', encoded]
      : ['-Command', "& (Join-Path $env:LOCALAPPDATA 'AI-CLI-Enhancer\\runtime\\notify.ps1') -Mode $env:AI_CLI_ENHANCER_NOTIFY_MODE -PayloadBase64 $env:AI_CLI_ENHANCER_NOTIFY_PAYLOAD"];
    spawnSync('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...scriptArgs,
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
  } catch {
    // Notifications are best-effort and must never affect the CLI.
  }
}
