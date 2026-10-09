// `/llms.txt` (llmstxt.org): the site as one short Markdown file, for an assistant
// that answers a question about OpenBot. Built from the same registries as the
// sitemap, so a new article or comparison is in it with no edit here.

import { COMPARISONS } from "../content/compare";
import { OPENBOT_PLANS } from "../content/compare/comparison";
import { PROVIDER_PAGES } from "../content/providers";
import { CHANGELOG_DESCRIPTION, changelogUrl } from "../lib/changelog";
import { CONTENT_COLLECTIONS } from "../lib/content";
import { articleUrl, type CollectionId, collectionIndexUrl } from "../lib/content-collection";
import {
  OPENBOT_ALTERNATE_DOWNLOAD_LINKS,
  OPENBOT_DOWNLOAD_LINKS,
  OPENBOT_DOWNLOAD_PAGE_LINKS,
  OPENBOT_LINKS,
} from "../lib/landing-links";
import { PLUGINS_DESCRIPTION, pluginIndexUrl } from "../lib/plugins";
import { OPENBOT_SITE_DESCRIPTION, OPENBOT_SITE_URL } from "../lib/site-metadata";
import { FEED_CACHE_CONTROL } from "./content-feed";

/** The one-sentence answer of a page drawn from data. A prose article has none, and uses its description. */
function referenceAnswer(collection: CollectionId, slug: string): string | undefined {
  if (collection === "compare") return COMPARISONS[slug]?.answer;
  if (collection === "providers") return PROVIDER_PAGES[slug]?.answer;
  return undefined;
}

function absolute(path: string): string {
  return new URL(path, OPENBOT_SITE_URL).href;
}

function llmsTxt(): string {
  const lines = [
    "# OpenBot",
    "",
    `> ${OPENBOT_SITE_DESCRIPTION}`,
    "",
    "OpenBot is a desktop app for macOS, Windows and Linux. Each agent has its own workspace, thread and history, and keeps them when you change its provider or restart the app. Agents can give work to other agents. Chats, files and workspaces stay on your computer; OpenBot has no server that holds them. The app is free for noncommercial use. iPhone and Android apps connect to OpenBot on your own computer.",
    "",
    `Each article below also has its text as Markdown, at its URL with \`.md\` added. [llms-full.txt](${absolute("/llms-full.txt")}) holds all of them in one file.`,
    "",
    "## Models and plans",
    "",
    "OpenBot sells no model. Each agent uses a plan or a key you already have:",
    "",
    ...OPENBOT_PLANS.map((plan) => `- ${plan.name}: ${plan.plan}`),
    "",
    "## Download",
    "",
    `System requirements and install steps: [macOS](${absolute(OPENBOT_DOWNLOAD_PAGE_LINKS.macos)}), [Windows](${absolute(OPENBOT_DOWNLOAD_PAGE_LINKS.windows)}), [Linux](${absolute(OPENBOT_DOWNLOAD_PAGE_LINKS.linux)}), [iPhone](${absolute(OPENBOT_DOWNLOAD_PAGE_LINKS.ios)}), [Android](${absolute(OPENBOT_DOWNLOAD_PAGE_LINKS.android)}).`,
    "",
    `- [macOS](${absolute(OPENBOT_DOWNLOAD_LINKS.macos)}): macOS 13 or later, Apple silicon`,
    `- [macOS for Intel](${absolute(OPENBOT_ALTERNATE_DOWNLOAD_LINKS.macos)}): macOS 13 or later, Intel`,
    `- [Windows](${absolute(OPENBOT_DOWNLOAD_LINKS.windows)}): Windows 10 or later, x64`,
    `- [Linux](${absolute(OPENBOT_DOWNLOAD_LINKS.linux)}): x64 AppImage`,
    `- [Linux for arm64](${absolute(OPENBOT_ALTERNATE_DOWNLOAD_LINKS.linux)}): arm64 AppImage`,
    `- [Source code](${OPENBOT_LINKS.repository}): PolyForm Noncommercial 1.0.0`,
    "",
  ];

  for (const collection of CONTENT_COLLECTIONS) {
    lines.push(
      `## ${collection.name}`,
      "",
      `${collection.indexDescription} [All](${collectionIndexUrl(collection)})`,
      "",
    );
    for (const article of collection.articles) {
      const answer = referenceAnswer(collection.id, article.slug);
      lines.push(`- [${article.title}](${articleUrl(collection, article.slug)}): ${answer ?? article.description}`);
    }
    lines.push("");
  }

  lines.push(
    "## Optional",
    "",
    `- [Plugins](${pluginIndexUrl()}): ${PLUGINS_DESCRIPTION}`,
    `- [Changelog](${changelogUrl()}): ${CHANGELOG_DESCRIPTION}`,
    "",
  );
  return lines.join("\n");
}

export function llmsTxtResponse(): Response {
  return new Response(llmsTxt(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": FEED_CACHE_CONTROL,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
