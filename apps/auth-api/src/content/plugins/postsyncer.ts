import type { PluginGuide } from "./plugin-guide";

export const POSTSYNCER_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "See your workspaces and accounts",
      text: "The list-workspaces tool lists your PostSyncer workspaces, and list-accounts lists the social media accounts that are connected to each one. The get-brand tool gives the brand voice of a workspace, so the agent can read it before it writes. The create-account-connect-link tool makes a link that connects a new account.",
    },
    {
      title: "Draft, schedule and publish posts",
      text: "The create-post tool saves a draft, schedules a post for a date, or publishes it now, on one or more accounts, with the settings of each network. The list-posts, update-post and delete-post tools list, change and remove posts, and retry-post sends a failed post again.",
    },
    {
      title: "Add media",
      text: "The upload-media-from-url tool adds an image or a video from a link, and upload-media-file adds a file. The list-media tool lists the media library of a workspace.",
    },
    {
      title: "Reply to comments and reviews",
      text: "The sync-comments-from-platforms and list-comments tools read the comments on your posts, and create-comment and hide-comment answer or hide them. The sync-reviews, list-reviews and reply-to-review tools read and answer the reviews of a Google Business Profile.",
    },
    {
      title: "Read analytics",
      text: "The get-analytics-summary, get-analytics-workspace, get-analytics-account and get-analytics-post tools give the numbers of a workspace, an account or a post.",
    },
  ],
  faq: [
    {
      question: "Is the PostSyncer MCP server official?",
      answer:
        "Yes. PostSyncer runs the MCP server at postsyncer.com/mcp and documents it on docs.postsyncer.com. The same server works in Claude, ChatGPT, Cursor, Codex and other MCP clients.",
    },
    {
      question: "How do I connect PostSyncer?",
      answer:
        "Sign in to your PostSyncer account through the browser and approve the connection. The connection can use every workspace of your account. On a computer where no one can sign in, paste an API key from Settings › API in PostSyncer instead. A key can do only what its permissions allow. OpenBot keeps the token in encrypted storage. The plugin catalog holds no secret.",
    },
    {
      question: "Does the PostSyncer MCP server cost anything?",
      answer:
        "MCP works on every PostSyncer plan, the free plan included. Campaigns and labels need a paid plan. On the free plan, analytics shows the last 7 days.",
    },
    {
      question: "Can an agent publish without asking?",
      answer:
        "The create-post tool can publish a post immediately. Whether the agent asks first depends on its permission mode in OpenBot, so review each post before you approve it. In a team workspace on a paid plan, the posts of a member whose role cannot publish wait for approval.",
    },
    {
      question: "What data does PostSyncer get?",
      answer:
        "PostSyncer gets the requests that the agent sends: the text and media of your posts and the questions about your accounts. PostSyncer stores your posts and media, and publishes them to the networks that you choose. Your OpenBot conversations and files stay on the computer that runs OpenBot.",
    },
  ],
  sources: [
    { label: "PostSyncer: MCP overview", url: "https://docs.postsyncer.com/mcp/overview" },
    { label: "PostSyncer: MCP tools reference", url: "https://docs.postsyncer.com/mcp/tools-reference" },
    { label: "PostSyncer: API keys", url: "https://docs.postsyncer.com/essentials/authentication" },
    { label: "PostSyncer: Pricing", url: "https://postsyncer.com/pricing" },
    { label: "PostSyncer: Privacy policy", url: "https://postsyncer.com/privacy-policy" },
  ],
  checkedAt: "2026-11-27",
};
