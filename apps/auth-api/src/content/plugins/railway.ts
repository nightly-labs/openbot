import type { PluginGuide } from "./plugin-guide";

// Every statement about Railway here is taken from docs.railway.com and railway.com. Each page
// used is in `sources`. Check the sources again, and move `checkedAt`, whenever this file changes.

export const RAILWAY_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "See projects and services",
      text: "The list-projects tool lists the projects that the agent can use, and the list-services tool lists the services in a project. The whoami tool shows the signed-in account. The agent can tell you what runs where before you change it.",
    },
    {
      title: "Redeploy and ship staged changes",
      text: "The redeploy tool deploys a service again. The accept-deploy tool commits the staged changes of a project and deploys them. Railway marks accept-deploy as destructive, so that a client can ask you before it runs. The create-project tool makes a new project.",
    },
    {
      title: "Manage feature flags",
      text: "The list-feature-flags and get-feature-flag tools read the feature flags of a project. The set-feature-flag tool changes a flag, and the delete-feature-flag tool removes it. Railway marks the delete as destructive.",
    },
    {
      title: "Give multi-step work to the Railway Agent",
      text: "The railway-agent tool sends a request in plain language to the Railway Agent. That agent reads build and runtime logs, finds why a deploy failed, creates services, sets variables, connects databases and changes networking and resource limits. Ask it why a backend service crashes on deploy.",
    },
  ],
  faq: [
    {
      question: "Is the Railway MCP server official?",
      answer:
        "Yes. Railway hosts the Remote MCP Server at mcp.railway.com, with OAuth sign-in. Railway lists its tools in the Railway documentation. Railway also has a local MCP server in its CLI; this plugin uses the remote server.",
    },
    {
      question: "Does the Railway plugin need an API key?",
      answer:
        "No. Each user signs in to their own Railway account through the browser and chooses the workspaces and projects that agents can use. The server does not accept project tokens. OpenBot does the sign-in itself, keeps the tokens in encrypted storage, and adds the Authorization header. You can revoke the access in your Railway account settings. The plugin catalog holds no secret.",
    },
    {
      question: "What can the agent change in Railway?",
      answer:
        "In the workspaces and projects that you choose, the agent can create projects, redeploy services, deploy staged changes, and change or delete feature flags. Through the Railway Agent, it can also change services, variables, databases and networking. Railway gets the requests that the agent sends. Your workspaces, conversations and files stay on the computer that runs OpenBot.",
    },
    {
      question: "Does the Railway plugin cost anything?",
      answer:
        "Installing the plugin in OpenBot is free. You need a Railway account. Railway bills the work of the Railway Agent by the LLM tokens that it uses, with no markup.",
    },
  ],
  sources: [
    { label: "Railway: MCP server", url: "https://docs.railway.com/ai/mcp-server" },
    { label: "Railway: Railway Agent", url: "https://docs.railway.com/ai/railway-agent" },
    { label: "Railway: MCP", url: "https://railway.com/mcp" },
    {
      label: "Railway changelog: Remote MCP server",
      url: "https://railway.com/changelog/2026-04-17-remote-mcp",
    },
  ],
  checkedAt: "2026-10-26",
};
