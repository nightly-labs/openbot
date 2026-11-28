import type { PluginGuide } from "./plugin-guide";

export const PAPER_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Turn a frame into code",
      text: "Select a frame in Paper, and the agent examines it with read-only Paper tools. Paper is built on HTML and CSS, so the agent can translate the design into components for your codebase. Paper shows visual feedback while the agent examines the frame.",
    },
    {
      title: "Build layouts in Paper",
      text: "The Paper MCP server can also write to your file. The agent can generate a layout, make color tokens and a swatch, or add responsive breakpoints from the frames you selected. Review each write before you approve it, because it changes the file.",
    },
    {
      title: "Bring a design system from Figma",
      text: "With the Figma MCP server also connected, the agent can read the colors and text styles of the open Figma file. It then makes a design system sticker sheet in Paper that matches the Figma file. Select a Figma element that has a variable or style first.",
    },
    {
      title: "Fill a design with real content",
      text: "The agent can pull real content into a design from another MCP server, such as Notion. For example, select a testimonial frame in Paper. Then ask the agent to sync it with the entries of a Notion database. OpenBot also lists a Notion plugin.",
    },
  ],
  faq: [
    {
      question: "Does the Paper MCP server need an API key or Paper Desktop?",
      answer:
        "No. OpenBot connects to the remote Paper MCP server, and you sign in with your Paper account. You do not need Paper Desktop, also when your agents run on a server. Paper calls the remote server early access.",
    },
    {
      question: "Which Paper file does the agent change?",
      answer:
        "The agent works on the Paper files of the account that you signed in with. If changes do not appear in the file that you expect, ask the agent which file it sees.",
    },
    {
      question: "Does Paper cost anything?",
      answer:
        "Paper has a Free plan at $0 with 100 MCP tool calls each week. The Pro plan costs $16 for each editor each month with yearly billing, and gives 1M MCP tool calls each week. Each read and each write is a tool call.",
    },
    {
      question: "The agent says it has no Paper tools. What do I do?",
      answer:
        "Paper says that long agent sessions are the most common cause of problems. Start a new thread to make a new MCP connection. If Paper says that your account setup is incomplete, complete the setup at app.paper.design, then sign in to Paper again in OpenBot.",
    },
  ],
  sources: [
    { label: "Paper: MCP server", url: "https://paper.design/docs/mcp" },
    { label: "Paper: support", url: "https://paper.design/docs/support" },
    { label: "Paper pricing", url: "https://paper.design/pricing" },
  ],
  checkedAt: "2026-11-28",
};
