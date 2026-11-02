import type { PluginGuide } from "./plugin-guide";

// Every statement about Canva here is taken from canva.dev and canva.com. Each page used is in
// `sources`. Check the sources again, and move `checkedAt`, whenever this file changes.

export const CANVA_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Draft a design from text",
      text: "Canva's MCP server can generate designs from text. The generate-design and create-design-from-candidate tools make a new design, and generate-image makes an image. Some of these AI actions use your monthly Canva AI credits.",
    },
    {
      title: "Edit an existing design",
      text: "The agent opens an editing transaction with start-editing-transaction and makes changes with perform-editing-operations. Then commit-editing-transaction saves the changes, or cancel-editing-transaction drops them. The get-design-thumbnail tool shows the result. The agent can edit only the designs that your account can edit.",
    },
    {
      title: "Resize and export for a channel",
      text: "The resize-design tool resizes a design for a different channel. The get-export-formats tool lists the formats of a design, and export-design exports it, also as video. Free plans get standard export quality, and resizing needs Canva Pro and above, with a limited trial on Free.",
    },
    {
      title: "Organize the design library",
      text: "The search-designs and search-folders tools find your work. The create-folder and move-item-to-folder tools put designs in order. The upload-asset-from-url tool adds an asset, and the comment-on-design and reply-to-comment tools leave feedback on a design.",
    },
  ],
  faq: [
    {
      question: "Is the Canva MCP server official?",
      answer:
        "Yes. Canva hosts a remote MCP server that gives an AI assistant access to Canva's design APIs. The OpenBot listing connects to this server. It is not the Canva Dev MCP server, which helps developers build Canva apps.",
    },
    {
      question: "How does the Canva plugin sign in?",
      answer:
        "Canva requires each user to sign in individually with OAuth. OpenBot does the sign-in itself, keeps the tokens in encrypted storage, and adds the Authorization header. You do not need an API key. The agent can do only what your Canva account can do.",
    },
    {
      question: "Which Canva plan does the plugin need?",
      answer:
        "Canva says that its AI connector is available for all Canva accounts, including Canva Free and Canva Education. Resizing, autofill, brand kits and brand templates need Canva Pro and above. On a Canva team, an admin may need to turn on the connector first.",
    },
    {
      question: "Does it cost anything?",
      answer:
        "Installing the plugin is free. Some AI actions use your monthly Canva AI credits, and they can pause until the credits refresh. Canva also limits requests to 300 per minute per user across all MCP clients, with lower limits for some tools.",
    },
  ],
  sources: [
    { label: "Canva: Model Context Protocol (MCP)", url: "https://canva.dev/docs/mcp/" },
    { label: "Canva MCP: Tools and rate limits", url: "https://canva.dev/docs/apps/mcp/tools/" },
    { label: "Canva MCP: Access and permissions", url: "https://canva.dev/docs/apps/mcp/access/" },
    { label: "Canva Help: Set up the Canva AI Connector", url: "https://www.canva.com/help/mcp-agent-setup/" },
  ],
  checkedAt: "2026-10-23",
};
