import { agentsStore } from './agentsStore.js';
import { claude } from './claude.js';
import { codex } from './codex.js';
import { kiro } from './kiro.js';
import { opencode } from './opencode.js';
import type { HarnessAdapter } from './types.js';

export const BUILTIN_ADAPTERS: HarnessAdapter[] = [claude, kiro, codex, opencode, agentsStore];
