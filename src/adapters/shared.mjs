import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  applyJsonPatches, restoreJsonPatches, addManagedHooks, removeManagedHooks,
  applyTomlKeys, restoreTomlKeys,
} from '../config-store.mjs';

export function userHome() {
  return process.env.AI_CLI_ENHANCER_HOME || os.homedir();
}

export function homeFile(...parts) {
  return path.join(userHome(), ...parts);
}

export function runtimeFile(ctx, name) {
  return path.join(ctx.installRoot, 'runtime', name);
}

export function command(...parts) {
  return parts.map((part) => {
    const value = String(part);
    return /[\s&()^]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
  }).join(' ');
}

function windowsFileToWslUrl(file) {
  const match = String(file).match(/^([A-Za-z]):[\\/](.*)$/);
  if (!match) return '';
  const linuxPath = `/mnt/${match[1].toLowerCase()}/${match[2].replaceAll('\\', '/')}`;
  return `file://${encodeURI(linuxPath).replaceAll('#', '%23')}`;
}

function runtimeCommand(ctx, moduleName, args) {
  const file = runtimeFile(ctx, moduleName);
  if (ctx.target !== 'windows') return command('node', file, ...args);
  const windowsUrl = pathToFileURL(file).href;
  const wslUrl = windowsFileToWslUrl(file);
  if (!wslUrl) return command('node', file, ...args);
  const loader = `import(process.platform==='win32'?'${windowsUrl}':'${wslUrl}').then(function(m){m.main()})`;
  return command('node', '-e', loader, '--', ...args);
}

export function statusLinePatch(ctx, cli) {
  return {
    path: ['statusLine'],
    value: {
      type: 'command',
      command: runtimeCommand(ctx, 'renderer.mjs', ['--cli', cli]),
      padding: 0,
    },
  };
}

export function commandHook(ctx, cli, event, protocol = '') {
  const marker = `ai-cli-enhancer:${cli}:${event}`;
  const args = ['--cli', cli, '--event', event, '--marker', marker];
  if (protocol) args.push('--protocol', protocol);
  return { marker, command: runtimeCommand(ctx, 'hook.mjs', args) };
}

export function claudeStyleHooks(ctx, cli) {
  const start = commandHook(ctx, cli, 'UserPromptSubmit');
  const stop = commandHook(ctx, cli, 'Stop');
  const notification = commandHook(ctx, cli, 'Notification');
  return {
    UserPromptSubmit: [{
      __marker: start.marker,
      hooks: [{ type: 'command', command: start.command, timeout: 3 }],
    }],
    Stop: [{
      __marker: stop.marker,
      hooks: [{ type: 'command', command: stop.command, timeout: 3 }],
    }],
    Notification: [{
      __marker: notification.marker,
      matcher: 'permission_prompt|agent_needs_input|elicitation_dialog|idle_prompt',
      hooks: [{ type: 'command', command: notification.command, timeout: 3 }],
    }],
  };
}

export function installJson(ctx, adapterState, id, file, patches) {
  adapterState.configs ||= {};
  adapterState.configs[id] = applyJsonPatches(file, patches, adapterState.configs[id], ctx.report);
}

export function installHooks(ctx, adapterState, id, file, groups) {
  adapterState.configs ||= {};
  adapterState.configs[id] ||= {};
  adapterState.configs[id] = addManagedHooks(file, groups, adapterState.configs[id], ctx.report);
}

export function restoreAll(adapterState, report) {
  for (const record of Object.values(adapterState.configs || {}).reverse()) {
    removeManagedHooks(record);
    if (record.kind === 'json') restoreJsonPatches(record, report);
    if (record.kind === 'toml') restoreTomlKeys(record, report);
  }
}

export function isWindowsOwnedSharedConfig(ctx, adapterState, file) {
  if (ctx.target !== 'wsl' || !fs.existsSync(file)) return false;
  let real;
  try { real = fs.realpathSync(file).replaceAll('\\', '/'); } catch { return false; }
  const match = real.match(/^\/mnt\/([a-z])\/Users\/([^/]+)\//i);
  if (!match) return false;
  const windowsState = `/mnt/${match[1].toLowerCase()}/Users/${match[2]}/AppData/Local/AI-CLI-Enhancer/state.json`;
  let managedByWindows = fs.existsSync(windowsState);
  if (!managedByWindows) {
    try { managedByWindows = /ai-cli-enhancer/i.test(fs.readFileSync(file, 'utf8')); } catch { /* ignore */ }
  }
  if (!managedByWindows) return false;

  // Older dual-target installs may have WSL path values layered over Windows values.
  // Restore only scalar/TOML records. Hook marker records may refer to the Windows-owned
  // entry and must not remove it.
  for (const record of Object.values(adapterState.configs || {}).reverse()) {
    if (record.kind === 'json') restoreJsonPatches(record, ctx.report);
    if (record.kind === 'toml') restoreTomlKeys(record, ctx.report);
  }
  adapterState.configs = {};
  adapterState.sharedWithWindows = true;
  ctx.report('info', `${file} is shared with Windows; Windows owns its enhancer configuration.`);
  return true;
}

export function installToml(ctx, adapterState, id, file, section, values) {
  adapterState.configs ||= {};
  adapterState.configs[id] = applyTomlKeys(file, section, values, adapterState.configs[id], ctx.report);
}
