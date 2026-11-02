import type { PluginGuide } from "./plugin-guide";

// Every statement about Render here is taken from render.com and Render's MCP server repository.
// Each page used is in `sources`. Check the sources again, and move `checkedAt`, whenever this
// file changes.

export const RENDER_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "See workspaces and services",
      text: "The list_workspaces and select_workspace tools choose the workspace that the agent uses. The list_services and get_service tools list the services in it and show their details. The agent can tell you what runs where before you change it.",
    },
    {
      title: "Find why a deploy or a service failed",
      text: "The list_deploys and get_deploy tools read the deploy history of a service. The list_events tool shows builds, restarts and failures, with the reason a service went down, such as an out-of-memory kill or a failed health check. The list_logs tool reads the logs that match a filter.",
    },
    {
      title: "Check metrics and data",
      text: "The get_metrics tool reads CPU and memory use, instance count, response counts and bandwidth. The query_render_postgres tool runs a read-only SQL query on a Render Postgres database.",
    },
    {
      title: "Create services and trigger deploys",
      text: "The agent can create web services, static sites, cron jobs, Postgres databases and Key Value instances. The trigger_deploy tool starts a deploy, and the update_environment_variables tool replaces the environment variables of a service.",
    },
  ],
  faq: [
    {
      question: "Is the Render MCP server official?",
      answer:
        "Yes. Render hosts the MCP server at mcp.render.com and documents it on render.com. Its source is in Render's render-oss GitHub organization. This plugin uses the hosted server.",
    },
    {
      question: "Which key does the Render plugin need?",
      answer:
        "A Render API key, which you create in your Render Account settings. Type the key in the connect dialog in OpenBot. OpenBot sends it as a bearer token in the Authorization header. The key gives access to every workspace of your Render account. The plugin catalog holds no secret.",
    },
    {
      question: "What can the agent change in Render?",
      answer:
        "The agent can create services, databases and Key Value instances, trigger deploys, and replace the environment variables of a service. The server cannot delete a resource, and it cannot change scaling or most service settings. Render warns that a change to environment variables can be destructive, so check what the agent changes.",
    },
    {
      question: "What data does Render get?",
      answer:
        "Render gets the requests that the agent sends, and the results go back to the agent. Render does not promise that secrets, such as database connection strings, stay out of the agent's context. Your workspaces, conversations and files stay on the computer that runs OpenBot.",
    },
  ],
  sources: [
    { label: "Render: MCP server", url: "https://render.com/docs/mcp-server" },
    {
      label: "Render MCP server on GitHub",
      url: "https://github.com/render-oss/render-mcp-server",
    },
    { label: "Render: API keys", url: "https://render.com/docs/api#1-create-an-api-key" },
  ],
  checkedAt: "2026-10-27",
};
