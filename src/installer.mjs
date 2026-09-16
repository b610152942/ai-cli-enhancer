#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adapters, coreAdapters } from './adapters/index.mjs';
import { readState, writeJsonAtomic, sha256 } from './config-store.mjs';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function parseArgs(argv) {
  const result = { action: argv[2] || 'status', target: process.platform === 'win32' ? 'windows' : 'wsl', cli: [], all: false, purge: false };
  for (let i = 3; i < argv.length; i += 1) {
    if (argv[i] === '--target') result.target = argv[++i];
    else if (argv[i] === '--cli') result.cli.push(...String(argv[++i] || '').split(','));
    else if (argv[i] === '--all') result.all = true;
    else if (argv[i] === '--purge') result.purge = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  result.cli = result.cli.map((item) => item.trim().toLowerCase()).filter(Boolean);
  return result;
}

export function expandCli(values, fallback = []) {
  const expanded = values.length ? values : fallback;
  const result = [];
  for (const value of expanded) {
    if (value === 'core') result.push(...coreAdapters);
    else result.push(value);
  }
  return [...new Set(result)];
}

function defaultInstallRoot(target) {
  if (process.env.AI_CLI_ENHANCER_INSTALL_ROOT) return path.resolve(process.env.AI_CLI_ENHANCER_INSTALL_ROOT);
  if (target === 'windows') {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(local, 'AI-CLI-Enhancer');
  }
  return path.join(os.homedir(), '.local', 'share', 'ai-cli-enhancer');
}

function listFiles(root, relative = '') {
  const directory = path.join(root, relative);
  if (!fs.existsSync(directory)) return [];
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'state') continue;
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) result.push(...listFiles(root, child));
    else if (entry.isFile()) result.push(child);
  }
  return result;
}

function syncManagedTree(source, destination, state, report) {
  state.managedFiles ||= {};
  for (const relative of listFiles(source)) {
    const from = path.join(source, relative);
    const to = path.join(destination, relative);
    const previousHash = state.managedFiles[to];
    if (fs.existsSync(to) && previousHash && sha256(to) !== previousHash) {
      report('conflict', `${to} was modified after installation; upgrade skipped it.`);
      continue;
    }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    state.managedFiles[to] = sha256(to);
  }
}

function removeManagedTrees(state, roots, report) {
  let conflicts = 0;
  const normalizedRoots = roots.map((root) => path.resolve(root));
  for (const [file, expectedHash] of Object.entries(state.managedFiles || {})) {
    if (!normalizedRoots.some((root) => path.resolve(file).startsWith(`${root}${path.sep}`))) continue;
    if (!fs.existsSync(file)) { delete state.managedFiles[file]; continue; }
    if (sha256(file) !== expectedHash) {
      conflicts += 1;
      report('conflict', `${file} was modified after installation; not removed.`);
      continue;
    }
    fs.rmSync(file);
    delete state.managedFiles[file];
  }
  for (const root of normalizedRoots) {
    if (!fs.existsSync(root)) continue;
    const directories = [];
    const collect = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) collect(path.join(directory, entry.name));
      }
      directories.push(directory);
    };
    collect(root);
    for (const directory of [...directories, path.dirname(root)]) {
      try { fs.rmdirSync(directory); } catch { /* keep non-empty directories */ }
    }
  }
  return conflicts;
}

function removeGeneratedState(roots) {
  for (const root of roots) {
    for (const stateDir of [path.join(root, 'state'), path.join(root, 'runtime', 'state')]) {
      if (fs.existsSync(stateDir)) fs.rmSync(stateDir, { recursive: true, force: true });
    }
  }
}

function createReporter(messages) {
  return (level, message) => {
    messages.push({ level, message });
    const prefix = level === 'conflict' ? 'CONFLICT' : level.toUpperCase();
    process.stdout.write(`[${prefix}] ${message}\n`);
  };
}

function validateNames(names) {
  for (const name of names) if (!adapters.has(name)) throw new Error(`Unsupported CLI: ${name}`);
}

function printStatus(target, installRoot, state) {
  process.stdout.write(`Target: ${target}\nInstall root: ${installRoot}\n`);
  for (const [id, adapter] of adapters) {
    const item = state.adapters[id];
    const status = !item ? 'not installed' : item.enabled ? 'enabled' : 'disabled';
    process.stdout.write(`${id.padEnd(10)} ${status.padEnd(13)} ${adapter.description}\n`);
  }
}

