// Slug to comparison for /compare. Eager, for the reason given in content/news/index.ts.

import type { Comparison } from "./comparison";
import { GROK_BOT_COMPARISON } from "./grok-bot";
import { HERMES_AGENT_COMPARISON } from "./hermes-agent";
import { MUSE_COMPARISON } from "./muse";
import { OPENCLAW_COMPARISON } from "./openclaw";

export const COMPARISONS: Readonly<Record<string, Comparison>> = {
  "grok-bot": GROK_BOT_COMPARISON,
  "hermes-agent": HERMES_AGENT_COMPARISON,
  muse: MUSE_COMPARISON,
  openclaw: OPENCLAW_COMPARISON,
};
