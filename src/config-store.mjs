import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const MISSING = { __aiCliEnhancerMissing: true };

export function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function equal(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!equal(a[i], b[i])) return false;
    }
    return true;
  }
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length) return false;
  for (let i = 0; i < keysA.length; i += 1) {
    if (keysA[i] !== keysB[i] || !equal(a[keysA[i]], b[keysB[i]])) return false;
  }
  return true;
}

export function readJson(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return clone(fallback);
    throw new Error(`Cannot parse JSON config ${file}: ${error.message}`);
  }
}

export function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, file);
}

export function readState(file, target) {
  const state = readJson(file, { schema: 1, target, adapters: {} });
  state.schema = 1;
  state.target = target;
  state.adapters ||= {};
  return state;
}

export function getAt(object, keyPath) {
  let cursor = object;
  for (const key of keyPath) {
    if (!cursor || typeof cursor !== 'object' || !(key in cursor)) return MISSING;
    cursor = cursor[key];
  }
  return cursor;
}

export function setAt(object, keyPath, value) {
  let cursor = object;
  for (let i = 0; i < keyPath.length - 1; i += 1) {
    const key = keyPath[i];
    if (!cursor[key] || typeof cursor[key] !== 'object' || Array.isArray(cursor[key])) cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[keyPath.at(-1)] = clone(value);
}

export function deleteAt(object, keyPath) {
  const parents = [];
  let cursor = object;
  for (let i = 0; i < keyPath.length - 1; i += 1) {
    const key = keyPath[i];
    if (!cursor || typeof cursor !== 'object' || !(key in cursor)) return;
    parents.push([cursor, key]);
    cursor = cursor[key];
  }
  if (cursor && typeof cursor === 'object') delete cursor[keyPath.at(-1)];
  for (let i = parents.length - 1; i >= 0; i -= 1) {
    const [parent, key] = parents[i];
    if (parent[key] && typeof parent[key] === 'object' && !Array.isArray(parent[key]) && Object.keys(parent[key]).length === 0) {
      delete parent[key];
    } else break;
  }
}

export function applyJsonPatches(file, patches, record = {}, report = () => {}) {
  if (record.fileExisted === undefined) record.fileExisted = fs.existsSync(file);
  const config = readJson(file, {});
  record.kind = 'json';
  record.file = file;
  record.values ||= {};
  let changed = false;

  for (const patch of patches) {
    const id = patch.path.join('.');
    const current = getAt(config, patch.path);
    const saved = record.values[id];
    const matchesRestored = saved && (saved.previousExists ? equal(current, saved.previous) : current === MISSING);
    if (saved && !equal(current, saved.installed) && !matchesRestored) {
      report('conflict', `${file}: ${id} was changed after installation; keeping the user's value.`);
      continue;
    }
    if (!saved) {
      record.values[id] = {
        path: patch.path,
        previousExists: current !== MISSING,
        previous: current === MISSING ? null : clone(current),
        installed: clone(patch.value),
      };
    } else {
      saved.installed = clone(patch.value);
    }
    if (!equal(current, patch.value)) {
      setAt(config, patch.path, patch.value);
      changed = true;
    }
  }
  if (changed || !fs.existsSync(file)) writeJsonAtomic(file, config);
  return record;
}

export function restoreJsonPatches(record, report = () => {}) {
  if (!record?.file || !fs.existsSync(record.file)) return { conflicts: 0 };
  const config = readJson(record.file, {});
  let changed = false;
  let conflicts = 0;
  for (const saved of Object.values(record.values || {})) {
    const current = getAt(config, saved.path);
    if (!equal(current, saved.installed)) {
      conflicts += 1;
      report('conflict', `${record.file}: ${saved.path.join('.')} changed after installation; not restored.`);
      continue;
    }
    if (saved.previousExists) setAt(config, saved.path, saved.previous);
    else deleteAt(config, saved.path);
    changed = true;
  }
  if (changed) {
    if (!record.fileExisted && Object.keys(config).length === 0) fs.rmSync(record.file);
    else writeJsonAtomic(record.file, config);
  }
  return { conflicts };
}

export function addManagedHooks(file, hookGroups, record = {}, report = () => {}) {
  const config = readJson(file, {});
  config.hooks ||= {};
  record.hookEntries ||= {};
  let changed = false;
  for (const [event, entries] of Object.entries(hookGroups)) {
    if (!Array.isArray(config.hooks[event])) config.hooks[event] = [];
    for (const entry of entries) {
      const marker = entry.__marker;
      const clean = clone(entry);
      delete clean.__marker;
      const index = config.hooks[event].findIndex((item) => JSON.stringify(item).includes(marker));
      if (index >= 0) {
        const previousInstalled = record.hookEntries[marker];
        if (previousInstalled && !equal(config.hooks[event][index], previousInstalled)) {
          report('conflict', `${file}: hook ${marker} was changed after installation; keeping the user's value.`);
          continue;
        }
        if (!equal(config.hooks[event][index], clean)) {
          config.hooks[event][index] = clean;
          changed = true;
        }
      } else {
        config.hooks[event].push(clean);
        changed = true;
      }
      record.hookEntries[marker] = clone(clean);
    }
  }
  if (changed || !fs.existsSync(file)) writeJsonAtomic(file, config);
  record.hookFile = file;
  record.hookMarkers = Object.values(hookGroups).flat().map((entry) => entry.__marker);
  return record;
}

export function removeManagedHooks(record) {
  if (!record?.hookFile || !fs.existsSync(record.hookFile)) return;
  const config = readJson(record.hookFile, {});
  if (!config.hooks || typeof config.hooks !== 'object') return;
  const markers = record.hookMarkers || [];
  let changed = false;
  for (const [event, entries] of Object.entries(config.hooks)) {
    if (!Array.isArray(entries)) continue;
    const filtered = entries.filter((entry) => !markers.some((marker) => JSON.stringify(entry).includes(marker)));
    if (filtered.length !== entries.length) {
      changed = true;
      if (filtered.length) config.hooks[event] = filtered;
      else delete config.hooks[event];
    }
  }
  if (Object.keys(config.hooks).length === 0) delete config.hooks;
  if (changed) writeJsonAtomic(record.hookFile, config);
}

function findTomlSection(lines, section) {
  const header = `[${section}]`;
  const start = lines.findIndex((line) => line.trim() === header);
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\s*\[[^[]/.test(lines[i])) { end = i; break; }
  }
  return { start, end };
}

function findTomlKey(lines, sectionRange, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^\\s*${escaped}\\s*=`);
  let start = -1;
  for (let i = sectionRange.start + 1; i < sectionRange.end; i += 1) {
    if (pattern.test(lines[i])) { start = i; break; }
  }
  if (start < 0) return null;
  let end = start + 1;
  for (; end < sectionRange.end; end += 1) {
    if (/^\s*[A-Za-z0-9_-]+\s*=/.test(lines[end]) || /^\s*\[/.test(lines[end])) break;
    if (/^\s*(#.*)?$/.test(lines[end])) break;
  }
  return { start, end, raw: lines.slice(start, end).join('\n') };
}

export function applyTomlKeys(file, section, values, record = {}, report = () => {}) {
  if (record.fileExisted === undefined) record.fileExisted = fs.existsSync(file);
  let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  let lines = text.replace(/\r\n/g, '\n').split('\n');
  record.kind = 'toml';
  record.file = file;
  record.section = section;
  record.values ||= {};

  if (!findTomlSection(lines, section)) {
    if (lines.length && lines.at(-1) !== '') lines.push('');
    lines.push(`[${section}]`, '# Managed key-by-key by ai-cli-enhancer.');
  }

  for (const [key, rawValue] of Object.entries(values)) {
    let range = findTomlSection(lines, section);
    const found = findTomlKey(lines, range, key);
    const installed = `${key} = ${rawValue}`;
    const saved = record.values[key];
    const matchesRestored = saved && (saved.previousExists
      ? Boolean(found) && found.raw.trim() === saved.previous.trim()
      : !found);
    if (saved && (!found || found.raw.trim() !== saved.installed.trim()) && !matchesRestored) {
      report('conflict', `${file}: [${section}].${key} was changed after installation; keeping the user's value.`);
      continue;
    }
    if (!saved) {
      record.values[key] = { previousExists: Boolean(found), previous: found?.raw || null, installed };
    } else saved.installed = installed;
    if (found) lines.splice(found.start, found.end - found.start, installed);
    else {
      range = findTomlSection(lines, section);
      lines.splice(range.end, 0, installed);
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.join('\n').replace(/\n+$/, '')}\n`, 'utf8');
  return record;
}

export function restoreTomlKeys(record, report = () => {}) {
  if (!record?.file || !fs.existsSync(record.file)) return { conflicts: 0 };
  let lines = fs.readFileSync(record.file, 'utf8').replace(/\r\n/g, '\n').split('\n');
  let conflicts = 0;
  for (const [key, saved] of Object.entries(record.values || {})) {
    const sectionRange = findTomlSection(lines, record.section);
    const found = sectionRange && findTomlKey(lines, sectionRange, key);
    if (!found || found.raw.trim() !== saved.installed.trim()) {
      conflicts += 1;
      report('conflict', `${record.file}: [${record.section}].${key} changed after installation; not restored.`);
      continue;
    }
    if (saved.previousExists) lines.splice(found.start, found.end - found.start, saved.previous);
    else lines.splice(found.start, found.end - found.start);
  }
  const range = findTomlSection(lines, record.section);
  if (range) {
    const body = lines.slice(range.start + 1, range.end).filter((line) => line.trim() && !line.includes('Managed key-by-key by ai-cli-enhancer'));
    if (!body.length) lines.splice(range.start, range.end - range.start);
  }
  const output = lines.join('\n').replace(/\n+$/, '');
  if (!record.fileExisted && !output.trim()) fs.rmSync(record.file);
  else fs.writeFileSync(record.file, `${output}\n`, 'utf8');
  return { conflicts };
}

export function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function copyTree(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  fs.cpSync(source, destination, { recursive: true, force: true });
}

export function removeManagedFiles(files = [], report = () => {}) {
  for (const item of files) {
    if (!fs.existsSync(item.path)) continue;
    if (sha256(item.path) !== item.hash) {
      report('conflict', `${item.path} was modified after installation; not removed.`);
      continue;
    }
    fs.rmSync(item.path);
  }
}
