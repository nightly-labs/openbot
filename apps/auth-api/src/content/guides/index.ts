// Slug to guide body, on the same terms as the news bodies: eager, so the prose
// is in the server's HTML rather than arriving after hydration.

import type { ArticleBody } from "../body";
import { OpenBot101 } from "./openbot-101";
import { WtfIsOpenBot } from "./wtf-is-openbot";

export const GUIDE_BODIES: Readonly<Record<string, ArticleBody>> = {
  "openbot-101": OpenBot101,
  "wtf-is-openbot": WtfIsOpenBot,
};
