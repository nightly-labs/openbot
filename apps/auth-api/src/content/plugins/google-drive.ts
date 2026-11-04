import type { PluginGuide } from "./plugin-guide";

// Every statement about Google Drive here is taken from Google's documentation of the Google Workspace
// MCP servers. Each page used is in `sources`. The statements about the sign-in describe OpenBot's
// own Google sign-in app. Check the sources again, and move `checkedAt`, whenever this file changes.

export const GOOGLE_DRIVE_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Find files",
      text: "The agent searches your Drive, lists the files that you used recently, and reads file details such as the owner and the last change.",
    },
    {
      title: "Read and summarize files",
      text: "The agent reads and downloads file content, so it can summarize a file or answer questions about it.",
    },
    {
      title: "Check who has access",
      text: "The agent lists the permissions of a file, so you can find files that too many people can open.",
    },
    {
      title: "Create and copy files",
      text: "The agent creates new files and copies any file that it can read. Google's Drive server has no tool that changes, moves or deletes a file.",
    },
  ],
  faq: [
    {
      question: "Is the Drive MCP server official?",
      answer:
        "Yes. Google hosts the Drive MCP server at drivemcp.googleapis.com and documents it on Google for Developers. It is one of the Google Workspace MCP servers, and it has the same permissions and data controls as your Google account.",
    },
    {
      question: "Does the Google Drive plugin need an API key or Google Cloud setup?",
      answer:
        "No. You click Sign in, choose your Google account, and approve the access on Google's consent page. OpenBot uses its own Google sign-in app, so you do not need a Google Cloud project, an API key or a client ID. OpenBot keeps the tokens in encrypted storage on the computer that runs it and adds the Authorization header itself, so agents never get a token. The exchange of the sign-in code and each token refresh go through OpenBot's Signal service, which adds the sign-in app's secret and stores nothing. Your files do not go through OpenBot's servers: they go directly between your computer and Google.",
    },
    {
      question: "What can the agent see and change in Google Drive?",
      answer:
        "The agent can see all the files that your Google account can open (drive.readonly). It can create files (drive.file) and copy any file that it can read (drive). With the drive access, the sign-in token can change all your files, but Google's Drive server has no tool that changes, moves or deletes a file, so the agent cannot do these things. To remove the access, disconnect Google Drive in OpenBot.",
    },
    {
      question: "Is the Drive MCP server finished?",
      answer:
        "Google lists the Drive MCP server as a Developer Preview, so its tools and limits can change. Google also warns about indirect prompt injection: a file from another person can contain instructions that try to make the agent act for someone else. Check what the agent does after it reads content that you do not trust.",
    },
  ],
  sources: [
    {
      label: "Google: Configure the Google Workspace MCP servers",
      url: "https://developers.google.com/workspace/guides/configure-mcp-servers",
    },
    {
      label: "Google: Configure the Drive MCP server",
      url: "https://developers.google.com/workspace/drive/api/guides/configure-mcp-server",
    },
  ],
  checkedAt: "2026-10-29",
};
