import { homeFile, installToml, restoreAll, isWindowsOwnedSharedConfig } from './shared.mjs';

export const codex = {
  id: 'codex',
  description: 'Codex native TUI status and unfocused notifications',
  needsRuntime: false,
  install(ctx, state) {
    const file = homeFile('.codex', 'config.toml');
    if (isWindowsOwnedSharedConfig(ctx, state, file)) return;
    installToml(ctx, state, 'tui', file, 'tui', {
      status_line: '["run-state", "git-branch", "model-with-reasoning", "context-used", "task-progress", "permissions"]',
      terminal_title: '["run-state", "project-name"]',
      notifications: 'true',
      notification_method: '"auto"',
      notification_condition: '"unfocused"',
    });
  },
  disable(ctx, state) { restoreAll(state, ctx.report); },
};
