import type { PluginGuide } from "./plugin-guide";

// Every statement about Sunra here is taken from sunra.ai and the metadata of its MCP server.
// Each page used is in `sources`. Check the sources again, and move `checkedAt`, whenever this
// file changes.

export const SUNRA_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Generate images",
      text: "The agent makes images with models such as Nano Banana Pro, GPT Image 2, Seedream 5.0 Pro, FLUX 3, Ideogram 4.5 and Midjourney V8.1. It can read the input schema of a model before it starts.",
    },
    {
      title: "Make videos, audio and 3D models",
      text: "The agent makes videos with models such as Seedance 2.0, Kling 4.0, Veo 3.1 and Wan 3.0, and also makes audio and 3D models. Video models need an active Sunra plan.",
    },
    {
      title: "Check credits, projects and results",
      text: "The agent reads your credit balance, creates and lists Sunra projects, and reads the status and results of each job.",
    },
  ],
  faq: [
    {
      question: "Is the Sunra MCP server official?",
      answer: "Yes. Sunra hosts the MCP server at mcp.sunra.ai.",
    },
    {
      question: "Does the Sunra plugin need an API key?",
      answer:
        "No. You sign in to your own Sunra account in the browser and allow access. The server uses OAuth 2.1 with PKCE. OpenBot keeps the tokens in encrypted storage and adds the Authorization header. The agent does not see your password.",
    },
    {
      question: "Does it cost anything?",
      answer:
        "Installing the plugin is free. Generations use Sunra credits. Sunra gives free daily credits, and the web plans are Basic (1,200 credits a month), Pro (from 3,500) and Creator (from 17,000). Only subscribers can buy top-ups. Video models need an active plan. See sunra.ai/pricing for current prices.",
    },
    {
      question: "When are credits spent?",
      answer:
        "When the agent asks for a generation, Sunra first stages the work and returns a quote with the estimated credits. Credits are spent only when the agent confirms that quote, or when it asks Sunra to confirm at once. Ask the agent to tell you the cost first.",
    },
    {
      question: "Which Sunra workspace pays?",
      answer:
        "The connection pays from the workspace that you selected when you connected it: Personal or a Team. To change it, ask the agent to select another workspace. The agent does not switch it on its own.",
    },
    {
      question: "What does Sunra receive?",
      answer:
        "Sunra gets the prompts, images and other files that the agent sends to it. Your workspaces, conversations and files stay on the computer that runs OpenBot.",
    },
  ],
  sources: [
    { label: "Sunra", url: "https://sunra.ai" },
    { label: "Sunra: Pricing", url: "https://sunra.ai/pricing" },
    {
      label: "Sunra MCP server: OAuth authorization server metadata",
      url: "https://mcp.sunra.ai/.well-known/oauth-authorization-server",
    },
  ],
  checkedAt: "2026-11-12",
};
