// Keto calculation rules for the claude.ai redirect prompt (ClaudeCalcModal).
//
// The rules themselves come from shared/ketoCore.js — the same text the server
// estimators use as their system-prompt core — so one edit there keeps the
// web-chat flow and the in-app calculator in agreement. Only a header is added;
// the deep-link reply format lives in claudeCalc.js's buildPrompt.
import { KETO_CORE_RULES } from '../../../shared/ketoCore.js';

export const KETO_PROMPT_RULES = `כללי חישוב קטוגניים (חובה):\n${KETO_CORE_RULES}`;
