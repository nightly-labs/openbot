import type { PluginGuide } from "./plugin-guide";

// Every statement about Neon here is taken from neon.com and from the tool list that
// mcp.neon.tech publishes. Each page used is in `sources`. Check the sources again, and
// move `checkedAt`, whenever this file changes.

export const NEON_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Explore projects and schemas",
      text: "The list_projects and list_branches tools show your Neon projects and their branches. The get_database_tables and describe_table_schema tools read the tables, columns and constraints of a database. The run_sql tool runs one SQL statement, so the agent can answer a question about your data.",
    },
    {
      title: "Test a schema change on a branch",
      text: "The prepare_database_migration tool applies a schema change on a temporary branch. The agent tests the change there with run_sql. Then complete_database_migration applies the change or discards it, and deletes the temporary branch. Neon tells agents to ask you before they apply it.",
    },
    {
      title: "Find slow queries",
      text: "The list_slow_queries tool reads pg_stat_statements and lists queries by execution time. The explain_sql_statement tool shows the execution plan of a statement. The prepare_query_tuning tool analyzes a slow query on a temporary branch, where the agent can test a fix before you accept it.",
    },
    {
      title: "Search the Neon docs",
      text: "The search_docs tool searches the Neon docs, API reference, guides and changelog. The get_doc tool then reads one page as Markdown. The agent can find how to connect a framework or set up a feature before it writes code.",
    },
  ],
  faq: [
    {
      question: "Is the Neon MCP server official?",
      answer:
        "Yes. Neon hosts the remote MCP server at mcp.neon.tech and documents it in the Neon docs. The server supports OAuth sign-in. Neon publishes its full tool list at mcp.neon.tech.",
    },
    {
      question: "Does the Neon plugin need an API key?",
      answer:
        "No. You sign in to your own Neon account in the browser. OpenBot signs in itself, keeps the tokens in encrypted storage, and adds the Authorization header. The plugin catalog holds no secret.",
    },
    {
      question: "What can the agent change in Neon?",
      answer:
        "With full access, the agent can run SQL that changes or deletes data, and create, reset or delete branches, databases and projects. When you authorize, you can choose read-only access. Then the agent can only run read queries and inspect schemas. Neon gets the requests that the agent sends. Your workspaces, conversations and files stay on the computer that runs OpenBot.",
    },
    {
      question: "Can I use the Neon plugin with a production database?",
      answer:
        "Neon recommends its MCP server for development and testing only. Neon tells you not to connect agents to production databases, and to review each action before it runs. Use a development branch or a project without production data.",
    },
  ],
  sources: [
    { label: "Neon: Neon MCP Server", url: "https://neon.com/docs/ai/neon-mcp-server" },
    { label: "Neon MCP: tool list", url: "https://mcp.neon.tech/api/list-tools" },
  ],
  checkedAt: "2026-10-26",
};
