// The one list of published guides. Same shape as the news registry, and read by
// the same pages, feed, sitemap and image generator.
//
// Two guides, and they do different jobs. "OpenBot 101" is the page to send
// somebody who has never opened the app. "Write a guide for OpenBot" is the
// house style, and it is also the worked example: it uses every element a body
// can use, so the next guide is written by copying from it rather than by
// reading the components.

import { type ContentCollection, publishedFirst } from "./content-collection";
import { NEWS_AUTHOR } from "./news";

export const GUIDES_COLLECTION: ContentCollection = {
  id: "guides",
  indexRoute: "/guides",
  articleRoute: "/guides/$slug",
  name: "Guides",
  indexTitle: "Guides — OpenBot",
  indexDescription:
    "How OpenBot works and how to write about it. Start with OpenBot 101, then use the template guide as the worked example for the next one.",
  feedTitle: "OpenBot guides",
  backLabel: "All guides",
  moreTitle: "More guides",
  imageEyebrow: "OPENBOT · GUIDES",
  articles: publishedFirst([
    {
      slug: "what-are-ai-agents",
      title: "What Are AI Agents? How They Work and When to Use Them",
      description:
        "What are AI agents, how do they work, and when are they useful? A practical guide to their tools, use cases, and limits.",
      publishedAt: "2026-09-24",
      author: NEWS_AUTHOR,
    },
    {
      slug: "openbot-101",
      title: "OpenBot 101",
      description:
        "What OpenBot is, what an agent keeps between runs, and how to get one doing real work on your computer. Start here if you have not opened the app yet.",
      publishedAt: "2026-09-12",
      author: NEWS_AUTHOR,
    },
    {
      slug: "write-a-guide-for-openbot",
      title: "Write a guide for OpenBot",
      description:
        "How to write a guide for OpenBot, with a worked example of every element one can use: prose, links, tables, images, animations, clips and captioned video.",
      publishedAt: "2026-09-11",
      author: NEWS_AUTHOR,
    },
    {
      slug: "wtf-is-openbot",
      title: "WTF Is OpenBot?",
      description:
        "A practical explanation of models, providers, agents, and the local-first workspace that brings them together.",
      publishedAt: "2026-09-15",
      author: NEWS_AUTHOR,
    },
  ]),
};
