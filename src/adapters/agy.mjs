import { homeFile, statusLinePatch, commandHook, installJson, restoreAll, isWindowsOwnedSharedConfig } from './shared.mjs';

export const agy = {
  id: 'agy',
  description: 'Agy status line and fail-open lifecycle notifications',
  needsRuntime: true,
  install(ctx, state) {
    const settingsFile = homeFile('.gemini', 'antigravity-cli', 'settings.json');
    if (isWindowsOwnedSharedConfig(ctx, state, settingsFile)) return;
    // Agy's Windows command runner does not reliably preserve the nested quotes
    // used by the cross-platform `node -e` loader.
    const direct = { direct: true };
    const statusLine = statusLinePatch(ctx, 'Agy', direct);
    statusLine.value.enabled = true;
    delete statusLine.value.padding;
    installJson(ctx, state, 'settings', settingsFile, [statusLine]);
    const start = commandHook(ctx, 'Agy', 'SessionStart', 'agy', direct);
    const stop = commandHook(ctx, 'Agy', 'Stop', 'agy', direct);
    const attention = commandHook(ctx, 'Agy', 'PreToolUse', 'agy', direct);
    installJson(ctx, state, 'hooks', homeFile('.gemini', 'config', 'hooks.json'), [{
      path: ['ai-cli-enhancer'],
      value: {
        enabled: true,
        SessionStart: [{ type: 'command', command: start.command, timeout: 3 }],
        Stop: [{ type: 'command', command: stop.command, timeout: 3 }],
        PreToolUse: [{
          matcher: 'ask_question',
          hooks: [{ type: 'command', command: attention.command, timeout: 3 }],
        }],
      },
    }]);
  },
  disable(ctx, state) { restoreAll(state, ctx.report); },
};
