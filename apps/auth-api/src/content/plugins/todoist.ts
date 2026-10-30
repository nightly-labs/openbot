import type { PluginGuide } from "./plugin-guide";

// Every statement about Todoist here is taken from todoist.com and Doist's todoist-mcp
// repository. Each page used is in `sources`. Check the sources again, and move `checkedAt`,
// whenever this file changes.

export const TODOIST_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "See what is due",
      text: "The find-tasks-by-date tool gets the tasks in a date range, and the range that starts today also includes overdue tasks. The find-tasks tool finds tasks by text, project, label or a Todoist filter. The get-overview tool shows the tasks of one project, grouped by section.",
    },
    {
      title: "Add and plan tasks",
      text: "The add-tasks tool adds tasks to a project, a section or a parent task, up to 25 tasks in one call. The reschedule-tasks tool moves tasks to new dates and keeps their recurring schedules. Use it, not a date change, for recurring tasks.",
    },
    {
      title: "Organize projects",
      text: "The add-projects and add-sections tools make new projects and sections. The add-labels, add-comments and add-reminders tools add labels, comments and reminders. The agent can turn a meeting note into a project with sections and tasks.",
    },
    {
      title: "Complete and clean up",
      text: "The complete-tasks tool completes tasks, and uncomplete-tasks opens them again. The delete-object tool deletes a project, section, task, comment, label, filter or reminder by its ID. Check the changes that the agent proposes before you approve them.",
    },
  ],
  faq: [
    {
      question: "Is the Todoist MCP server official?",
      answer:
        "Yes. Doist, the company that makes Todoist, hosts the MCP server at ai.todoist.net. The source code is in Doist's todoist-mcp repository on GitHub. Todoist's help center tells how to connect it to an AI assistant.",
    },
    {
      question: "Does the Todoist plugin need an API key?",
      answer:
        "No. You sign in to your own Todoist account in the browser and allow access. The assistant gets a token, not your password. OpenBot keeps the tokens in encrypted storage and adds the Authorization header. You can revoke access in Todoist under Settings > Integrations.",
    },
    {
      question: "What can the agent see and change in Todoist?",
      answer:
        "The connection asks for read and write access. The agent can read, add, change, complete and delete your tasks, projects, sections, labels, comments and reminders. Todoist gets the requests that the agent sends. Your workspaces, conversations and files stay on the computer that runs OpenBot.",
    },
    {
      question: "Does my Todoist plan change what the agent can do?",
      answer:
        "Todoist lists the MCP connection for the Beginner, Pro and Business plans. On the Beginner plan, the activity history goes back only 7 days, so the agent can find fewer completed recurring tasks. Pro and Business keep the full history.",
    },
  ],
  sources: [
    {
      label: "Todoist: connect Todoist to an AI assistant",
      url: "https://www.todoist.com/help/todoist/todoist-and-ai/connect-todoist-to-an-ai-assistant-xMSzFfHng",
    },
    {
      label: "Todoist: use Todoist in Claude Code",
      url: "https://www.todoist.com/help/todoist/todoist-and-ai/use-todoist-in-claude-code-b1USJ4HB3",
    },
    { label: "Doist: todoist-mcp repository", url: "https://github.com/Doist/todoist-mcp" },
  ],
  checkedAt: "2026-10-26",
};
