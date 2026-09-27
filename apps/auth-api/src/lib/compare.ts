// The one list of published comparisons. Like news and guides, the sitemap, the
// feed, the head tags and the build-time image generator read it. The page itself
// is not prose: it is drawn from the data in src/content/compare.
//
// No JSX here, for the same reason `content-collection.ts` holds none.

import { type ContentCollection, publishedFirst } from "./content-collection";
import { NEWS_AUTHOR } from "./news";

export const COMPARE_COLLECTION: ContentCollection<"compare"> = {
  id: "compare",
  indexRoute: "/compare",
  articleRoute: "/compare/$slug",
  name: "Compare",
  indexTitle: "Compare OpenBot with other AI agent apps — OpenBot",
  indexDescription:
    "How OpenBot compares with other AI agent apps: where the agents run, which models they use, how teams work, and where your data stays.",
  feedTitle: "OpenBot comparisons",
  backLabel: "All comparisons",
  moreTitle: "More comparisons",
  imageEyebrow: "OPENBOT · COMPARE",
  articles: publishedFirst([
    {
      slug: "hermes-agent",
      title: "OpenBot vs Hermes Agent: A Hermes Agent Alternative",
      description:
        "OpenBot vs Hermes Agent: run Codex, Claude Code, Gemini and Grok as a team on your computer, with the AI plans you already pay for. Compare the two.",
      publishedAt: "2026-09-27",
      updatedAt: "2026-09-27",
      author: NEWS_AUTHOR,
    },
    {
      slug: "muse",
      title: "OpenBot vs Muse: A Local Alternative to Meta's Muse",
      description:
        "OpenBot is a free, local alternative to Meta's Muse: run a team of AI agents on your own computer with the ChatGPT, Claude, Gemini or Grok plan you already pay for.",
      publishedAt: "2026-09-27",
      updatedAt: "2026-09-27",
      author: NEWS_AUTHOR,
    },
    {
      // Published first in /news, as openbot-vs-grokbot. That URL answers with a
      // permanent redirect here (routes/news/openbot-vs-grokbot.ts).
      slug: "grok-bot",
      title: "OpenBot vs Grok Bot: A Local Grok Bot Alternative",
      description:
        "OpenBot is a free, local Grok Bot alternative: run AI agents on your computer with the ChatGPT, Claude, Gemini or Grok plan you already pay for. Compare the two.",
      publishedAt: "2026-09-24",
      updatedAt: "2026-09-27",
      author: NEWS_AUTHOR,
    },
  ]),
};
