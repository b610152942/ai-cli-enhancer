import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from '../src/installer.mjs';

test('install, repeat, disable, enable and uninstall remain reversible', { concurrency: false }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enhancer-e2e-'));
  const home = path.join(root, 'home');
  const installRoot = path.join(root, 'install');
  fs.mkdirSync(path.join(home, '.codebuddy'), { recursive: true });
  fs.mkdirSync(path.join(home, '.gemini', 'antigravity-cli'), { recursive: true });
  fs.mkdirSync(path.join(home, '.gemini', 'config'), { recursive: true });
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.mkdirSync(path.join(home, '.gemini'), { recursive: true });
  fs.writeFileSync(path.join(home, '.codebuddy', 'settings.json'), '{"model":"keep"}\n');
  fs.writeFileSync(path.join(home, '.codex', 'config.toml'), 'model = "keep"\n');
  fs.writeFileSync(path.join(home, '.gemini', 'settings.json'), '{"general":{"defaultApprovalMode":"keep"}}\n');

  const previous = {
    home: process.env.AI_CLI_ENHANCER_HOME,
    root: process.env.AI_CLI_ENHANCER_INSTALL_ROOT,
    skipPi: process.env.AI_CLI_ENHANCER_SKIP_PI_COMMAND,
  };
  process.env.AI_CLI_ENHANCER_HOME = home;
  process.env.AI_CLI_ENHANCER_INSTALL_ROOT = installRoot;
  process.env.AI_CLI_ENHANCER_SKIP_PI_COMMAND = '1';
  try {
    const argv = ['node', 'installer', 'install', '--target', 'wsl', '--cli', 'core,pi'];
    await run(argv);
    await run(argv);

    const agy = JSON.parse(fs.readFileSync(path.join(home, '.gemini', 'antigravity-cli', 'settings.json'), 'utf8'));
    assert.match(agy.statusLine.command, /^node .*renderer\.mjs --cli Agy$/);
    assert.doesNotMatch(agy.statusLine.command, /node -e/);
    const agyHooks = JSON.parse(fs.readFileSync(path.join(home, '.gemini', 'config', 'hooks.json'), 'utf8'));
    assert.match(agyHooks['ai-cli-enhancer'].SessionStart[0].command, /^node .*hook\.mjs/);
    assert.doesNotMatch(agyHooks['ai-cli-enhancer'].SessionStart[0].command, /node -e/);

    const codebuddyFile = path.join(home, '.codebuddy', 'settings.json');
    let codebuddy = JSON.parse(fs.readFileSync(codebuddyFile, 'utf8'));
    assert.equal(codebuddy.model, 'keep');
    assert.match(codebuddy.statusLine.command, /renderer\.mjs/);
    assert.equal(codebuddy.hooks.Stop.length, 1);

    const codexInstalled = fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8');
    assert.match(codexInstalled, /thread-title/);
    assert.match(codexInstalled, /current-dir/);
    assert.match(codexInstalled, /used-tokens/);
    const geminiInstalled = JSON.parse(fs.readFileSync(path.join(home, '.gemini', 'settings.json'), 'utf8'));
    assert.ok(geminiInstalled.ui.footer.items.includes('session-id'));

    const piPackage = path.join(home, '.pi', 'agent', 'ai-cli-enhancer', 'package.json');
    assert.equal(fs.existsSync(piPackage), true);
    await run(['node', 'installer', 'disable', '--target', 'wsl', '--cli', 'pi']);
    assert.equal(fs.existsSync(piPackage), true);
    await run(['node', 'installer', 'enable', '--target', 'wsl', '--cli', 'pi']);

    await run(['node', 'installer', 'disable', '--target', 'wsl', '--cli', 'codebuddy']);
    codebuddy = JSON.parse(fs.readFileSync(codebuddyFile, 'utf8'));
    assert.equal(codebuddy.statusLine, undefined);
    assert.equal(codebuddy.hooks, undefined);

    await run(['node', 'installer', 'enable', '--target', 'wsl', '--cli', 'codebuddy']);
    codebuddy = JSON.parse(fs.readFileSync(codebuddyFile, 'utf8'));
    assert.match(codebuddy.statusLine.command, /renderer\.mjs/);

    codebuddy.statusLine.command = 'user-custom-command';
    fs.writeFileSync(codebuddyFile, `${JSON.stringify(codebuddy, null, 2)}\n`);
    const result = await run(['node', 'installer', 'uninstall', '--target', 'wsl', '--cli', 'codebuddy']);
    codebuddy = JSON.parse(fs.readFileSync(codebuddyFile, 'utf8'));
    assert.equal(codebuddy.statusLine.command, 'user-custom-command');
    assert.ok(result.messages.some((message) => message.level === 'conflict'));

    await run(['node', 'installer', 'uninstall', '--target', 'wsl', '--all', '--purge']);
    assert.equal(fs.existsSync(piPackage), false);
    const gemini = JSON.parse(fs.readFileSync(path.join(home, '.gemini', 'settings.json'), 'utf8'));
    assert.equal(gemini.general.defaultApprovalMode, 'keep');
    assert.equal(gemini.general.enableNotifications, undefined);
    const codex = fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8');
    assert.match(codex, /model = "keep"/);
    assert.doesNotMatch(codex, /\[tui\]/);
    assert.equal(fs.existsSync(installRoot), false);
  } finally {
    if (previous.home === undefined) delete process.env.AI_CLI_ENHANCER_HOME; else process.env.AI_CLI_ENHANCER_HOME = previous.home;
    if (previous.root === undefined) delete process.env.AI_CLI_ENHANCER_INSTALL_ROOT; else process.env.AI_CLI_ENHANCER_INSTALL_ROOT = previous.root;
    if (previous.skipPi === undefined) delete process.env.AI_CLI_ENHANCER_SKIP_PI_COMMAND; else process.env.AI_CLI_ENHANCER_SKIP_PI_COMMAND = previous.skipPi;
  }
});
