import type { PluginGuide } from "./plugin-guide";

// Every statement about Firecrawl here is taken from firecrawl.dev, docs.firecrawl.dev and
// Firecrawl's firecrawl-mcp-server repository. Each page used is in `sources`. Check the
// sources again, and move `checkedAt`, whenever this file changes.

export const FIRECRAWL_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Turn a page into data",
      text: "The firecrawl_scrape tool reads one URL and returns it as Markdown or as structured JSON. The agent can then put prices, specifications or contact details into a table. The firecrawl_parse tool reads PDFs and other documents in the same way.",
    },
    {
      title: "Search the web with sources",
      text: "The firecrawl_search tool searches the web and can return the page content with each result. The agent can compare the pages and give the address of each claim. The firecrawl_map tool lists the URLs of a site and does not fetch their content.",
    },
    {
      title: "Crawl a documentation site",
      text: "The firecrawl_crawl tool reads many pages of one site and returns their data. For a long job, the agent uses firecrawl_check_crawl_status with the job ID. Use it to collect a full set of docs before the agent writes a summary or a migration plan.",
    },
    {
      title: "Watch a page for changes",
      text: "The firecrawl_monitor tools make recurring monitors for a page. Each monitor runs checks and keeps the differences between versions. The agent can read these differences and tell you what changed on a pricing page, a status page or a release notes page.",
    },
  ],
  faq: [
    {
      question: "Is the Firecrawl MCP server official?",
      answer:
        "Yes. Firecrawl publishes the firecrawl-mcp package in its own GitHub organization, and the repository calls it the official Firecrawl MCP server. It has the MIT license. OpenBot starts this package on the computer that runs OpenBot.",
    },
    {
      question: "Does the Firecrawl plugin need an API key?",
      answer:
        "Yes. Make an API key in the Firecrawl dashboard, then type it in the connect dialog in OpenBot. OpenBot gives the key to the local server as the FIRECRAWL_API_KEY environment variable. The plugin catalog holds no secret.",
    },
    {
      question: "Does Firecrawl cost anything?",
      answer:
        "Firecrawl has a free plan with 1,000 credits each month and no credit card. A scrape costs 1 credit for each page. A search costs 2 credits for each 10 results. The firecrawl_credit_usage tool tells the agent how many credits remain on your plan.",
    },
    {
      question: "What data does Firecrawl get?",
      answer:
        "Firecrawl gets the requests that the agent sends, such as URLs, search queries and extraction schemas. The local server sends them to the Firecrawl API with your key. Your workspaces, conversations and files stay on the computer that runs OpenBot.",
    },
  ],
  sources: [
    { label: "Firecrawl MCP server", url: "https://docs.firecrawl.dev/mcp-server" },
    {
      label: "Firecrawl MCP server repository",
      url: "https://github.com/firecrawl/firecrawl-mcp-server",
    },
    { label: "Firecrawl pricing", url: "https://www.firecrawl.dev/pricing" },
  ],
  checkedAt: "2026-10-23",
};
