import { homeFile, installJson, restoreAll, isWindowsOwnedSharedConfig } from './shared.mjs';

export const gemini = {
  id: 'gemini',
  description: 'Gemini native compact footer and terminal notifications',
  needsRuntime: false,
  install(ctx, state) {
    const file = homeFile('.gemini', 'settings.json');
    if (isWindowsOwnedSharedConfig(ctx, state, file)) return;
    installJson(ctx, state, 'settings', file, [
      { path: ['ui', 'footer', 'items'], value: ['git-branch', 'sandbox', 'model-name', 'context-used'] },
      { path: ['ui', 'footer', 'showLabels'], value: false },
      { path: ['general', 'enableNotifications'], value: true },
      { path: ['general', 'notificationMethod'], value: 'auto' },
    ]);
  },
  disable(ctx, state) { restoreAll(state, ctx.report); },
};
