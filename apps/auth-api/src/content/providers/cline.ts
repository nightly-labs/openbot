import type { ProviderPage } from "./provider-page";

// Every statement about Cline here is taken from cline.bot, the Cline documentation
// and Cline's GitHub repository. Each page used is in `sources`. Cline's desktop
// page and its documentation do not agree on Linux: the page lists Linux, the
// documentation does not. Check them again, and move `checkedAt`, whenever this
// file changes.

export const CLINE_PROVIDER: ProviderPage = {
  provider: "cline",
  name: "Cline",
  answer:
    "OpenBot runs the Cline agent without an editor, on macOS, Windows or Linux, with your Cline account or a Cline API key. You get shared channels with agents on other providers, and an app on your phone.",
  connect:
    "Choose Cline, and OpenBot downloads and pins its own copy of the Cline CLI, or uses the one you installed, version 3.0.68 or later. Then sign in with Cline in the browser, or set `CLINE_API_KEY`.",
  adds: [
    {
      icon: "laptop",
      title: "A window for the Cline CLI",
      text: "The Cline CLI runs in the terminal. OpenBot gives it a desktop app with threads and files, and no editor is necessary.",
    },
  ],
  vendor: "Cline",
  officialApps: [
    {
      name: "Cline extension",
      platforms: "VS Code, Cursor, Windsurf, VSCodium, JetBrains IDEs",
      note: "The agent in the editor you already use.",
    },
    {
      name: "Cline for Desktop",
      platforms: "macOS, Windows, and Linux on the download page. In beta",
      note: "The Cline agent as a desktop app, with no editor.",
    },
    {
      name: "Cline CLI",
      platforms: "Any computer with Node.js 20 or later",
      note: "The agent in the terminal. It also speaks the Agent Client Protocol.",
    },
  ],
  comparisons: ["best-ai-agent-apps"],
  faq: [
    {
      question: "Is there a Cline desktop app?",
      answer:
        "Yes. Cline for Desktop is in beta. Its download page lists macOS, Windows and Linux, but the Cline documentation names only macOS and Windows. OpenBot is a different desktop app: it runs the Cline CLI as one agent of a team.",
    },
    {
      question: "What does Cline cost in OpenBot?",
      answer:
        "Cline is open source under the Apache 2.0 license, and has no subscription: you pay for AI use. ClinePass, at $9.99 a month, is optional. OpenBot uses your Cline account or a Cline API key.",
    },
    {
      question: "Do I need VS Code to use Cline in OpenBot?",
      answer: "No. OpenBot runs the Cline CLI, which needs no editor.",
    },
    {
      question: "Can Cline and Claude Code work together in OpenBot?",
      answer:
        "Yes. Each agent has its own provider. A Cline agent and a Claude Code agent can work in the same channel and give tasks to each other.",
    },
  ],
  sources: [
    { label: "Cline for Desktop", url: "https://cline.bot/desktop" },
    { label: "Cline: install", url: "https://docs.cline.bot/getting-started/installing-cline" },
    { label: "Cline CLI: overview", url: "https://docs.cline.bot/cline-cli/overview" },
    { label: "Cline: Agent Client Protocol", url: "https://docs.cline.bot/usage/acp" },
    { label: "ClinePass", url: "https://docs.cline.bot/getting-started/clinepass" },
    { label: "Cline pricing", url: "https://cline.bot/pricing" },
    { label: "Cline on GitHub", url: "https://github.com/cline/cline" },
  ],
  checkedAt: "2026-10-03",
};
