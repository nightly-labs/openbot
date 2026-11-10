import type { PluginGuide } from "./plugin-guide";

// Every statement about RankReactor here is taken from rankreactor.ai. Each page used is in
// `sources`. Check the sources again, and move `checkedAt`, whenever this file changes.

export const RANKREACTOR_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Read project status and quotas",
      text: "The list_projects tool names the one RankReactor project that the API key can use. The get_reactor_status tool reads that site's plan, quotas, and recent article or video activity.",
    },
    {
      title: "Inspect SEO metrics and site health",
      text: "The get_metrics tool reads stored search and site-health numbers for the project. The refresh_metrics tool refreshes one stored metric (analytics, technical SEO, website audit, or keywords), subject to that metric's plan limit. Refreshing a metric asks for confirmation first.",
    },
    {
      title: "List and queue SEO articles",
      text: "The list_articles and get_article tools read generated articles, including markdown and HTML. The generate_article tool queues a new article. It uses the same article limits as the RankReactor dashboard and asks for confirmation first.",
    },
    {
      title: "List and queue UGC videos",
      text: "The list_ugc_videos and get_ugc_video tools read generated short videos, including a download URL when a video is ready. The generate_ugc_video tool queues a short product video. It uses the same monthly video limits as the dashboard and asks for confirmation first. UGC video needs a Pro or Ultra plan.",
    },
  ],
  faq: [
    {
      question: "Is the RankReactor MCP server official?",
      answer:
        "Yes. Sierra Dynamics LLC hosts the MCP server at https://www.rankreactor.ai/mcp and documents it on rankreactor.ai. This plugin uses that hosted Streamable HTTP server. There is no local stdio bridge.",
    },
    {
      question: "Which key does the RankReactor plugin need?",
      answer:
        "A project API key from the RankReactor dashboard. Open API Key in the sidebar and choose Generate. Keys start with rr_live_. Type the key in the connect dialog in OpenBot. OpenBot sends it as a bearer token in the Authorization header. The key reaches one project. The plugin catalog holds no secret.",
    },
    {
      question: "Why does OpenBot not sign in to RankReactor in the browser?",
      answer:
        "OpenBot connects RankReactor with the project API key only. RankReactor also offers an OAuth paste-your-key consent page for other clients. This listing does not use that flow. Create a key in the dashboard and type it in the connect dialog.",
    },
    {
      question: "What can the agent change in RankReactor?",
      answer:
        "With your confirmation, the agent can refresh a metric, queue an article, queue a UGC video, and turn automatic shop article generation on or off. Generation and refresh use the same plan limits as the dashboard. The agent cannot publish articles or videos to YouTube, Blogger, or other destinations, delete project content, or change your account or billing. To stop the access, revoke or regenerate the key in the RankReactor dashboard.",
    },
  ],
  sources: [
    {
      label: "RankReactor: Use RankReactor with your AI assistant",
      url: "https://www.rankreactor.ai/docs/ai-assistants",
    },
    { label: "RankReactor: Privacy policy", url: "https://www.rankreactor.ai/privacy-policy" },
    { label: "RankReactor MCP listing", url: "https://github.com/rankreactorai/rankreactorai-mcp" },
  ],
  checkedAt: "2026-11-10",
};
