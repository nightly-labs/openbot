import type { PluginGuide } from "./plugin-guide";

// Every statement about Brave Search here is taken from brave.com and Brave's
// brave-search-mcp-server repository on github.com. Each page used is in `sources`. Check the
// sources again, and move `checkedAt`, whenever this file changes.

export const BRAVE_SEARCH_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Research with cited sources",
      text: "The brave_web_search tool returns web results with rich result types and filters. The brave_llm_context tool returns content that Brave extracts from pages for grounding. Every result comes from Brave's own independent index, so the agent can cite the pages it read.",
    },
    {
      title: "Follow current news",
      text: "The brave_news_search tool finds recent news articles. Its freshness controls limit the results to a recent period. The agent can then compare what each article says about a product or an event.",
    },
    {
      title: "Find local places",
      text: "The brave_local_search tool finds local businesses and places, with ratings, hours and descriptions. The brave_place_search tool finds points of interest in a geographic area. Brave's MCP server falls back to web search when full local search is not available on your plan.",
    },
    {
      title: "Find images and videos",
      text: "The brave_image_search tool finds images, with their URLs and dimensions. The brave_video_search tool finds videos, with metadata and thumbnails. The agent can collect these results for a slide, a report or a reference list.",
    },
  ],
  faq: [
    {
      question: "Is the Brave Search MCP server official?",
      answer:
        "Yes. Brave links to the MCP server from its Search API page. The code is in Brave's GitHub organization and has an MIT license. The OpenBot listing runs this package as a local server.",
    },
    {
      question: "Does the Brave Search plugin need an API key?",
      answer:
        "Yes. Sign up for the Brave Search API and make a key in its dashboard. Type the key in the OpenBot connect dialog. OpenBot gives it to the local server as BRAVE_API_KEY. The plugin catalog holds no secret.",
    },
    {
      question: "Does Brave Search cost anything?",
      answer:
        "Installing the plugin is free. Brave uses prepaid credits, not subscriptions, and asks for a credit card to prevent abuse. The Search plan costs $5 per 1,000 requests and includes free credits every month.",
    },
    {
      question: "What data does Brave get?",
      answer:
        "Brave gets the search queries that the agent sends. Brave says that it never shares queries or trains on them, and that each query stays on infrastructure that Brave operates. Your OpenBot workspaces, conversations and files stay on the computer that runs OpenBot.",
    },
  ],
  sources: [
    { label: "Brave Search API", url: "https://brave.com/search/api/" },
    { label: "Brave Search MCP server on GitHub", url: "https://github.com/brave/brave-search-mcp-server" },
  ],
  checkedAt: "2026-10-23",
};
