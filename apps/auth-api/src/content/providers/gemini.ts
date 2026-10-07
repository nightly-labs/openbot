import type { ProviderPage } from "./provider-page";

// Every statement about Antigravity and Gemini here is taken from antigravity.google,
// gemini.google and Google's gemini-cli repository. Each page used is in `sources`.
// Google moved Google AI Pro and Ultra accounts from Gemini CLI to Antigravity on
// 18 June 2026. Check the sources again, and move `checkedAt`, whenever this file changes.

export const GEMINI_PROVIDER: ProviderPage = {
  provider: "antigravity",
  name: "Gemini",
  answer:
    "OpenBot runs Gemini as one agent of a team, on macOS, Windows or Linux, through Google's Antigravity agent and your Google AI Pro or Ultra plan. You get shared channels with agents on other providers, and an app on your phone.",
  connect:
    "Choose Gemini, and OpenBot downloads and pins its own copy of Google's Antigravity agent server. Then sign in with the Google account that has your Google AI Pro or Ultra plan.",
  adds: [
    {
      icon: "puzzle",
      title: "Gemini next to other providers",
      text: "Antigravity runs Google's agents. In OpenBot, a Gemini agent works in the same channel as Claude Code, Codex or Grok agents.",
    },
  ],
  vendor: "Google",
  officialApps: [
    {
      name: "Antigravity 2.0",
      platforms: "macOS 12+, Windows 10+, Linux, on x64 and arm64",
      note: "A desktop app that manages many local agents at once.",
    },
    {
      name: "Antigravity IDE",
      platforms: "macOS 12+, Windows 10+, Linux, on x64 and arm64",
      note: "An editor with agents built in.",
    },
    {
      name: "Antigravity command line",
      platforms: "macOS, Windows, Linux",
      note: "The terminal agent, `agy`.",
    },
    {
      name: "Gemini desktop app",
      platforms: "macOS 15+ on Apple silicon, Windows 10+",
      note: "Chat with Gemini. Not a coding agent.",
    },
  ],
  comparisons: ["claude-code-vs-antigravity", "best-ai-agent-apps"],
  faq: [
    {
      question: "Is there a Gemini agent desktop app?",
      answer:
        "Yes. Google's Antigravity 2.0 is a desktop app for coding agents on macOS, Windows and Linux. OpenBot is a different desktop app: it runs Gemini as one agent of a team, with agents on other providers and an app on your phone.",
    },
    {
      question: "Which Google plan does Gemini in OpenBot need?",
      answer:
        "Google AI Pro or Ultra. Google gives the Pro plan entry rate limits for agents in Antigravity, which refresh every five hours up to a weekly limit. Ultra has five or twenty times the usage of Pro.",
    },
    {
      question: "Does OpenBot use Gemini CLI?",
      answer:
        "No. On 18 June 2026, Gemini CLI stopped serving Google AI Pro, Ultra and free accounts. OpenBot runs Gemini through Google's Antigravity agent server, which those plans use now.",
    },
    {
      question: "Can Gemini and Claude Code work together in OpenBot?",
      answer:
        "Yes. Each agent has its own provider. A Gemini agent and a Claude Code agent can work in the same channel and give tasks to each other.",
    },
  ],
  sources: [
    { label: "Google Antigravity", url: "https://antigravity.google/" },
    { label: "Antigravity: download", url: "https://antigravity.google/download" },
    {
      label: "Antigravity: get started with the command line",
      url: "https://antigravity.google/docs/getting-started?tab=cli",
    },
    { label: "Antigravity: plans", url: "https://antigravity.google/docs/plans" },
    {
      label: "Gemini CLI: the move to Antigravity",
      url: "https://github.com/google-gemini/gemini-cli/discussions/27274",
    },
    { label: "Google AI plans", url: "https://gemini.google/us/subscriptions/?hl=en" },
    { label: "Gemini for desktop", url: "https://gemini.google/desktop/" },
  ],
  checkedAt: "2026-10-03",
};
