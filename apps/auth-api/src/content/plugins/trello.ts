import type { PluginGuide } from "./plugin-guide";

// Every statement about Trello here is taken from Trello's help center and Atlassian's
// trello-mcp-server repository. Each page used is in `sources`. Check the sources again, and move
// `checkedAt`, whenever this file changes.

export const TRELLO_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Find cards and boards",
      text: "The agent searches cards and boards by keyword, and reads boards, lists, cards, checklists, comments and the activity history. It can tell you what is in progress, what is late, and which cards are assigned to you.",
    },
    {
      title: "Add and update cards",
      text: "The agent creates cards and checklists, updates them, adds comments, attaches web links, and attaches or detaches labels and card members. It can turn meeting notes into cards on a board.",
    },
    {
      title: "Move work along",
      text: "The agent moves cards and lists, marks cards done, and archives cards and lists. It can also create a new board.",
    },
    {
      title: "Plan your day",
      text: "The agent reads and adds cards in your Trello Inbox, reads your Planner events, and links cards to events. Planner events can come from a Google or Outlook calendar that you connected to Trello.",
    },
  ],
  faq: [
    {
      question: "Is the Trello MCP server official?",
      answer:
        "Yes. Atlassian hosts the Trello MCP server at mcp.trello.com and documents it in the Trello help center. It is a separate server from the Atlassian Rovo MCP server. Trello says the server is in active development, so more tools can come later.",
    },
    {
      question: "Does the Trello plugin need an API key?",
      answer:
        "No. Trello does not support API tokens for MCP connections. You sign in to your own Trello account in the browser, choose the workspaces on the consent screen, and approve read, write and search access. OpenBot does the sign-in itself, keeps the tokens in encrypted storage, and adds the Authorization header. The plugin catalog holds no secret.",
    },
    {
      question: "What can the agent see and change in Trello?",
      answer:
        "The agent can use only the workspaces that you approve, and it has the same permissions as your Trello account in them. It can create, change, move and archive cards and lists, but it cannot delete anything permanently. It cannot upload local files: attachments must be web links. To change the access later, disconnect Trello and connect it again.",
    },
    {
      question: "What data does Trello get, and what can an admin control?",
      answer:
        "Trello gets the requests that the agent sends, and the results go back to the agent. Your workspaces, conversations and files stay on the computer that runs OpenBot. The server works on every Trello plan, but some tools need a paid plan: focus time in Planner needs Premium or Enterprise. Enterprise admins can turn off read or write access, or block the connection, in Atlassian Administration.",
    },
  ],
  sources: [
    {
      label: "Trello: Connect Trello to AI assistants with Trello MCP",
      url: "https://support.atlassian.com/trello/docs/connect-trello-to-ai-assistants-with-trello-mcp/",
    },
    {
      label: "Atlassian: trello-mcp-server on GitHub",
      url: "https://github.com/atlassian/trello-mcp-server",
    },
  ],
  checkedAt: "2026-10-27",
};
