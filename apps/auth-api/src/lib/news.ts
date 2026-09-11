// The one list of published news articles. The index page, the article pages, the
// sitemap, the RSS feed and the build-time image generator all read it, so an
// article is added in exactly one place and nothing can fall out of step.
//
// Everything that is not the list itself lives in content-collection.ts, which
// /guides uses as well. Like that module, this one holds no JSX: article bodies
// are in src/content/news and are wired up separately.

import { type ContentCollection, publishedFirst } from "./content-collection";

export const NEWS_AUTHOR = "Norbert Bodziony";

export const NEWS_COLLECTION: ContentCollection = {
  id: "news",
  indexRoute: "/news",
  articleRoute: "/news/$slug",
  name: "News",
  indexTitle: "News — OpenBot",
  indexDescription:
    "Notes on building OpenBot: local-first storage, agents that outlive their provider, and how the pieces fit together.",
  feedTitle: "OpenBot news",
  backLabel: "All news",
  moreTitle: "More from OpenBot",
  imageEyebrow: "OPENBOT · NEWS",
  articles: publishedFirst([
    {
      slug: "your-work-stays-on-your-computer",
      title: "Your work stays on your computer",
      description:
        "Workspaces, conversations and attachments live in a SQLite database you own. Here is what that rules out, and the one thing it does not.",
      publishedAt: "2026-09-08",
      author: NEWS_AUTHOR,
    },
    {
      slug: "one-agent-many-providers",
      title: "One agent, many providers",
      description:
        "An agent keeps its workspace, its thread and its identity when you move it between Codex, Claude and Grok. Switching model should not cost you the context.",
      publishedAt: "2026-08-27",
      author: NEWS_AUTHOR,
    },
    {
      slug: "channels-put-agents-in-one-room",
      title: "Channels put agents in one room",
      description:
        "A channel is a shared thread several agents read and write. It turns a pile of parallel chats into something closer to a team conversation.",
      publishedAt: "2026-08-14",
      author: NEWS_AUTHOR,
    },
    {
      slug: "routines-give-an-agent-a-schedule",
      title: "Routines give an agent a schedule",
      description:
        "A routine is one instruction and the times to run it. The agent does the work in its own thread, so the result lands where the context already is.",
      publishedAt: "2026-08-05",
      author: NEWS_AUTHOR,
    },
    {
      slug: "every-agent-gets-a-workspace",
      title: "Every agent gets a workspace",
      description:
        "One directory per agent, kept between runs, and one shared directory for handoffs. A workspace organizes an agent's work; it does not limit what the agent can touch.",
      publishedAt: "2026-07-24",
      author: NEWS_AUTHOR,
    },
    {
      slug: "run-the-team-server-yourself",
      title: "Run the team server yourself",
      description:
        "Teams run on a computer you own. The hosted part holds accounts and memberships; it never holds your conversations, your files or your commands.",
      publishedAt: "2026-07-11",
      author: NEWS_AUTHOR,
    },
    {
      slug: "what-gets-redacted-before-it-leaves",
      title: "What gets redacted before it leaves",
      description:
        "Secrets are stripped at every path out of the app: logs, diagnostics, crash reports and analytics. Here is why we redact at the exit, not at the call site.",
      publishedAt: "2026-06-30",
      author: NEWS_AUTHOR,
    },
  ]),
};