export async function run(argv = process.argv) {
  const args = parseArgs(argv);
  const installRoot = defaultInstallRoot(args.target);
  const stateFile = path.join(installRoot, 'state.json');
  const state = readState(stateFile, args.target);
  const messages = [];
  const report = createReporter(messages);
  const ctx = {
    target: args.target,
    installRoot,
    projectRoot,
    report,
    syncTree(source, destination) { syncManagedTree(source, destination, state, report); },
    removeManagedRoots(roots) { return removeManagedTrees(state, roots, report); },
    removeGeneratedState,
  };

  if (args.action === 'status') {
    printStatus(args.target, installRoot, state);
    return { state, messages };
  }

  let names;
  if (args.all) names = [...adapters.keys()];
  else if (args.action === 'install') names = expandCli(args.cli, coreAdapters);
  else if (args.action === 'upgrade' && !args.cli.length) names = Object.keys(state.adapters);
  else names = expandCli(args.cli);
  if (!names.length) throw new Error(`${args.action} requires --cli, or use --all.`);
  validateNames(names);
  fs.mkdirSync(installRoot, { recursive: true });

  if (['install', 'enable', 'upgrade'].includes(args.action)) {
    const selected = names.map((name) => adapters.get(name));
    if (selected.some((adapter) => adapter.needsRuntime)) {
      syncManagedTree(path.join(projectRoot, 'src', 'runtime'), path.join(installRoot, 'runtime'), state, report);
    }
    if (selected.some((adapter) => adapter.needsPiPackage)) {
      syncManagedTree(path.join(projectRoot, 'src', 'pi-package'), path.join(installRoot, 'pi-package'), state, report);
    }
    for (const name of names) {
      const adapter = adapters.get(name);
      const adapterState = state.adapters[name] || { installedAt: new Date().toISOString(), configs: {} };
      adapter.install(ctx, adapterState);
      adapterState.enabled = true;
      adapterState.updatedAt = new Date().toISOString();
      state.adapters[name] = adapterState;
      report('info', `${name} enabled.`);
      writeJsonAtomic(stateFile, state);
    }
  } else if (args.action === 'disable') {
    for (const name of names) {
      const adapterState = state.adapters[name];
      if (!adapterState) { report('info', `${name} is not installed.`); continue; }
      const adapter = adapters.get(name);
      if (adapterState.enabled) adapter.disable(ctx, adapterState);
      adapterState.enabled = false;
      adapterState.updatedAt = new Date().toISOString();
      report('info', `${name} disabled; files and rollback metadata were retained.`);
    }
    writeJsonAtomic(stateFile, state);
  } else if (args.action === 'uninstall') {
    for (const name of names) {
      const adapterState = state.adapters[name];
      if (!adapterState) { report('info', `${name} is not installed.`); continue; }
      const adapter = adapters.get(name);
      if (adapterState.enabled) adapter.disable(ctx, adapterState);
      if (adapter.uninstall) adapter.uninstall(ctx, adapterState);
      delete state.adapters[name];
      report('info', `${name} uninstalled.`);
    }

    const runtimeReferenced = Object.keys(state.adapters).some((name) => adapters.get(name)?.needsRuntime);
    const piReferenced = Boolean(state.adapters.pi);
    const roots = [];
    if (!runtimeReferenced || args.purge) roots.push(path.join(installRoot, 'runtime'));
    if (!piReferenced || args.purge) roots.push(path.join(installRoot, 'pi-package'));
    removeGeneratedState(roots);
    removeManagedTrees(state, roots, report);

    if (args.purge && Object.keys(state.adapters).length === 0 && Object.keys(state.managedFiles || {}).length === 0) {
      if (fs.existsSync(stateFile)) fs.rmSync(stateFile);
      try { fs.rmdirSync(installRoot); } catch { /* keep non-empty root */ }
    } else writeJsonAtomic(stateFile, state);
  } else {
    throw new Error(`Unsupported action: ${args.action}`);
  }
  return { state, messages };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    process.stderr.write(`ERROR: ${error.message}\n`);
    process.exitCode = 1;
  });
}
