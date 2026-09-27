// Slug to comparison for /compare. Eager, for the reason given in content/news/index.ts.

import { CLAUDE_COWORK_COMPARISON } from "./claude-cowork";
import type { Comparison } from "./comparison";
import { DEVIN_COMPARISON } from "./devin";
import { GROK_BOT_COMPARISON } from "./grok-bot";
import { HERMES_AGENT_COMPARISON } from "./hermes-agent";
import { MANUS_COMPARISON } from "./manus";
import { MUSE_COMPARISON } from "./muse";
import { OPENCLAW_COMPARISON } from "./openclaw";

export const COMPARISONS: Readonly<Record<string, Comparison>> = {
  "claude-cowork": CLAUDE_COWORK_COMPARISON,
  devin: DEVIN_COMPARISON,
  "grok-bot": GROK_BOT_COMPARISON,
  "hermes-agent": HERMES_AGENT_COMPARISON,
  manus: MANUS_COMPARISON,
  muse: MUSE_COMPARISON,
  openclaw: OPENCLAW_COMPARISON,
};
