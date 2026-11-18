import type { PluginGuide } from "./plugin-guide";

// Every statement about TickTick here is taken from TickTick's help center. Each page used is in
// `sources`. Check the sources again, and move `checkedAt`, whenever this file changes.

export const TICKTICK_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "See what is due",
      text: "The agent lists your undone tasks for today, tomorrow or the next 7 days, or for a date range of up to 14 days. It finds tasks by keyword, and filters them by date, list, priority, tag and status. It also reads the tasks that you completed in a list.",
    },
    {
      title: "Add and change tasks",
      text: "The agent adds one task or many tasks in one call, with a title, description, date, priority, list and tags. It changes tasks, moves them to another list, completes them and completes checklist items. It can complete up to 20 tasks of one list in one call.",
    },
    {
      title: "Organize lists",
      text: "The agent makes and changes lists, sections, folders and tags, and adds comments to tasks. In a shared list, it can assign a task to a member of the list.",
    },
    {
      title: "Track habits and focus",
      text: "The agent reads and changes habits, and adds habit check-ins for the past 90 days. It reads and adds focus records, up to one month at a time. It also reads events from the calendars that you connected to TickTick, and your countdowns.",
    },
  ],
  faq: [
    {
      question: "Is the TickTick MCP server official?",
      answer:
        "Yes. TickTick hosts the MCP server at mcp.ticktick.com and tells how to connect it in its help center. The server uses the Streamable HTTP transport.",
    },
    {
      question: "Does the TickTick plugin need an API key?",
      answer:
        "No. You sign in to your own TickTick account in the browser and allow access. The assistant gets a token, not your password. OpenBot keeps the tokens in encrypted storage and adds the Authorization header. When the token expires or you revoke the access, you sign in again.",
    },
    {
      question: "What can the agent see and change in TickTick?",
      answer:
        "The connection asks for read and write access to your tasks. The agent can read, add, change, complete, move and delete tasks. A deleted task goes to the Trash. The agent can also delete comments, tags and focus records, and ungroup a folder: its lists stay. TickTick gets the requests that the agent sends. Your workspaces, conversations and files stay on the computer that runs OpenBot.",
    },
    {
      question: "Does the TickTick MCP server support all TickTick features?",
      answer:
        "No. TickTick says that the server supports basic task, list, habit, focus record and countdown operations. Other advanced features are not available to the agent yet.",
    },
  ],
  sources: [
    {
      label: "TickTick: TickTick MCP",
      url: "https://help.ticktick.com/articles/7438129581631995904",
    },
  ],
  checkedAt: "2026-11-04",
};
