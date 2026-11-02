import type { PluginGuide } from "./plugin-guide";

// Every statement about Airtable here is taken from airtable.com and the airtable-mcp-server
// repository on github.com. Each page used is in `sources`. Check the sources again, and move
// `checkedAt`, whenever this file changes.

export const AIRTABLE_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Find records in a base",
      text: "The list_bases tool shows the bases you can access, with your permission level. The list_tables and describe_table tools show the tables and their fields. The list_records tool filters records with a formula, and search_records finds records that contain a text.",
    },
    {
      title: "Keep records up to date",
      text: "The update_records tool edits one or more records in one call. The create_record tool adds a new record to a table, and delete_records removes records. The get_record tool reads one record by its ID, so the agent can check a change.",
    },
    {
      title: "Change a table's structure",
      text: "The create_table tool adds a new table to a base. The create_field tool adds a field to a table. The update_table and update_field tools change the name or the description of a table or a field. These tools need the schema.bases:write scope.",
    },
    {
      title: "Discuss a record",
      text: "The create_comment tool adds a comment to a record, or a threaded reply to a comment. The list_comments tool lists the comments of a record, newest first. These tools need the data.recordComments:read and data.recordComments:write scopes on your token.",
    },
  ],
  faq: [
    {
      question: "Is this Airtable MCP server official?",
      answer:
        "No. The listing runs airtable-mcp-server, an open-source package with an MIT license from the GitHub user domdomegg. It runs as a local server. Airtable also has its own hosted MCP server, but this listing does not use it.",
    },
    {
      question: "Does the Airtable plugin need an API key?",
      answer:
        "Yes. Make a personal access token in Airtable's tokens panel. Give it the schema.bases:read and data.records:read scopes, and add write scopes only if the agent must change data. Type the token in the OpenBot connect dialog. OpenBot gives it to the local server as AIRTABLE_API_KEY.",
    },
    {
      question: "What can an AI agent change in Airtable?",
      answer:
        "Your token sets the limit. A personal access token can read and write data only in the bases and workspaces that you add to it. Its scopes control which API endpoints it can use. To keep the agent read-only, do not give the token write scopes.",
    },
    {
      question: "Does it cost anything?",
      answer:
        "Installing the plugin is free, and the package is open source. Airtable's API limits apply: 5 requests per second per base, and 50 requests per second for all personal access token traffic from one user. Airtable says that it can change these limits, and that limits can depend on the plan.",
    },
  ],
  sources: [
    { label: "airtable-mcp-server on GitHub", url: "https://github.com/domdomegg/airtable-mcp-server" },
    {
      label: "Airtable: Personal access tokens",
      url: "https://airtable.com/developers/web/guides/personal-access-tokens",
    },
    { label: "Airtable: Rate limits", url: "https://airtable.com/developers/web/api/rate-limits" },
    {
      label: "Airtable: MCP server overview",
      url: "https://airtable.com/developers/agents/mcp/getting-started",
    },
  ],
  checkedAt: "2026-10-23",
};
