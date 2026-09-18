import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { homeFile, statusLinePatch, claudeStyleHooks, installJson, installHooks, restoreAll, isWindowsOwnedSharedConfig } from './shared.mjs';

export const PATCH_PAIRS = [
  {
    target: 'setRuntimeModel(ei,ea){ei&&(ei.options=ei.options??{},ei.options.model=ea,ei.requestOptions??(ei.requestOptions={}),ei.requestOptions.model=ea,this.setOverrideModel(ei.id,ea))}',
    replacement: 'setRuntimeModel(ei,ea){ei&&(ei.options=ei.options??{},ei.options.model=ea,ei.requestOptions??(ei.requestOptions={}),ei.requestOptions.model=ea,this.setOverrideModel(ei.id,ea),this.sessionSubject?.next(ei))}',
  },
  {
    target: 'setRuntimeOutputStyle(ei,ea){ei&&(ei.options=ei.options??{},ei.options.outputStyle=ea)}',
    replacement: 'setRuntimeOutputStyle(ei,ea){ei&&(ei.options=ei.options??{},ei.options.outputStyle=ea,this.sessionSubject?.next(ei))}',
  },
  {
    target: '"global"===es?(ek.current=await (0,ec.m)((0,e_.fq)(),ea,"Switch model to"),await (0,e_.fq)().set("model",ea)):ek.current=`Switch model to ${ea} (this session only)`,await (0,e_.HZ)().set("model",ea),(0,e_.id)().setRuntimeModel(ei,ea),ex()',
    replacement: '"global"===es?(ek.current=await (0,ec.m)((0,e_.fq)(),ea,"Switch model to"),await (0,e_.fq)().set("model",ea),(0,e_.id)().setRuntimeModel(ei,ea),ex()):(ek.current=`Switch model to ${ea} (this session only)`,await (0,e_.HZ)().set("model",ea),(0,e_.id)().setRuntimeModel(ei,ea),ex())',
  },
];

export function patchCodeBuddyContent(content) {
  let modified = content;
  let changed = false;
  for (const { target, replacement } of PATCH_PAIRS) {
    if (modified.includes(target)) {
      modified = modified.replace(target, replacement);
      changed = true;
    }
  }
  return { content: modified, changed };
}

export function unpatchCodeBuddyContent(content) {
  let modified = content;
  let changed = false;
  for (const { target, replacement } of PATCH_PAIRS) {
    if (modified.includes(replacement)) {
      modified = modified.replace(replacement, target);
      changed = true;
    }
  }
  return { content: modified, changed };
}

export function findCodeBuddyDistFiles() {
  const targets = new Set();
  const home = os.homedir();

  const voltaRoots = [
    path.join(home, '.volta', 'tools', 'image', 'packages', '@tencent-ai', 'codebuddy-code'),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Volta', 'tools', 'image', 'packages', '@tencent-ai', 'codebuddy-code') : null,
  ].filter(Boolean);

  for (const root of voltaRoots) {
    if (!fs.existsSync(root)) continue;
    const candidates = [
      path.join(root, 'dist', 'codebuddy.js'),
      path.join(root, 'node_modules', '@tencent-ai', 'codebuddy-code', 'dist', 'codebuddy.js'),
      path.join(root, 'lib', 'node_modules', '@tencent-ai', 'codebuddy-code', 'dist', 'codebuddy.js'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) targets.add(path.resolve(c));
    }
  }

  const voltaNodeDir = path.join(home, '.volta', 'tools', 'image', 'node');
  if (fs.existsSync(voltaNodeDir)) {
    try {
      for (const entry of fs.readdirSync(voltaNodeDir)) {
        const c = path.join(voltaNodeDir, entry, 'lib', 'node_modules', '@tencent-ai', 'codebuddy-code', 'dist', 'codebuddy.js');
        if (fs.existsSync(c)) targets.add(path.resolve(c));
      }
    } catch {}
  }

  try {
    const npmRoot = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2500 }).trim();
    if (npmRoot && fs.existsSync(npmRoot)) {
      const c = path.join(npmRoot, '@tencent-ai', 'codebuddy-code', 'dist', 'codebuddy.js');
      if (fs.existsSync(c)) targets.add(path.resolve(c));
    }
  } catch {}

  return Array.from(targets);
}

export function patchCodeBuddyFiles(ctx, state) {
  state.patchedFiles ||= [];
  const files = findCodeBuddyDistFiles();
  for (const file of files) {
    try {
      const original = fs.readFileSync(file, 'utf8');
      const { content, changed } = patchCodeBuddyContent(original);
      if (changed) {
        const backup = `${file}.orig`;
        if (!fs.existsSync(backup)) {
          fs.writeFileSync(backup, original, 'utf8');
        }
        fs.writeFileSync(file, content, 'utf8');
        if (!state.patchedFiles.includes(file)) state.patchedFiles.push(file);
        ctx.report('info', `Patched CodeBuddy session model notification in ${file}`);
      } else if (original.includes(PATCH_PAIRS[0].replacement)) {
        if (!state.patchedFiles.includes(file)) state.patchedFiles.push(file);
      }
    } catch (error) {
      ctx.report('warn', `Failed to patch CodeBuddy runtime at ${file}: ${error.message}`);
    }
  }
}

export function unpatchCodeBuddyFiles(ctx, state) {
  const files = state.patchedFiles || [];
  for (const file of files) {
    try {
      const backup = `${file}.orig`;
      if (fs.existsSync(backup)) {
        const backupContent = fs.readFileSync(backup, 'utf8');
        fs.writeFileSync(file, backupContent, 'utf8');
        ctx.report('info', `Restored CodeBuddy runtime from backup at ${file}`);
      } else if (fs.existsSync(file)) {
        const current = fs.readFileSync(file, 'utf8');
        const { content, changed } = unpatchCodeBuddyContent(current);
        if (changed) {
          fs.writeFileSync(file, content, 'utf8');
          ctx.report('info', `Reverted CodeBuddy session model patch in ${file}`);
        }
      }
    } catch (error) {
      ctx.report('warn', `Failed to restore CodeBuddy runtime at ${file}: ${error.message}`);
    }
  }
  state.patchedFiles = [];
}

export const codebuddy = {
  id: 'codebuddy',
  description: 'CodeBuddy status line and non-blocking notifications',
  needsRuntime: true,
  install(ctx, state) {
    patchCodeBuddyFiles(ctx, state);
    const file = homeFile('.codebuddy', 'settings.json');
    if (isWindowsOwnedSharedConfig(ctx, state, file)) return;
    installJson(ctx, state, 'settings', file, [statusLinePatch(ctx, 'CodeBuddy')]);
    installHooks(ctx, state, 'hooks', file, claudeStyleHooks(ctx, 'CodeBuddy'));
  },
  disable(ctx, state) {
    unpatchCodeBuddyFiles(ctx, state);
    restoreAll(state, ctx.report);
  },
  uninstall(ctx, state) {
    unpatchCodeBuddyFiles(ctx, state);
    restoreAll(state, ctx.report);
  },
};
