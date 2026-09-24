// Slug to guide body, on the same terms as the news bodies: eager, so the prose
// is in the server's HTML rather than arriving after hydration.

import type { ArticleBody } from "../body";
import { OpenBot101 } from "./openbot-101";
import { WhatAreAIAgents } from "./what-are-ai-agents";
import { WriteAGuideForOpenBot } from "./write-a-guide-for-openbot";
import { WtfIsOpenBot } from "./wtf-is-openbot";

export const GUIDE_BODIES: Readonly<Record<string, ArticleBody>> = {
  "what-are-ai-agents": WhatAreAIAgents,
  "openbot-101": OpenBot101,
  "write-a-guide-for-openbot": WriteAGuideForOpenBot,
  "wtf-is-openbot": WtfIsOpenBot,
};
