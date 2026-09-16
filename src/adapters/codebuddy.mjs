import { homeFile, statusLinePatch, claudeStyleHooks, installJson, installHooks, restoreAll, isWindowsOwnedSharedConfig } from './shared.mjs';

export const codebuddy = {
  id: 'codebuddy',
  description: 'CodeBuddy status line and non-blocking notifications',
  needsRuntime: true,
  install(ctx, state) {
    const file = homeFile('.codebuddy', 'settings.json');
    if (isWindowsOwnedSharedConfig(ctx, state, file)) return;
    installJson(ctx, state, 'settings', file, [statusLinePatch(ctx, 'CodeBuddy')]);
    installHooks(ctx, state, 'hooks', file, claudeStyleHooks(ctx, 'CodeBuddy'));
  },
  disable(ctx, state) { restoreAll(state, ctx.report); },
};
