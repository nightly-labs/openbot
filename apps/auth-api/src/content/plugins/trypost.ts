import type { PluginGuide } from "./plugin-guide";

// Every statement about TryPost here is taken from trypost.it and docs.trypost.it. Each page used is
// in `sources`. Check the sources again, and move `checkedAt`, whenever this file changes.

export const TRYPOST_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "See your channels",
      text: "The list-social-accounts-tool tool lists the social media channels that are connected to your TryPost workspace. The list-content-types-tool tool gives the post types and the rules of each network.",
    },
    {
      title: "Draft, schedule and publish posts",
      text: "The create-post-tool tool makes a draft, schedules a post for a date, adds it to the channel queue, or publishes it now. The create-posts-tool tool makes one post for each of several channels. The preview-post-tool tool shows the text that the network will get, before anything is published.",
    },
    {
      title: "Manage the queue",
      text: "The get-posting-schedule-tool and update-posting-schedule-tool tools read and set the posting times of a channel. The list-free-slots-tool tool lists the free queue slots, and reorder-queue-tool changes the order of the queue.",
    },
    {
      title: "Read analytics",
      text: "The get-analytics-report-tool tool gives the report of the workspace for a period, get-channel-insights-tool gives the insights of one channel, and list-channel-publications-tool lists its best posts.",
    },
    {
      title: "Ideas and approvals",
      text: "The idea tools add, change and move ideas on the ideas board. The approve-post-tool and reject-post-tool tools decide on the posts that wait for approval.",
    },
  ],
  faq: [
    {
      question: "Is the TryPost MCP server official?",
      answer:
        "Yes. TryPost runs the MCP server at app.trypost.it/mcp/trypost and documents it on docs.trypost.it. TryPost is open source under the AGPL-3.0 license. A self-hosted TryPost has the same server at its own address, followed by /mcp/trypost.",
    },
    {
      question: "How do I connect TryPost?",
      answer:
        "Sign in to your TryPost account through the browser, and choose the workspace that the connection can use. OpenBot keeps the token in encrypted storage. The plugin catalog holds no secret.",
    },
    {
      question: "Does the TryPost MCP server cost anything?",
      answer:
        "On TryPost Cloud, MCP needs an active subscription, from the Socials plan at $19 a month. A self-hosted TryPost has no plans and includes MCP on every install.",
    },
    {
      question: "Can an agent publish without asking?",
      answer:
        "The create-post-tool and publish-post-tool tools can publish a post immediately. Whether the agent asks first depends on its permission mode in OpenBot, so review each post before you approve it.",
    },
    {
      question: "What data does TryPost get?",
      answer:
        "TryPost gets the requests that the agent sends: the text and media of your posts and the questions about your channels. TryPost stores your posts and media. Your workspaces, conversations and files stay on the computer that runs OpenBot.",
    },
  ],
  sources: [
    { label: "TryPost: MCP introduction", url: "https://docs.trypost.it/ai/introduction" },
    { label: "TryPost: MCP tools reference", url: "https://docs.trypost.it/ai/tools-reference" },
    { label: "TryPost: Plans and billing", url: "https://docs.trypost.it/knowledge-base/settings/plans-and-billing" },
    { label: "TryPost: Source", url: "https://github.com/trypostit/trypost" },
    { label: "TryPost: Privacy policy", url: "https://trypost.it/en/privacy" },
  ],
  checkedAt: "2026-11-12",
};
