import { agy } from './agy.mjs';
import { codebuddy } from './codebuddy.mjs';
import { claude } from './claude.mjs';
import { codex } from './codex.mjs';
import { gemini } from './gemini.mjs';
import { pi } from './pi.mjs';

export const adapters = new Map([agy, codebuddy, claude, codex, gemini, pi].map((adapter) => [adapter.id, adapter]));
export const coreAdapters = ['agy', 'codebuddy', 'claude', 'codex', 'gemini'];
