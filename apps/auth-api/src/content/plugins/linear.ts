import type { PluginGuide } from "./plugin-guide";

// Every statement about Linear here is taken from linear.app. Each page used is in
// `sources`. Check the sources again, and move `checkedAt`, whenever this file changes.

export const LINEAR_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Find and filter issues",
      text: "The list_issues tool finds issues across the workspace. It filters by team, assignee, project, label, status, priority or cycle. The get_issue tool reads one issue in full, so the agent can list stale work or issues with no owner.",
    },
    {
      title: "Create and update issues",
      text: "The save_issue tool makes a new issue or changes an existing one. It sets the title, team, assignee and other fields. The agent can also add and remove issue relations, such as blocking, related and duplicate links.",
    },
    {
      title: "Follow project progress",
      text: "The list_projects and get_project tools read projects with their milestones and members. The get_status_updates tool reads the latest status updates of a project or an initiative. The agent can then write a short report of what moved and what is late.",
    },
    {
      title: "Write project documents",
      text: "The create_document and update_document tools write documents in a project. The agent can also make and edit project updates, project milestones and initiative updates. Use this to keep a spec or a weekly update next to the issues it describes.",
    },
  ],
  faq: [
    {
      question: "Is the Linear MCP server official?",
      answer:
        "Yes. Linear hosts and manages the server centrally, and documents it on linear.app. Its tools find, create and update objects in Linear, such as issues, projects and comments. Linear adds tools over time and lists the changes in its changelog.",
    },
    {
      question: "Does the Linear plugin need an API key?",
      answer:
        "No. You sign in to your own Linear account in the browser. Linear's server uses OAuth 2.1 with dynamic client registration. OpenBot signs in itself, keeps the tokens in encrypted storage, and adds the Authorization header. The plugin catalog holds no secret.",
    },
    {
      question: "What data does Linear get?",
      answer:
        "Linear gets the requests that the agent sends, such as issue searches, new issue text and status changes. The agent works with the access of the account that signed in. Your workspaces, conversations and files stay on the computer that runs OpenBot.",
    },
    {
      question: "Does the Linear MCP server cost anything?",
      answer:
        "Linear's MCP documentation gives no separate price for the server. The server works through your Linear account, so your Linear plan and its limits apply.",
    },
  ],
  sources: [
    { label: "Linear: MCP server", url: "https://linear.app/docs/mcp" },
    { label: "Linear: Slack integration, MCP tools", url: "https://linear.app/integrations/slack" },
    { label: "Linear changelog", url: "https://linear.app/changelog/page/3" },
  ],
  checkedAt: "2026-10-23",
};
