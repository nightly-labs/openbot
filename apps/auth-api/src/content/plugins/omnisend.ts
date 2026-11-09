import type { PluginGuide } from "./plugin-guide";

// Every statement about Omnisend here is taken from api-docs.omnisend.com and
// support.omnisend.com. Each page used is in `sources`. Check the sources again, and move
// `checkedAt`, whenever this file changes.

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
      text: "The agent creates, copies and edits campaigns, email content and templates, and sends a test email. It also creates, enables and disables automations. With write access it can send a campaign, so ask it for a draft when you want to check the campaign first.",
    },
    {
      title: "Keep the product catalog current",
      text: "The agent lists, creates, updates and deletes products and product categories, and uploads images. Campaigns and automations can then use the current products.",
    },
  ],
  faq: [
    {
      question: "Is the Omnisend MCP server official?",
      answer:
        "Yes. Omnisend hosts the server at https://mcp.omnisend.com/mcp. It uses Streamable HTTP and OAuth with dynamic client registration.",
    },
    {
      question: "Does the Omnisend plugin need an API key?",
      answer:
        "No. Each user signs in to their own Omnisend account through the browser and selects the access level on the consent screen. OpenBot registers itself with Omnisend, does the sign-in, keeps the tokens in encrypted storage, and adds the Authorization header. The plugin catalog holds no secret. The account needs the Owner, Admin, Manager or Partner role.",
    },
    {
      question: "Can I give the agent read-only access?",
      answer:
        'Yes. Select read-only access on the Omnisend consent screen. A write then fails with "Permission denied". To change the access level, disconnect the app and sign in again.',
    },
    {
      question: "Does it work with more than one brand?",
      answer:
        "One connection works on one brand. Omnisend recommends a separate connection for each brand, so that the agent does not change the wrong brand. Add each extra brand as its own MCP server in the MCP servers settings, as the Omnisend guide shows, and sign in there.",
    },
    {
      question: "What data does Omnisend get?",
      answer:
        "Your workspaces, conversations and files stay on the computer that runs OpenBot. Omnisend gets the requests that the agent sends, such as a report query or a campaign update. The tools work on the brand that you sign in to.",
    },
  ],
  sources: [
    { label: "Omnisend: MCP server", url: "https://api-docs.omnisend.com/reference/mcp-server" },
    {
      label: "Omnisend: Connect Omnisend MCP to AI tools",
      url: "https://support.omnisend.com/en/articles/15096086-connect-omnisend-mcp-to-ai-tools",
    },
  ],
  checkedAt: "2026-11-06",
};
