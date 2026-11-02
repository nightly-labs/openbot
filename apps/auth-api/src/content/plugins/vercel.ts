import type { PluginGuide } from "./plugin-guide";

// Every statement about Vercel here is taken from vercel.com. Each page used is in
// `sources`. Check the sources again, and move `checkedAt`, whenever this file changes.

export const VERCEL_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Find why a build failed",
      text: "The agent lists deployments with list_deployments and filters them by state, branch or commit. Then it reads the build output with get_deployment_build_logs. That tool can return only the error lines of the build.",
    },
    {
      title: "Check runtime errors",
      text: "The agent groups runtime errors with get_runtime_errors and sees the affected routes and counts, for up to the last seven days. Then it reads the matching lines with get_runtime_logs, filtered by environment, level, time window or a text search.",
    },
    {
      title: "Check a protected deployment",
      text: "The agent fetches a page of a deployment with web_fetch_vercel_url, also when Vercel Authentication protects it. It can also make a temporary shareable link with get_access_to_vercel_url, so that another person can open the deployment.",
    },
    {
      title: "Manage domains and settings",
      text: "The agent reads and edits project environment variables, and reads and updates DNS records. It checks if a domain is available and what it costs. To buy a domain, it gets a quote first, and you approve the price before it confirms the order.",
    },
  ],
  faq: [
    {
      question: "Is the Vercel MCP server official?",
      answer:
        "Yes. Vercel calls it its official MCP server. It is a remote server with OAuth sign-in. Vercel documents its tools for projects, deployments, logs, domains, environment variables and Web Analytics.",
    },
    {
      question: "Does the Vercel plugin need an API key?",
      answer:
        "No. Each user signs in to their own Vercel account through the browser and chooses the teams that agents can use. OpenBot does the sign-in itself, keeps the tokens in encrypted storage, and adds the Authorization header. The plugin catalog holds no secret.",
    },
    {
      question: "What can the agent change in Vercel?",
      answer:
        "In the teams that you choose, the agent has the same access as your Vercel account. It can change environment variables, domains, DNS records and deployments, and buy domains. Vercel advises human confirmation, so that a person approves each change before it runs.",
    },
    {
      question: "Does Vercel MCP cost anything?",
      answer:
        "Installing the plugin in OpenBot is free. Vercel MCP is available on all Vercel plans, and Vercel's AI Product Terms apply to its use. Your Vercel plan limits still apply. Vercel charges a domain purchase to your team at the quoted price.",
    },
  ],
  sources: [
    { label: "Vercel: Use Vercel MCP", url: "https://vercel.com/docs/agent-resources/vercel-mcp" },
    { label: "Vercel MCP: Tools", url: "https://vercel.com/docs/agent-resources/vercel-mcp/tools" },
    {
      label: "Vercel MCP: Deployments tools",
      url: "https://vercel.com/docs/agent-resources/vercel-mcp/tools/deployments",
    },
    {
      label: "Vercel MCP: Observability tools",
      url: "https://vercel.com/docs/agent-resources/vercel-mcp/tools/observability",
    },
    {
      label: "Vercel MCP: Environment Variables tools",
      url: "https://vercel.com/docs/agent-resources/vercel-mcp/tools/environment-variables",
    },
    {
      label: "Vercel MCP: Domains and DNS tools",
      url: "https://vercel.com/docs/agent-resources/vercel-mcp/tools/domains",
    },
    {
      label: "Vercel MCP: Billing and Purchases tools",
      url: "https://vercel.com/docs/agent-resources/vercel-mcp/tools/billing",
    },
  ],
  checkedAt: "2026-10-23",
};
