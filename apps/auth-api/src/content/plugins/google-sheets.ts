import type { PluginGuide } from "./plugin-guide";

// Every statement about Google Sheets here is taken from Google's documentation of the Google Workspace
// MCP servers. Each page used is in `sources`. The statements about the sign-in describe OpenBot's
// own Google sign-in app. Check the sources again, and move `checkedAt`, whenever this file changes.

export const GOOGLE_SHEETS_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Read spreadsheets",
      text: "The agent reads cell values, sheet names and other details of a spreadsheet.",
    },
    {
      title: "Write values and formulas",
      text: "The agent writes values and formulas to cells, for example to add rows from a list or a column with totals.",
    },
    {
      title: "Change the structure",
      text: "The agent inserts rows and columns, and makes other changes to the spreadsheet structure with batch updates.",
    },
    {
      title: "Use it with Google Drive",
      text: "The Sheets server works on a spreadsheet that the agent already knows. Install Google Drive too, so the agent can find a spreadsheet by its name first.",
    },
  ],
  faq: [
    {
      question: "Is the Sheets MCP server official?",
      answer:
        "Yes. Google hosts the Sheets MCP server at sheetsmcp.googleapis.com and documents it on Google for Developers. It is one of the Google Workspace MCP servers, and it has the same permissions and data controls as your Google account.",
    },
    {
      question: "Does the Google Sheets plugin need an API key or Google Cloud setup?",
      answer:
        "No. You click Sign in, choose your Google account, and approve the access on Google's consent page. OpenBot uses its own Google sign-in app, so you do not need a Google Cloud project, an API key or a client ID. OpenBot keeps the tokens in encrypted storage on the computer that runs it and adds the Authorization header itself, so agents never get a token. The exchange of the sign-in code and each token refresh go through OpenBot's Signal service, which adds the sign-in app's secret and stores nothing. Your spreadsheets do not go through OpenBot's servers: they go directly between your computer and Google.",
    },
    {
      question: "What can the agent see and change in Google Sheets?",
      answer:
        "The agent can read all the spreadsheets and files that your Google account can open (drive.readonly and spreadsheets.readonly). It can change all the spreadsheets that your account can edit (spreadsheets), and create files (drive.file). A change goes into the real spreadsheet; use the version history in Google Sheets to go back. To remove the access, disconnect Google Sheets in OpenBot.",
    },
    {
      question: "Is the Sheets MCP server finished?",
      answer:
        "Google lists the Sheets MCP server as a Developer Preview, so its tools and limits can change. Google also warns about indirect prompt injection: a spreadsheet from another person can contain instructions that try to make the agent act for someone else. Check what the agent does after it reads content that you do not trust.",
    },
  ],
  sources: [
    {
      label: "Google: Configure the Google Workspace MCP servers",
      url: "https://developers.google.com/workspace/guides/configure-mcp-servers",
    },
    {
      label: "Google: Configure the Sheets MCP server",
      url: "https://developers.google.com/workspace/sheets/api/guides/configure-mcp-server",
    },
  ],
  checkedAt: "2026-10-29",
};
