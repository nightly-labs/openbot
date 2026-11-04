import type { PluginGuide } from "./plugin-guide";

// Every statement about Gmail here is taken from Google's documentation of the Google Workspace
// MCP servers. Each page used is in `sources`. The statements about the sign-in describe OpenBot's
// own Google sign-in app. Check the sources again, and move `checkedAt`, whenever this file changes.

export const GMAIL_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Find email",
      text: "The agent searches your threads with Gmail search terms, such as a sender, a subject or a date, and reads whole threads and single messages.",
    },
    {
      title: "Summarize your inbox",
      text: "The agent reads unread or recent threads and tells you which ones need an answer, which ones are receipts and which ones you can skip.",
    },
    {
      title: "Write drafts",
      text: "The agent writes a reply or a new email as a draft in your Drafts folder. You read it, change it if necessary, and send it from Gmail.",
    },
    {
      title: "Organize email",
      text: "The agent lists and creates labels, adds labels to email and removes them, moves email to the trash and back, and marks email as spam. It cannot delete email permanently.",
    },
  ],
  faq: [
    {
      question: "Is the Gmail MCP server official?",
      answer:
        "Yes. Google hosts the Gmail MCP server at gmailmcp.googleapis.com and documents it on Google for Developers. It is one of the Google Workspace MCP servers, and it has the same permissions and data controls as your Google account.",
    },
    {
      question: "Does the Gmail plugin need an API key or Google Cloud setup?",
      answer:
        "No. You click Sign in, choose your Google account, and approve the access on Google's consent page. OpenBot uses its own Google sign-in app, so you do not need a Google Cloud project, an API key or a client ID. OpenBot keeps the tokens in encrypted storage on the computer that runs it and adds the Authorization header itself, so agents never get a token. The exchange of the sign-in code and each token refresh go through OpenBot's Signal service, which adds the sign-in app's secret and stores nothing. Your email messages do not go through OpenBot's servers: they go directly between your computer and Google.",
    },
    {
      question: "What can the agent see and change in Gmail?",
      answer:
        "The agent can read all the email in your account (gmail.readonly) and write drafts (gmail.compose). It can also add and remove labels, create labels, move email to the trash and back, and mark email as spam (gmail.modify). The server has no tool that sends email or deletes email permanently, so the agent cannot do these things. To remove the access, disconnect Gmail in OpenBot.",
    },
    {
      question: "Is the Gmail MCP server finished?",
      answer:
        "Google lists the Gmail MCP server as a Developer Preview, so its tools and limits can change. Google also warns about indirect prompt injection: an email from another person can contain instructions that try to make the agent act for someone else. Check what the agent does after it reads content that you do not trust.",
    },
  ],
  sources: [
    {
      label: "Google: Configure the Google Workspace MCP servers",
      url: "https://developers.google.com/workspace/guides/configure-mcp-servers",
    },
    {
      label: "Google: Configure the Gmail MCP server",
      url: "https://developers.google.com/workspace/gmail/api/guides/configure-mcp-server",
    },
    {
      label: "Google: Gmail MCP tool label_message",
      url: "https://developers.google.com/workspace/gmail/api/reference/mcp/tools_list/label_message",
    },
  ],
  checkedAt: "2026-10-29",
};
