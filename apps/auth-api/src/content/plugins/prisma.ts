import type { PluginGuide } from "./plugin-guide";

// Every statement about Prisma here is taken from prisma.io. Each page used is in
// `sources`. Check the sources again, and move `checkedAt`, whenever this file changes.

export const PRISMA_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Manage Prisma Postgres databases",
      text: "The list_prisma_postgres_databases tool lists the databases in your workspace. The create_prisma_postgres_database tool makes a new database and a new project. The introspect_database_schema tool reads the structure of a database, and execute_sql_query runs SQL on it.",
    },
    {
      title: "Restore from a backup",
      text: "The list_prisma_postgres_backups tool lists the automated backups of a database. The create_prisma_postgres_recovery tool restores a backup to a new database. The original database does not change.",
    },
    {
      title: "Check Compute apps",
      text: "The list_prisma_compute_builds tool lists builds, newest first, with filters for project, branch and state. The get_prisma_compute_deployment_logs tool reads the runtime logs of a deployment. The agent can find why a build or a deployment failed.",
    },
    {
      title: "Search the Prisma docs",
      text: "The search_prisma_documentation tool answers a question with a cited answer from the official Prisma documentation. The agent can look up how to deploy to Prisma Compute before it changes your project.",
    },
  ],
  faq: [
    {
      question: "Is the Prisma MCP server official?",
      answer:
        "Yes. Prisma documents a remote MCP server at mcp.prisma.io. It works in the workspace that you select, and Prisma lists each tool in its documentation.",
    },
    {
      question: "Does the Prisma plugin need an API key?",
      answer:
        "No. You sign in to your own Prisma account in the browser, select a workspace and approve access. OpenBot signs in itself, keeps the tokens in encrypted storage, and adds the Authorization header. The plugin catalog holds no secret.",
    },
    {
      question: "What can the agent change in Prisma?",
      answer:
        "The agent has full access to the workspace that you select. It can run SQL that changes or deletes data, update schemas, and delete databases, connection strings, buckets and access keys. It can also start, stop, roll back or delete Compute deployments, and set environment variables. Prisma warns that these tools can cause data loss or interrupt live traffic. Prisma gets the requests that the agent sends. Your workspaces, conversations and files stay on the computer that runs OpenBot.",
    },
  ],
  sources: [
    { label: "Prisma: MCP server", url: "https://www.prisma.io/docs/ai/tools/mcp-server" },
    { label: "Prisma: MCP tools", url: "https://www.prisma.io/docs/ai/mcp-tools" },
  ],
  checkedAt: "2026-10-26",
};
