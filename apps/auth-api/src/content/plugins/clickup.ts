import type { PluginGuide } from "./plugin-guide";

// Every statement about ClickUp here is taken from developer.clickup.com. Each page used is in
// `sources`. Check the sources again, and move `checkedAt`, whenever this file changes.

export const CLICKUP_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Find work and answers",
      text: "The clickup_search tool searches tasks, Docs, chats and more. The clickup_filter_tasks tool finds tasks by List, Folder, Space, status, assignee, tag, date or custom field. The agent can tell you which tasks are due this week, or find the answer to a question in comments and Docs.",
    },
    {
      title: "Create and update tasks",
      text: "The agent creates tasks, changes their fields, moves them to a different List, and adds tags, dependencies and links between tasks. It can also create Lists and Folders, and turn meeting notes into tasks with assignees, priorities and due dates.",
    },
    {
      title: "Write Docs and comments",
      text: "The agent reads Doc pages, creates Docs and pages, and edits pages. It posts comments and replies on tasks, Lists and views, and reads, sends and edits chat messages in channels and direct messages.",
    },
    {
      title: "Track time",
      text: "The agent starts and stops your timer on a task, logs time entries, and reads time entries and the time a task spent in each status. It can use this data to write a status report.",
    },
  ],
  faq: [
    {
      question: "Is the ClickUp MCP server official?",
      answer:
        "Yes. ClickUp hosts the MCP server at mcp.clickup.com and documents it on its developer site. ClickUp says that the MCP server is available on all plans.",
    },
    {
      question: "Does the ClickUp plugin need an API key?",
      answer:
        "No. ClickUp supports only OAuth for MCP connections, not API keys or access tokens. You sign in to your own ClickUp account in the browser. OpenBot does the sign-in itself, keeps the tokens in encrypted storage, and adds the Authorization header. The plugin catalog holds no secret.",
    },
    {
      question: "What can the agent see and change in ClickUp?",
      answer:
        "Every tool acts as you, with your ClickUp permissions. The agent can create and change tasks, Docs, comments and chat messages. It can move tasks and their subtasks to the trash, merge tasks, and delete comments. A merge and a deleted comment cannot be undone by the tool. To stop the access, disconnect ClickUp.",
    },
    {
      question: "Are there usage limits?",
      answer:
        "Yes. ClickUp limits the number of tool calls per day for each workspace and client, and the limit depends on your plan. On the Free Forever plan the limit is 100 calls in 24 hours. The initialize and tools/list requests do not count. Tool calls do not use AI credits.",
    },
  ],
  sources: [
    {
      label: "ClickUp: Connect an AI assistant to ClickUp's MCP server",
      url: "https://developer.clickup.com/docs/connect-an-ai-assistant-to-clickups-mcp-server",
    },
    {
      label: "ClickUp: MCP tools",
      url: "https://developer.clickup.com/docs/mcp-tools",
    },
  ],
  checkedAt: "2026-11-02",
};
