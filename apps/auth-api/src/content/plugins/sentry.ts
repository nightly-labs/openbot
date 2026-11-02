import type { PluginGuide } from "./plugin-guide";

// Every statement about Sentry here is taken from sentry.io and Sentry's
// getsentry/toolkit repository. Each page used is in `sources`. Check the sources again,
// and move `checkedAt`, whenever this file changes.

export const SENTRY_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Find new errors",
      text: "The agent searches grouped issues with search_issues and error events with search_errors. It can also search logs, traces, metrics, profiles and session replays. Each search tool covers one dataset, so a log search does not return spans.",
    },
    {
      title: "Explain a crash",
      text: "The agent reads an issue with get_issue_details and the full stack trace with get_event_stacktrace. It can read breadcrumbs and tag values too. Then it can ask Seer for a root cause analysis and a code fix with analyze_issue_with_seer.",
    },
    {
      title: "Check a release",
      text: "The agent finds recent releases with find_releases and reads one version with get_release_details. Use this to see which version went out last before you look at new errors after a deploy.",
    },
    {
      title: "Triage and assign issues",
      text: "With the Triage Issues skill, the agent resolves, reopens, assigns or ignores an issue with update_issue. It adds a comment to the issue activity with add_issue_note. It can also link a Jira ticket or a GitHub pull request to the issue.",
    },
  ],
  faq: [
    {
      question: "Is the Sentry MCP server official?",
      answer:
        "Yes. Sentry builds and hosts the server. Its source is in Sentry's getsentry/toolkit repository on GitHub, next to the Sentry CLI. Sentry says that the server is mainly for coding agents that work with a person in the loop.",
    },
    {
      question: "Does the Sentry plugin need an API key?",
      answer:
        "No. Each user signs in to their own Sentry account through the browser. OpenBot does the sign-in itself, keeps the tokens in encrypted storage, and adds the Authorization header. The plugin catalog holds no secret.",
    },
    {
      question: "What can an AI agent do with Sentry?",
      answer:
        "Sentry puts its MCP tools in skills: Inspect Issues & Events, Seer, Documentation, Triage Issues, and Manage Projects & Teams. With them, an agent searches errors and logs, reads traces and replays, gets a Seer root cause, updates issues, and creates projects, teams, DSNs and monitors.",
    },
    {
      question: "What data does Sentry get?",
      answer:
        "Your workspaces, conversations and files stay on the computer that runs OpenBot. Sentry gets the requests that the agent sends, such as a search query or an issue update. The tools work on the organizations and projects that your Sentry account can access.",
    },
  ],
  sources: [
    { label: "Sentry: getsentry/toolkit repository", url: "https://github.com/getsentry/toolkit" },
    {
      label: "Sentry MCP: tool definitions",
      url: "https://github.com/getsentry/toolkit/blob/main/packages/mcp-core/src/toolDefinitions.json",
    },
    {
      label: "Sentry MCP: skills",
      url: "https://github.com/getsentry/toolkit/blob/main/packages/mcp-core/src/skills.ts",
    },
    {
      label: "Sentry changelog: dataset-specific search tools",
      url: "https://sentry.io/changelog/sentry-mcp-2026-10-01-to-2026-10-19/",
    },
  ],
  checkedAt: "2026-10-23",
};
