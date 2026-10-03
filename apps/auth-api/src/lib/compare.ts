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
  indexTitle: "Compare OpenBot with other AI agent apps",
  indexDescription:
    "How AI agent apps compare: OpenBot against other apps, coding agents against each other, and where the agents run, which models they use and what they cost.",
  feedTitle: "OpenBot comparisons",
  backLabel: "All comparisons",
  moreTitle: "More comparisons",
  imageEyebrow: "OPENBOT · COMPARE",
  articles: publishedFirst([
    {
      slug: "best-ai-agent-apps",
      title: "Best AI Agent Apps in 2026: 13 Apps Compared",
      description:
        "The best AI agent apps in 2026: OpenBot, Claude Code, Codex, Cursor, Antigravity, Devin, Manus and more, with where they run, models and price.",
      publishedAt: "2026-10-03",
      updatedAt: "2026-10-03",
      author: NEWS_AUTHOR,
    },
    {
      slug: "codex-vs-claude-code",
      title: "Codex vs Claude Code: Which Coding Agent to Use",
      description:
        "Codex vs Claude Code: models, plans, sandbox, cloud work and data, compared from official sources. Or run both as one team in OpenBot.",
      publishedAt: "2026-10-03",
      updatedAt: "2026-10-03",
      author: NEWS_AUTHOR,
    },
    {
      slug: "claude-code-vs-antigravity",
      title: "Claude Code vs Antigravity: Claude or Gemini Agent",
      description:
        "Claude Code vs Google Antigravity: models, plans, apps and data, compared from official sources. Or run both as one team in OpenBot.",
      publishedAt: "2026-10-03",
      updatedAt: "2026-10-03",
      author: NEWS_AUTHOR,
    },
    {
      slug: "cursor-vs-claude-code",
      title: "Cursor vs Claude Code: Editor or Terminal Agent",
      description:
        "Cursor vs Claude Code: models, plans, cloud agents and data, compared from official sources. Or run both as one team in OpenBot.",
      publishedAt: "2026-10-03",
      updatedAt: "2026-10-03",
      author: NEWS_AUTHOR,
    },
    {
      slug: "chatgpt-dots",
      title: "OpenBot vs ChatGPT dots: A Local Alternative",
      description:
        "OpenBot is a free, local ChatGPT dots alternative: run a team of AI agents on your own computer, in any country, with the ChatGPT plan you already pay for.",
      publishedAt: "2026-10-02",
      updatedAt: "2026-10-02",
      author: NEWS_AUTHOR,
    },
    {
      slug: "devin",
      title: "OpenBot vs Devin: A Local Devin Alternative",
      description:
        "OpenBot is a free, local Devin alternative: run Codex, Claude Code, Gemini and Grok as a coding agent team on your computer, with plans you already have.",
      publishedAt: "2026-09-27",
      updatedAt: "2026-10-02",
      author: NEWS_AUTHOR,
    },
    {
      slug: "claude-cowork",
      title: "OpenBot vs Claude Cowork: A Local Alternative",
      description:
        "OpenBot vs Claude Cowork: run Claude Code, Codex, Gemini and Grok as a team on your own computer, with the AI plans you already pay for. Compare the two.",
      publishedAt: "2026-09-27",
      updatedAt: "2026-10-02",
      author: NEWS_AUTHOR,
    },
    {
      slug: "manus",
      title: "OpenBot vs Manus: A Local Manus Alternative",
      description:
        "OpenBot is a free, local Manus alternative: run a team of AI agents on your own computer with the ChatGPT, Claude, Gemini or Grok plan you already pay for.",
      publishedAt: "2026-09-27",
      updatedAt: "2026-10-02",
      author: NEWS_AUTHOR,
    },
    {
      slug: "openclaw",
      title: "OpenBot vs OpenClaw: An OpenClaw Alternative",
      description:
        "OpenBot vs OpenClaw (formerly Clawdbot and Moltbot): run Codex, Claude Code, Gemini and Grok as a team on your computer, and reach them from your phone.",
      publishedAt: "2026-09-27",
      updatedAt: "2026-10-02",
      author: NEWS_AUTHOR,
    },
    {
      slug: "hermes-agent",
      title: "OpenBot vs Hermes Agent: A Hermes Agent Alternative",
      description:
        "OpenBot vs Hermes Agent: run Codex, Claude Code, Gemini and Grok as a team on your computer, with the AI plans you already pay for. Compare the two.",
      publishedAt: "2026-09-27",
      updatedAt: "2026-10-02",
      author: NEWS_AUTHOR,
    },
    {
      slug: "muse",
      title: "OpenBot vs Muse: A Local Alternative to Meta's Muse",
      description:
        "OpenBot is a free, local alternative to Meta's Muse: run a team of AI agents on your computer with the ChatGPT, Claude, Gemini or Grok plan you have.",
      publishedAt: "2026-09-27",
      updatedAt: "2026-10-02",
      author: NEWS_AUTHOR,
    },
    {
      // Published first in /news, as openbot-vs-grokbot. That URL answers with a
      // permanent redirect here (routes/news/openbot-vs-grokbot.ts).
      slug: "grok-bot",
      title: "OpenBot vs Grok Bot: A Local Grok Bot Alternative",
      description:
        "OpenBot is a free, local Grok Bot alternative: run AI agents on your computer with the ChatGPT, Claude, Gemini or Grok plan you already pay for.",
      publishedAt: "2026-09-24",
      updatedAt: "2026-10-02",
      author: NEWS_AUTHOR,
    },
  ]),
};
