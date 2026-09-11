// The one list of published guides. Same shape as the news registry, and read by
// the same pages, feed, sitemap and image generator.
//
// These entries are placeholders. They describe work the app already does, and
// the bodies in src/content/guides are short on purpose: they exist so the
// section can be seen, reviewed and linked while the real guides are written.

import { type ContentCollection, publishedFirst } from "./content-collection";
import { NEWS_AUTHOR } from "./news";

export const GUIDES_COLLECTION: ContentCollection = {
  id: "guides",
  indexRoute: "/guides",
  articleRoute: "/guides/$slug",
  name: "Guides",
  indexTitle: "Guides — OpenBot",
  indexDescription:
    "Short walkthroughs for the things you do first: install OpenBot, give an agent a task, move it between providers, and put a team on your own server.",
  feedTitle: "OpenBot guides",
  backLabel: "All guides",
  moreTitle: "More guides",
  imageEyebrow: "OPENBOT · GUIDES",
  articles: publishedFirst([
    {
      slug: "install-openbot-on-macos",
      title: "Install OpenBot on macOS",
      description:
        "Download the build for your chip, move it to Applications, and get past the first-run checks. About five minutes, most of it waiting.",
      publishedAt: "2026-09-02",
      author: NEWS_AUTHOR,
    },
    {
      slug: "give-an-agent-its-first-task",
      title: "Give an agent its first task",
      description:
        "Create an agent, point it at a folder, and ask for something small. What a good first instruction looks like, and what to do with the answer.",
      publishedAt: "2026-08-21",
      author: NEWS_AUTHOR,
    },
    {
      slug: "switch-an-agent-between-providers",
      title: "Switch an agent between providers",
      description:
        "Move one agent from Codex to Claude to Grok without losing its workspace or its thread. What carries across, and what each provider starts fresh.",
      publishedAt: "2026-08-06",
      author: NEWS_AUTHOR,
    },
    {
      slug: "start-a-channel-for-two-agents",
      title: "Start a channel for two agents",
      description:
        "A channel is one thread several agents read and write. How to open one, who should be in it, and how to keep the two of them from talking past each other.",
      publishedAt: "2026-07-18",
      author: NEWS_AUTHOR,
    },
    {
      slug: "schedule-a-routine",
      title: "Schedule a routine",
      description:
        "Write one instruction, pick the times, and let the agent do it in its own thread. How to size a routine so you still read it in a month.",
      publishedAt: "2026-07-02",
      author: NEWS_AUTHOR,
    },
    {
      slug: "host-a-team-server",
      title: "Host a team server",
      description:
        "Turn on the Team API on a computer you own, invite somebody, and understand exactly which part of it the hosted account service can see.",
      publishedAt: "2026-06-19",
      author: NEWS_AUTHOR,
    },
  ]),
};
