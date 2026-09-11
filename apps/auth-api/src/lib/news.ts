// The one list of published articles. The index page, the article pages, the
// sitemap, the RSS feed and the build-time image generator all read it, so an
// article is added in exactly one place and nothing can fall out of step.
//
// This module deliberately holds no JSX and imports nothing from solid-js: the
// image generator runs in plain Bun, and pulling a renderer into that graph would
// make the build depend on the UI it is only illustrating. Article bodies live in
// src/content/news and are wired up separately.

import { OPENBOT_SITE_URL } from "./site-metadata";

export interface NewsArticle {
  /** URL segment. Lowercase, hyphenated, never changed after publication. */
  slug: string;
  title: string;
  /** Meta description and feed summary. Aim for 110-160 characters. */
  description: string;
  /** `YYYY-MM-DD`, treated as UTC. */
  publishedAt: string;
  /** `YYYY-MM-DD`, set only when the body changed meaningfully after publication. */
  updatedAt?: string;
  author: string;
}

export const NEWS_AUTHOR = "Norbert Bodziony";

// Newest first is the order every consumer wants, so sort once here rather than
// asking each caller to remember. Editing order in the source is then free.
export const NEWS_ARTICLES: readonly NewsArticle[] = [
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
      "One directory per agent, kept between runs. Separate workspaces make the question of which agent touched a file unnecessary rather than answerable.",
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
].toSorted((left, right) => right.publishedAt.localeCompare(left.publishedAt));

export function findNewsArticle(slug: string): NewsArticle | undefined {
  return NEWS_ARTICLES.find((article) => article.slug === slug);
}

export function newsArticlePath(slug: string): string {
  return `/news/${slug}`;
}

export function newsArticleUrl(slug: string): string {
  return new URL(newsArticlePath(slug), OPENBOT_SITE_URL).toString();
}

/** The 1200x630 social card, with the title baked in. Built by `news-og-images.ts`. */
export function newsOgImageUrl(slug: string): string {
  return new URL(`/news/og/${slug}.png`, OPENBOT_SITE_URL).toString();
}

/** The card artwork on /news. Gradient only: the title sits over it as real text. */
export function newsCardImagePath(slug: string): string {
  return `/news/card/${slug}.png`;
}

// Fixed to UTC on purpose. The Worker renders in UTC and the reader's browser does
// not, so a local-time format makes the server and client disagree on the date near
// midnight and hydration tears the label apart.
const NEWS_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export function formatNewsDate(publishedAt: string): string {
  return NEWS_DATE_FORMAT.format(new Date(`${publishedAt}T00:00:00Z`));
}

/** RFC 822, which is what RSS 2.0 requires for `pubDate`. */
export function newsRssDate(publishedAt: string): string {
  return new Date(`${publishedAt}T00:00:00Z`).toUTCString();
}
