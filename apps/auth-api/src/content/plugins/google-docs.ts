import type { PluginGuide } from "./plugin-guide";

// Every statement about Google Docs here is taken from Google's documentation of the Google Workspace
// MCP servers. Each page used is in `sources`. The statements about the sign-in describe OpenBot's
// own Google sign-in app. Check the sources again, and move `checkedAt`, whenever this file changes.

export const GOOGLE_DOCS_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Read documents",
      text: "The agent reads the text and the structure of a document, such as headings, lists and tables.",
    },
    {
      title: "Summarize and review",
      text: "The agent summarizes a document, lists its open questions, or finds sentences that are not clear.",
    },
    {
      title: "Edit documents",
      text: "The agent changes the text, the styles and the structure of a document with batch updates, for example to add a summary at the top.",
    },
    {
      title: "Use it with Google Drive",
      text: "The Docs server reads and edits a document that the agent already knows. Install Google Drive too, so the agent can find a document by its name first.",
    },
  ],
  faq: [
    {
      question: "Is the Docs MCP server official?",
      answer:
        "Yes. Google hosts the Docs MCP server at docsmcp.googleapis.com and documents it on Google for Developers. It is one of the Google Workspace MCP servers, and it has the same permissions and data controls as your Google account.",
    },
    {
      question: "Does the Google Docs plugin need an API key or Google Cloud setup?",
      answer:
        "No. You click Sign in, choose your Google account, and approve the access on Google's consent page. OpenBot uses its own Google sign-in app, so you do not need a Google Cloud project, an API key or a client ID. OpenBot keeps the tokens in encrypted storage on the computer that runs it and adds the Authorization header itself, so agents never get a token. The exchange of the sign-in code and each token refresh go through OpenBot's Signal service, which adds the sign-in app's secret and stores nothing. Your documents do not go through OpenBot's servers: they go directly between your computer and Google.",
    },
    {
      question: "What can the agent see and change in Google Docs?",
      answer:
        "The agent can read all the documents and files that your Google account can open (drive.readonly and documents.readonly). It can edit all the documents that your account can edit (documents), and create files (drive.file). An edit changes the real document; use the version history in Google Docs to go back. To remove the access, disconnect Google Docs in OpenBot.",
    },
    {
      question: "Is the Docs MCP server finished?",
      answer:
        "Google lists the Docs MCP server as a Developer Preview, so its tools and limits can change. Google also warns about indirect prompt injection: a document from another person can contain instructions that try to make the agent act for someone else. Check what the agent does after it reads content that you do not trust.",
    },
  ],
  sources: [
    {
      label: "Google: Configure the Google Workspace MCP servers",
      url: "https://developers.google.com/workspace/guides/configure-mcp-servers",
    },
    {
      label: "Google: Configure the Docs MCP server",
      url: "https://developers.google.com/workspace/docs/api/guides/configure-mcp-server",
    },
  ],
  checkedAt: "2026-10-29",
};
