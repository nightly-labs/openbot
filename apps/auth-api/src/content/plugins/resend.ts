import type { PluginGuide } from "./plugin-guide";

// Every statement about Resend here is taken from resend.com and Resend's resend-mcp
// repository. Each page used is in `sources`. Check the sources again, and move
// `checkedAt`, whenever this file changes.

export const RESEND_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Send and schedule email",
      text: "The agent sends one email or a batch of emails through Resend, with attachments when you need them. It can also schedule an email for a later time. Before the send, it can change that time or cancel the email.",
    },
    {
      title: "Check a delivery",
      text: 'The agent finds a sent email and reads its details. The last_event field shows the latest status, for example "delivered". For more detail, the agent lists and inspects the API request logs, with the full request and response bodies.',
    },
    {
      title: "Run a broadcast",
      text: "The agent creates, updates and sends broadcast campaigns. It also adds, updates and removes contacts, and manages contact properties, segments and topics. Use it to prepare a campaign and check the contacts before you send.",
    },
    {
      title: "Set up domains and inbound mail",
      text: "The agent adds a sender domain to Resend and starts its verification. It creates webhooks that tell your app about email events. It also lists and reads inbound emails, and downloads their attachments.",
    },
  ],
  faq: [
    {
      question: "Is the Resend MCP server official?",
      answer:
        "Yes. Resend calls it its official MCP server. The code is open source and is on npm as resend-mcp. The OpenBot listing runs this package as a local server. Resend also hosts a remote server that runs the same code.",
    },
    {
      question: "Does the Resend plugin need an API key?",
      answer:
        "Yes. Make an API key in the Resend dashboard, then type it in the OpenBot connect dialog. OpenBot gives the key to the local server as the RESEND_API_KEY environment variable. The plugin catalog holds no secret. Resend also tells you to verify your domain before you use the local server.",
    },
    {
      question: "What data does Resend get?",
      answer:
        "Your workspaces, conversations and files stay on the computer that runs OpenBot. Resend gets the requests that the agent sends, for example the text of an email, a contact to add or a domain to verify. These requests use your Resend account and your API key.",
    },
    {
      question: "Does the Resend plugin cost anything?",
      answer:
        "Installing the plugin in OpenBot is free. Resend has a free transactional plan with 3,000 emails per month and a limit of 100 emails per day. The paid plans are Pro, Scale and Enterprise. Your Resend plan limits apply to the email that the agent sends.",
    },
  ],
  sources: [
    { label: "Resend: MCP Server", url: "https://resend.com/docs/mcp-server" },
    { label: "Resend changelog: Official Resend MCP Server", url: "https://resend.com/changelog/mcp" },
    { label: "Resend: resend-mcp repository", url: "https://github.com/resend/resend-mcp" },
    {
      label: "Resend API: Retrieve Email",
      url: "https://resend.com/docs/api-reference/emails/retrieve-email",
    },
    { label: "Resend: Pricing", url: "https://resend.com/pricing" },
  ],
  checkedAt: "2026-10-23",
};
