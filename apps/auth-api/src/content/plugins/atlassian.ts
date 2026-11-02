import type { PluginGuide } from "./plugin-guide";

// Every statement about Atlassian here is taken from support.atlassian.com and
// developer.atlassian.com. Each page used is in `sources`. Check the sources again, and move
// `checkedAt`, whenever this file changes.

export const ATLASSIAN_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Find work items and pages",
      text: "The search tool runs a semantic search across Jira, Confluence and connected apps; Atlassian calls it beta. The searchJiraIssuesUsingJql tool searches work items with JQL, and the searchConfluence tool searches Confluence content with CQL. The agent can find the open work for a release and the pages about it.",
    },
    {
      title: "Create and update Jira work items",
      text: "The createJiraIssue tool makes a new work item, and the editJiraIssue tool changes it. The transitionJiraIssue tool moves a work item to a new status, a sprint or the backlog. The addOrEditJiraIssueComment tool adds a comment. The agent can file a bug with steps to reproduce.",
    },
    {
      title: "Write Confluence pages",
      text: "The getConfluenceContent tool reads a page. The createConfluenceContent tool makes a page, blog post, live doc, whiteboard, database or folder. The updateConfluenceContent tool changes a page, and the createConfluenceComment tool adds a comment. The agent can turn meeting notes into a page.",
    },
    {
      title: "Review Bitbucket pull requests",
      text: "The getBitbucketRepoPullRequestDiff tool reads the changes of a pull request. The addBitbucketRepoPullRequestComment tool adds a review comment, and the mergeBitbucketRepoPullRequest tool merges it. The Bitbucket workspace must be linked to an Atlassian organization.",
    },
  ],
  faq: [
    {
      question: "Is the Atlassian MCP server official?",
      answer:
        "Yes. Atlassian hosts the Atlassian MCP server, also called the Rovo MCP server, at mcp.atlassian.com. This plugin uses version 2 of the server. Sign-in uses OAuth 2.1, and the actions respect the access controls and permissions that the user has.",
    },
    {
      question: "Does the Atlassian plugin need an API token?",
      answer:
        "No. Each user signs in to their own Atlassian account through the browser and approves the access on a consent screen. OpenBot does the sign-in itself, keeps the tokens in encrypted storage, and adds the Authorization header. The plugin catalog holds no secret.",
    },
    {
      question: "What can the agent see and change in Atlassian?",
      answer:
        "The agent has the same permissions as your Atlassian account. It finds a tool with the discover tool, then runs it with executeRead, executeWrite or executeDestructive. Write tools change work items, pages, page permissions and public links, and merge pull requests. The tools that delete Jira data or manage Jira projects stay off until an organization admin turns them on. Atlassian gets the requests that the agent sends. Your workspaces, conversations and files stay on the computer that runs OpenBot.",
    },
    {
      question: "What can an Atlassian admin control, and what does it cost?",
      answer:
        "Organization admins control the server in Atlassian Administration. By default, Atlassian allows its supported domains, and the list includes localhost and 127.0.0.1, which OpenBot uses for sign-in. IP allowlists also apply to tool calls. Each tool call uses Rovo credits from the pool of the organization. Jira and Confluence Standard, Premium and Enterprise plans include a monthly credit allowance for each user.",
    },
  ],
  sources: [
    {
      label: "Atlassian: Get started with the Atlassian MCP server",
      url: "https://support.atlassian.com/atlassian-ai-gateway/docs/get-started-with-the-atlassian-remote-mcp-server/",
    },
    {
      label: "Atlassian: Upgrade from Atlassian MCP v1 to v2",
      url: "https://support.atlassian.com/atlassian-ai-gateway/docs/how-to-upgrade-from-atlassian-mcp-v1-to-atlassian-mcp-v2/",
    },
    {
      label: "Atlassian: Configure OAuth 2.1",
      url: "https://support.atlassian.com/atlassian-ai-gateway/docs/configure-oauth-2-1/",
    },
    {
      label: "Atlassian Developer: supported tools",
      url: "https://developer.atlassian.com/cloud/rovo-mcp/guides/supported-tools/",
    },
    {
      label: "Atlassian: Understand Atlassian MCP server",
      url: "https://support.atlassian.com/security-and-access-policies/docs/understand-atlassian-mcp-server/",
    },
    {
      label: "Atlassian: Control Atlassian MCP server settings",
      url: "https://support.atlassian.com/security-and-access-policies/docs/control-atlassian-mcp-server-settings/",
    },
    {
      label: "Atlassian: Available Atlassian MCP server domains",
      url: "https://support.atlassian.com/security-and-access-policies/docs/available-atlassian-mcp-server-domains/",
    },
    { label: "Atlassian: Rovo usage limits", url: "https://support.atlassian.com/rovo/docs/rovo-usage-limits/" },
  ],
  checkedAt: "2026-10-26",
};
