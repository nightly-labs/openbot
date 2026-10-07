import type { ProviderPage } from "./provider-page";

// Every statement about Grok Build here is taken from x.ai and docs.x.ai. Each page
// used is in `sources`. xAI names its coding agent Grok Build; OpenBot runs its
// command line, the Grok CLI. Check the sources again, and move `checkedAt`,
// whenever this file changes.

export const GROK_PROVIDER: ProviderPage = {
  provider: "grok",
  name: "Grok",
  answer:
    "OpenBot gives xAI's Grok coding agent a desktop app on macOS, Windows or Linux, with your Grok account or an xAI API key. You get shared channels with agents on other providers, and an app on your phone.",
  connect:
    "Choose Grok, and OpenBot downloads and pins its own copy of the Grok CLI, or uses the one you installed. Then sign in with your Grok account, or set `XAI_API_KEY`.",
  adds: [
    {
      icon: "laptop",
      title: "A window for a terminal agent",
      text: "Grok Build runs in the terminal, or in an editor that speaks the Agent Client Protocol. OpenBot gives it a desktop app with threads, files and a model picker.",
    },
  ],
  vendor: "xAI",
  officialApps: [
    {
      name: "Grok Build",
      platforms: "macOS, Linux, Windows",
      note: "The coding agent, in the terminal or headless. It also speaks the Agent Client Protocol.",
    },
    {
      name: "Grok Bot",
      platforms: "macOS, Windows, Linux",
      note: "A desktop agent for general tasks, not coding. Needs a paid Cursor plan or a SuperGrok plan linked to Cursor.",
    },
  ],
  comparisons: ["grok-bot", "best-ai-agent-apps"],
  faq: [
    {
      question: "Is there a GUI for the Grok CLI?",
      answer:
        "xAI documents no graphical app for Grok Build: it runs in the terminal, in scripts, or in an editor through the Agent Client Protocol. OpenBot runs it in a desktop app on macOS, Windows and Linux.",
    },
    {
      question: "Which plan does Grok in OpenBot need?",
      answer:
        "xAI says you can try Grok Build for free. SuperGrok, at $30 a month, has higher limits, and SuperGrok Plus, at $100, has much more usage of Grok Build. An xAI API key also works, at API prices.",
    },
    {
      question: "Is Grok Bot the same as Grok Build?",
      answer:
        "No. Grok Bot is xAI's desktop agent for general tasks on your computer. Grok Build is xAI's coding agent, and it is the one OpenBot runs.",
    },
    {
      question: "Can Grok and Claude Code work together in OpenBot?",
      answer:
        "Yes. Each agent has its own provider. A Grok agent and a Claude Code agent can work in the same channel and give tasks to each other.",
    },
  ],
  sources: [
    { label: "Grok Build: overview", url: "https://docs.x.ai/build/overview" },
    { label: "Grok Build", url: "https://x.ai/build" },
    { label: "xAI: Grok Build CLI", url: "https://x.ai/news/grok-build-cli" },
    { label: "xAI pricing", url: "https://x.ai/pricing" },
    { label: "Grok Bot: get started", url: "https://docs.x.ai/grok-bot/get-started" },
  ],
  checkedAt: "2026-10-03",
};
