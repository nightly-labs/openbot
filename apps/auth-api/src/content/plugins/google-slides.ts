import type { PluginGuide } from "./plugin-guide";

// Every statement about Google Slides here is taken from Google's documentation of the Google
// Workspace MCP servers. Each page used is in `sources`. The statements about the sign-in describe
// OpenBot's own Google sign-in app. Check the sources again, and move `checkedAt`, whenever this file
// changes.

export const GOOGLE_SLIDES_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Read presentations",
      text: "The agent reads a presentation, one slide, or the thumbnail image of a slide, with its text, shapes and layout.",
    },
    {
      title: "Summarize and review",
      text: "The agent summarizes a presentation slide by slide, or finds spelling mistakes and text that is not clear.",
    },
    {
      title: "Edit presentations",
      text: "The agent changes a presentation with batch updates: it adds, changes and deletes slides, text, shapes and images, for example to add an agenda slide.",
    },
    {
      title: "Use it with Google Drive",
      text: "The Slides server reads and edits a presentation that the agent already knows. Install Google Drive too, so the agent can find a presentation by its name first.",
    },
  ],
  faq: [
    {
      question: "Is the Slides MCP server official?",
      answer:
        "Yes. Google hosts the Slides MCP server at slidesmcp.googleapis.com and documents it on Google for Developers. It is one of the Google Workspace MCP servers, and it has the same permissions and data controls as your Google account.",
    },
    {
      question: "Does the Google Slides plugin need an API key or Google Cloud setup?",
      answer:
        "No. You click Sign in, choose your Google account, and approve the access on Google's consent page. OpenBot uses its own Google sign-in app, so you do not need a Google Cloud project, an API key or a client ID. OpenBot keeps the tokens in encrypted storage on the computer that runs it and adds the Authorization header itself, so agents never get a token. The exchange of the sign-in code and each token refresh go through OpenBot's Signal service, which adds the sign-in app's secret and stores nothing. Your presentations do not go through OpenBot's servers: they go directly between your computer and Google.",
    },
    {
      question: "What can the agent see and change in Google Slides?",
      answer:
        "The agent can read all the presentations and files that your Google account can open (drive.readonly and presentations.readonly). It can edit all the presentations that your account can edit (presentations), and create files (drive.file). Google's Slides server has no tool that creates or deletes a whole presentation. An edit changes the real presentation; use the version history in Google Slides to go back. To remove the access, disconnect Google Slides in OpenBot.",
    },
    {
      question: "Is the Slides MCP server finished?",
      answer:
        "Google lists the Slides MCP server as a Developer Preview, so its tools and limits can change. Google also warns about indirect prompt injection: a presentation from another person can contain instructions that try to make the agent act for someone else. Check what the agent does after it reads content that you do not trust.",
    },
  ],
  sources: [
    {
      label: "Google: Configure the Google Workspace MCP servers",
      url: "https://developers.google.com/workspace/guides/configure-mcp-servers",
    },
    {
      label: "Google: Configure the Slides MCP server",
      url: "https://developers.google.com/workspace/slides/api/guides/configure-mcp-server",
    },
  ],
  checkedAt: "2026-10-29",
};
