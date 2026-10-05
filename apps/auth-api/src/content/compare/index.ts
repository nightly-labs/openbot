// Slug to comparison for /compare. Eager, for the reason given in content/news/index.ts.

import { BEST_AI_AGENT_APPS } from "./best-ai-agent-apps";
import { CHATGPT_DOTS_COMPARISON } from "./chatgpt-dots";
import { CLAUDE_CODE_VS_ANTIGRAVITY } from "./claude-code-vs-antigravity";
import { CLAUDE_COWORK_COMPARISON } from "./claude-cowork";
import { CODEX_VS_CLAUDE_CODE } from "./codex-vs-claude-code";
import type { ComparePage } from "./comparison";
import { CURSOR_VS_CLAUDE_CODE } from "./cursor-vs-claude-code";
import { DEVIN_COMPARISON } from "./devin";
import { GROK_BOT_COMPARISON } from "./grok-bot";
import { HERMES_AGENT_COMPARISON } from "./hermes-agent";
import { MANUS_COMPARISON } from "./manus";
import { MUSE_COMPARISON } from "./muse";
import { OPENCLAW_COMPARISON } from "./openclaw";

export const COMPARISONS: Readonly<Record<string, ComparePage>> = {
  "best-ai-agent-apps": BEST_AI_AGENT_APPS,
  "chatgpt-dots": CHATGPT_DOTS_COMPARISON,
  "claude-code-vs-antigravity": CLAUDE_CODE_VS_ANTIGRAVITY,
  "claude-cowork": CLAUDE_COWORK_COMPARISON,
  "codex-vs-claude-code": CODEX_VS_CLAUDE_CODE,
  "cursor-vs-claude-code": CURSOR_VS_CLAUDE_CODE,
  devin: DEVIN_COMPARISON,
  "grok-bot": GROK_BOT_COMPARISON,
  "hermes-agent": HERMES_AGENT_COMPARISON,
  manus: MANUS_COMPARISON,
  muse: MUSE_COMPARISON,
  openclaw: OPENCLAW_COMPARISON,
};
