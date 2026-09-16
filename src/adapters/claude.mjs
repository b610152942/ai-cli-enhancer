import { homeFile, statusLinePatch, claudeStyleHooks, installJson, installHooks, restoreAll, isWindowsOwnedSharedConfig } from './shared.mjs';

export const claude = {
  id: 'claude',
  description: 'Claude Code status line and non-blocking notifications',
  needsRuntime: true,
  install(ctx, state) {
    const file = homeFile('.claude', 'settings.json');
    if (isWindowsOwnedSharedConfig(ctx, state, file)) return;
    installJson(ctx, state, 'settings', file, [statusLinePatch(ctx, 'Claude')]);
    installHooks(ctx, state, 'hooks', file, claudeStyleHooks(ctx, 'Claude'));
  },
  disable(ctx, state) { restoreAll(state, ctx.report); },
};
