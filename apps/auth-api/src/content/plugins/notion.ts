import type { PluginGuide } from "./plugin-guide";

// Every statement about Notion here is taken from developers.notion.com. Each page used is
// in `sources`. Check the sources again, and move `checkedAt`, whenever this file changes.

export const NOTION_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Search the workspace",
      text: "The notion-search tool finds pages, databases and workspace users, with up to 50 results. The notion-fetch tool then reads a page, a database or a view by its URL or ID. The agent can find a spec and tell you its open questions.",
    },
    {
      title: "Write and organize pages",
      text: "The notion-create-pages tool makes new pages, also from database templates. The notion-update-page tool changes the properties and content of a page. The agent can move pages to a new parent with notion-move-pages, or make a copy with notion-duplicate-page.",
    },
    {
      title: "Query and build databases",
      text: "The notion-query-data-sources tool reads the rows of a database or a saved view, or runs SQL on it. The notion-create-database and notion-create-view tools make a database and its views, with filters and sorts. Use them to keep a task list or a release tracker.",
    },
    {
      title: "Answer comments on a page",
      text: "The notion-get-comments tool lists the comments and discussions on a page. The notion-create-comment tool adds a comment to a page or a block, or a reply to a discussion. The agent can collect review notes and answer each one.",
    },
  ],
  faq: [
    {
      question: "Is the Notion MCP server official?",
      answer:
        "Yes. Notion MCP is a remote MCP server that Notion hosts. You authorize the connection with OAuth before the agent can use its tools. Notion lists each tool and its limits in its developer documentation.",
    },
    {
      question: "Does the Notion plugin need an API key?",
      answer:
        "No. You sign in to your own Notion account in the browser. OpenBot signs in itself, keeps the tokens in encrypted storage, and adds the Authorization header. The plugin catalog holds no secret.",
    },
    {
      question: "What can the agent see in Notion?",
      answer:
        "The agent can read and update the content that you can access in Notion. Workspace owners can manage which clients connect, and on the Enterprise plan they can limit them. Notion gets the requests that the agent sends. Your workspaces, conversations and files stay on the computer that runs OpenBot.",
    },
    {
      question: "Do all Notion MCP tools work on every plan?",
      answer:
        "No. Search across connected sources, such as Slack or Google Drive, needs a Business or Enterprise plan with Notion AI. Comment edit, delete and resolve tools need a Business or Enterprise plan. Each tool call also counts toward the standard Notion API request limits.",
    },
  ],
  sources: [
    { label: "Notion: Notion MCP", url: "https://developers.notion.com/docs/mcp" },
    {
      label: "Notion: supported MCP tools",
      url: "https://developers.notion.com/docs/mcp-supported-tools",
    },
  ],
  checkedAt: "2026-10-23",
};
