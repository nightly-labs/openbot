import type { PluginGuide } from "./plugin-guide";

// Every statement about Higgsfield here is taken from higgsfield.ai. Each page used is in
// `sources`. Check the sources again, and move `checkedAt`, whenever this file changes.

export const HIGGSFIELD_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Generate images and videos",
      text: "The agent generates images and videos with Higgsfield models such as Seedance, Kling, Veo and MiniMax Hailuo. Results show in the chat and are saved to your Higgsfield Assets.",
    },
    {
      title: "Characters, audio and video edits",
      text: "The agent works with Soul characters and Higgsfield Audio. It can also use Marketing Studio, Ad Multiplier and Genjutsu, which does Motion Transfer, Object Swap and Restyle on a video.",
    },
    {
      title: "Check credits and assets",
      text: "The agent reads your credit balance before it starts a large job, and browses your Asset Library to find earlier results.",
    },
  ],
  faq: [
    {
      question: "Is the Higgsfield MCP server official?",
      answer:
        "Yes. Higgsfield hosts the MCP server at mcp.higgsfield.ai/mcp. It is not the Higgsfield API, which is a separate developer product with API keys.",
    },
    {
      question: "Does the Higgsfield plugin need an API key?",
      answer:
        "No. You sign in to your own Higgsfield account in the browser and allow access. OpenBot keeps the tokens in encrypted storage and adds the Authorization header. The agent does not see your password.",
    },
    {
      question: "Does it cost anything?",
      answer:
        "Installing the plugin is free, but you need a Higgsfield subscription. Every generation through MCP uses credits of your account at standard rates, also on a plan with unlimited models. Free generations and unlimited models work only on higgsfield.ai. The connection has no spending limit, so check your credit balance before a large job.",
    },
    {
      question: "What does Higgsfield receive?",
      answer:
        "Higgsfield gets the prompts, images and videos that the agent sends to it. You are responsible for what an agent generates through your account. Your workspaces, conversations and files stay on the computer that runs OpenBot.",
    },
  ],
  sources: [
    {
      label: "Higgsfield: What Is Higgsfield MCP",
      url: "https://higgsfield.ai/creator-hub/help-center/integrations/what-is-higgsfield-mcp",
    },
    {
      label: "Higgsfield: Generate AI videos in Claude with the Higgsfield MCP connector",
      url: "https://higgsfield.ai/blog/Generate-AI-Videos-From-Claude-with-Higgsfield-MCP",
    },
  ],
  checkedAt: "2026-11-05",
};
