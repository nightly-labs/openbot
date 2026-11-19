import type { PluginGuide } from "./plugin-guide";

export const OMNISEND_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Read campaign results",
      text: "The agent reads campaign reports by send date or by event date, and reports for forms and form A/B tests. Use it to compare campaigns or to find the form that brings the most contacts.",
    },
    {
      title: "Work with contacts and segments",
      text: "The agent finds contacts, reads one contact, and creates or updates contacts. It adds and removes tags in a batch. It lists segments, reads their statistics, and creates or changes a segment.",
    },
    {
      title: "Prepare campaigns and automations",
      text: "The agent creates, copies and edits campaigns, email content and templates, and sends a test email. It also creates, enables and disables automations. When the key allows it, the agent can send a campaign, so ask it for a draft when you want to check the campaign first.",
    },
    {
      title: "Keep the product catalog current",
      text: "The agent lists, creates, updates and deletes products and product categories, and uploads images. Campaigns and automations can then use the current products.",
    },
  ],
  faq: [
    {
      question: "Is the Omnisend MCP server official?",
      answer: "Yes. Omnisend hosts the server at https://mcp.omnisend.com/mcp. It uses Streamable HTTP.",
    },
    {
      question: "Does the Omnisend plugin need an API key?",
      answer:
        "Yes. Create an API key in Omnisend at app.omnisend.com/integrations/api-keys, then enter it when you connect the app. OpenBot keeps the key in encrypted storage and sends it in the X-Api-Key header. The plugin catalog holds no secret. Omnisend's browser sign-in does not accept OpenBot yet.",
    },
    {
      question: "What can the agent do with the key?",
      answer:
        "The agent can do what the API key allows in Omnisend, which can include sending campaigns and deleting data. To stop the access, delete the key in Omnisend.",
    },
    {
      question: "Does it work with more than one brand?",
      answer:
        "One key works on one brand. Omnisend recommends a separate connection for each brand, so that the agent does not change the wrong brand. Add each extra brand as its own MCP server in the MCP servers settings, with the API key of that brand.",
    },
    {
      question: "What data does Omnisend get?",
      answer:
        "Your workspaces, conversations and files stay on the computer that runs OpenBot. Omnisend gets the requests that the agent sends, such as a report query or a campaign update. The tools work on the brand of the API key.",
    },
  ],
  sources: [
    { label: "Omnisend: MCP server", url: "https://api-docs.omnisend.com/reference/mcp-server" },
    { label: "Omnisend: API authentication", url: "https://api-docs.omnisend.com/v3/reference/authentication" },
    {
      label: "Omnisend: Connect Omnisend MCP to AI tools",
      url: "https://support.omnisend.com/en/articles/15096086-connect-omnisend-mcp-to-ai-tools",
    },
  ],
  checkedAt: "2026-11-16",
};
