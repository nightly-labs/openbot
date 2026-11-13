import type { PluginGuide } from "./plugin-guide";

// Every statement about Postiz here is taken from postiz.com and docs.postiz.com. Each page used is
// in `sources`. Check the sources again, and move `checkedAt`, whenever this file changes.

export const POSTIZ_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "See your channels",
      text: "The integrationList tool lists the social media channels that are connected to your Postiz workspace, and groupList lists your customer groups. The integrationSchema tool gives the posting rules, character limits and settings of each platform.",
    },
    {
      title: "Draft, schedule and publish posts",
      text: "The schedulePostTool tool makes a draft, schedules a post for a date, or publishes it now. The postsListTool tool lists the posts between two dates, and postSettingsTool changes the settings of a post that is not published yet.",
    },
    {
      title: "Add media",
      text: "The uploadFromUrlTool tool puts a public image or video into your media library, and mediaListTool lists the media that is there. The generateImageTool and generateVideoTool tools make AI images and videos for a post.",
    },
    {
      title: "Clip YouTube videos",
      text: "The clippingTool tool makes short clips from a YouTube video. It makes draft posts only, and schedules or publishes nothing. The clippingStatusTool tool shows the progress.",
    },
  ],
  faq: [
    {
      question: "Is the Postiz MCP server official?",
      answer:
        "Yes. Postiz runs the MCP server at mcp.postiz.com and documents it on docs.postiz.com. Postiz is open source under the AGPL-3.0 license. A self-hosted Postiz has the same server at its backend address, followed by /mcp.",
    },
    {
      question: "How do I connect Postiz?",
      answer:
        "Sign in to your Postiz account through the browser. OpenBot keeps the token in encrypted storage. You can also type the API key from Settings › Developers in Postiz in the connect dialog. OpenBot sends it as a bearer token in the Authorization header. The plugin catalog holds no secret.",
    },
    {
      question: "Does the Postiz MCP server cost anything?",
      answer:
        "The MCP server is included in all Postiz cloud plans, from Standard at $29 a month. Postiz has no free plan, but most new organizations get a 7-day trial. A self-hosted Postiz includes it on every install.",
    },
    {
      question: "Can an agent publish without asking?",
      answer:
        "The schedulePostTool tool can publish a post immediately. Whether the agent asks first depends on its permission mode in OpenBot, so review each post before you approve it.",
    },
    {
      question: "What data does Postiz get?",
      answer:
        "Postiz gets the requests that the agent sends: the text and media of your posts and the questions about your channels. Postiz stores your posts and media and logs the API calls. Your workspaces, conversations and files stay on the computer that runs OpenBot.",
    },
  ],
  sources: [
    { label: "Postiz: MCP setup", url: "https://docs.postiz.com/mcp/setup" },
    { label: "Postiz: MCP tools", url: "https://docs.postiz.com/mcp/tools" },
    {
      label: "Postiz: MCP server source",
      url: "https://github.com/gitroomhq/postiz-app/blob/main/libraries/nestjs-libraries/src/chat/start.mcp.ts",
    },
    { label: "Postiz: Developers settings", url: "https://docs.postiz.com/general/settings/developers" },
    { label: "Postiz: Plans", url: "https://docs.postiz.com/cloud/plans" },
    { label: "Postiz: Privacy policy", url: "https://postiz.com/privacy" },
  ],
  checkedAt: "2026-11-10",
};
