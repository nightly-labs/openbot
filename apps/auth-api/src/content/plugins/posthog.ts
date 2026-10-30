import type { PluginGuide } from "./plugin-guide";

// Every statement about PostHog here is taken from posthog.com. Each page used is in
// `sources`. Check the sources again, and move `checkedAt`, whenever this file changes.

export const POSTHOG_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Check funnels and trends",
      text: "The query-funnel, query-trends and query-retention tools run each type of analysis on your project. The actors variants, such as query-funnel-actors, list the persons behind a result. For other questions, the execute-sql tool runs a SQL query, and read-data-schema shows the events and properties.",
    },
    {
      title: "Inspect and test feature flags",
      text: "The feature-flag-get-all and feature-flag-get-definition-by-key tools read your flags. The feature-flags-test-evaluation-create tool tests how a flag evaluates. With your approval, the agent can also enable, disable or roll out a flag to everyone.",
    },
    {
      title: "Triage production errors",
      text: "The query-error-tracking-issues-list tool finds error tracking issues, and query-error-tracking-issue shows one issue in detail. The agent can rank the top errors, read their stack traces, and update or merge issues. It can also make assignment rules for new errors.",
    },
    {
      title: "Read experiment results",
      text: "The experiment-results-get and experiment-timeseries-results tools read the results of an experiment. Other experiment tools launch, pause, resume and end a run, or ship the winning variant. The agent can compare the variants before you decide.",
    },
  ],
  faq: [
    {
      question: "Is the PostHog MCP server official?",
      answer:
        "Yes. PostHog runs the MCP server as a hosted endpoint and documents it on posthog.com. Its source is in PostHog's GitHub repository. The server has tools for product analytics, feature flags, experiments, error tracking, dashboards, surveys and more.",
    },
    {
      question: "Which key does the PostHog plugin need?",
      answer:
        "A personal API key. PostHog recommends the MCP Server preset, which scopes the key to one project. Type the key in the connect dialog in OpenBot. OpenBot sends it as a bearer token in the Authorization header. The plugin catalog holds no secret.",
    },
    {
      question: "Does the PostHog MCP server cost anything?",
      answer:
        "Connecting to the server and calling its tools is free. Standard PostHog usage billing still applies to the data that your queries use. Some tools use an LLM and can bill as PostHog AI spend. These tools work only when AI data processing is on in your organization.",
    },
    {
      question: "What data does PostHog get?",
      answer:
        "PostHog gets the requests that the agent sends. The server is a proxy and does not store your analytics data. Queries run on your PostHog project, and the results go back to the agent. Your workspaces, conversations and files stay on the computer that runs OpenBot.",
    },
  ],
  sources: [
    { label: "PostHog: MCP server", url: "https://posthog.com/docs/model-context-protocol" },
    {
      label: "PostHog: MCP tools",
      url: "https://posthog.com/docs/model-context-protocol/tools",
    },
    { label: "PostHog: MCP FAQ", url: "https://posthog.com/docs/model-context-protocol/faq" },
  ],
  checkedAt: "2026-10-23",
};
