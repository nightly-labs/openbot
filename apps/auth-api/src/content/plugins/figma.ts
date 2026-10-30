import type { PluginGuide } from "./plugin-guide";

// Every statement about Figma here is taken from developers.figma.com and figma.com. Each page
// used is in `sources`. Check the sources again, and move `checkedAt`, whenever this file changes.

export const FIGMA_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Build a screen from a frame",
      text: "The get_design_context tool gets the design context and code for a layer or a selection. For a large selection, the get_metadata tool first gives a short XML outline. The agent can then ask for the parts it needs and write the screen in your project.",
    },
    {
      title: "Read the design tokens",
      text: "The get_variable_defs tool lists the variables and styles that a selection uses, such as colors, spacing and type. The get_code_connect_map tool returns the Code Connect mappings, so the agent uses your existing code components.",
    },
    {
      title: "Check the result visually",
      text: "The get_screenshot tool takes a screenshot of a selection. The agent can compare the design with the screen that it built, and find differences in layout or color before you review the change.",
    },
    {
      title: "Use FigJam and motion",
      text: "The get_figjam tool converts a FigJam diagram to XML, so an agent can read a flow or an architecture sketch. The get_motion_context tool gets keyframe animation data and code snippets for an animated layer.",
    },
  ],
  faq: [
    {
      question: "Does the Figma MCP server need an API key?",
      answer:
        "No. OpenBot connects to the desktop MCP server in the Figma desktop app on your computer. Sign in to the app, open a design file, and turn on the desktop MCP server. Keep Figma open while agents use it.",
    },
    {
      question: "Which Figma plan does the plugin need?",
      answer:
        "The desktop server needs a Dev or Full seat on a Professional, Education, Organization, Government or Enterprise plan. Figma limits tool calls by seat and plan. For example, a Dev or Full seat on the Professional plan gets up to 200 calls a day and 10 a minute.",
    },
    {
      question: "Can an agent edit my Figma designs?",
      answer:
        "Not with this plugin. Figma says that the desktop server does not support writing to the canvas. Write to canvas works only with Figma's remote server. The OpenBot listing reads layout, code context, variables and screenshots.",
    },
    {
      question: "Is the Figma MCP server official?",
      answer:
        "Yes. Figma makes the MCP server. The desktop server runs locally in the Figma desktop app. Figma also has a remote server, which it recommends for most users, but this OpenBot listing uses the desktop server.",
    },
  ],
  sources: [
    { label: "Figma MCP server", url: "https://developers.figma.com/docs/figma-mcp-server/" },
    {
      label: "Figma MCP server: tools and prompts",
      url: "https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/",
    },
    {
      label: "Figma MCP server: desktop server installation",
      url: "https://developers.figma.com/docs/figma-mcp-server/local-server-installation/",
    },
    {
      label: "Figma MCP server: plans, access and rate limits",
      url: "https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/",
    },
  ],
  checkedAt: "2026-10-23",
};
