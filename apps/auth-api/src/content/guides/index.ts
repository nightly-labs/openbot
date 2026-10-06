// Slug to guide body, on the same terms as the news bodies: eager, so the prose
// is in the server's HTML rather than arriving after hydration.

import type { ArticleBody } from "../body";
import { OpenBot101 } from "./openbot-101";
import { OpenBotMarketplace } from "./openbot-marketplace";
import { WhatAreAIAgents } from "./what-are-ai-agents";
import { WtfIsOpenBot } from "./wtf-is-openbot";

export const GUIDE_BODIES: Readonly<Record<string, ArticleBody>> = {
  "what-are-ai-agents": WhatAreAIAgents,
  "openbot-101": OpenBot101,
  "openbot-marketplace": OpenBotMarketplace,
  "wtf-is-openbot": WtfIsOpenBot,
};
