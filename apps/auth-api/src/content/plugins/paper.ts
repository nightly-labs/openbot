import type { PluginGuide } from "./plugin-guide";

// Every statement about Paper here is taken from paper.design. Each page used is in
// `sources`. Check the sources again, and move `checkedAt`, whenever this file changes.

export const PAPER_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Turn a frame into code",
      text: "Select a frame in Paper, and the agent examines it with read-only Paper tools. Paper is built on HTML and CSS, so the agent can translate the design into components for your codebase. Paper shows visual feedback while the agent examines the frame.",
    },
    {
      title: "Build layouts in Paper",
      text: "The Paper MCP server can also write to the open file. The agent can generate a layout, make color tokens and a swatch, or add responsive breakpoints from the frames you selected. Review each write before you approve it, because it changes the file.",
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
      question: "Does the Paper MCP server need an API key?",
      answer:
        "No. Paper Desktop starts the MCP server in the background and installs the Paper CLI. OpenBot starts that CLI as a local relay to the open file. Install Paper Desktop, open it once, and open a file before you start.",
    },
    {
      question: "Which Paper file does the agent change?",
      answer:
        "The Paper MCP server works on the file that is open in Paper Desktop. If changes do not appear, make sure that the correct file is open. To check, ask the agent to call the get_basic_info tool, which shows the file it sees.",
    },
    {
      question: "Does Paper cost anything?",
      answer:
        "Paper has a Free plan at $0 with 100 MCP tool calls each week. The Pro plan costs $16 for each editor each month with yearly billing, and gives 1M MCP tool calls each week. Each read and each write is a tool call.",
    },
    {
      question: "The agent says it has no Paper tools. What do I do?",
      answer:
        "Paper says that long agent sessions are the most common cause of problems. Start a new thread to make a new MCP connection. Also make sure that Paper Desktop is open with a file.",
    },
  ],
  sources: [
    { label: "Paper: MCP server", url: "https://paper.design/docs/mcp" },
    { label: "Paper: support", url: "https://paper.design/docs/support" },
    { label: "Paper pricing", url: "https://paper.design/pricing" },
  ],
  checkedAt: "2026-10-23",
};
