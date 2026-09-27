// Slug to comparison for /compare. Eager, for the reason given in content/news/index.ts.

import type { Comparison } from "./comparison";
import { GROK_BOT_COMPARISON } from "./grok-bot";

export const COMPARISONS: Readonly<Record<string, Comparison>> = {
  "grok-bot": GROK_BOT_COMPARISON,
};
