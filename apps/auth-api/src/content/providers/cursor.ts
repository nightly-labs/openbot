import type { ProviderPage } from "./provider-page";

// Every statement about Cursor here is taken from cursor.com and the Cursor
// documentation. Each page used is in `sources`. Check them again, and move
// `checkedAt`, whenever this file changes.

const DOCS = "https://cursor.com/docs";

export const CURSOR_PROVIDER: ProviderPage = {
  provider: "cursor",
  name: "Cursor",
  answer:
    "OpenBot runs the Cursor agent outside the Cursor editor, on macOS, Windows or Linux, with your Cursor plan or a Cursor API key. You get shared channels with agents on other providers, and an app on your phone.",
  connect:
    "Choose Cursor, and OpenBot downloads and pins its own copy of the Cursor CLI, or uses the one you installed. Then sign in with Cursor in the browser, or set `CURSOR_API_KEY`.",
  adds: [
    {
      icon: "laptop",
      title: "The Cursor agent without the editor",
      text: "The Cursor CLI runs in the terminal. OpenBot gives it a desktop app with threads and files, so you can use Cursor's models without the editor open.",
    },
  ],
  vendor: "Cursor",
  officialApps: [
    {
      name: "Cursor editor",
      platforms: "macOS, Windows, Linux, on x64 and arm64",
      note: "An editor built from VS Code, with agents built in.",
    },
    {
      name: "Cursor CLI",
      platforms: "macOS, Linux, Windows, WSL",
      note: "The agent in the terminal, as `agent`. It also speaks the Agent Client Protocol.",
    },
  ],
  comparisons: ["cursor-vs-claude-code", "best-ai-agent-apps"],
  faq: [
    {
      question: "Is there a GUI for the Cursor CLI?",
      answer:
        "The Cursor editor is Cursor's own graphical app. The Cursor CLI also runs in editors that speak the Agent Client Protocol, such as Zed and JetBrains IDEs. OpenBot is a desktop app that runs it as one agent of a team.",
    },
    {
      question: "Which Cursor plan does OpenBot need?",
      answer:
        "Your Cursor plan, or a Cursor API key from the Cursor dashboard. Hobby is free; Pro is $20 a month, Pro Plus $60 and Ultra $200. Use beyond the plan is billed at API prices.",
    },
    {
      question: "Do I need the Cursor editor to use Cursor in OpenBot?",
      answer:
        "No. OpenBot runs the Cursor CLI, which is a separate program. The editor does not have to be installed or open.",
    },
    {
      question: "Can Cursor and Claude Code work together in OpenBot?",
      answer:
        "Yes. Each agent has its own provider. A Cursor agent and a Claude Code agent can work in the same channel and give tasks to each other.",
    },
  ],
  sources: [
    { label: "Cursor: download", url: "https://cursor.com/download" },
    { label: "Cursor CLI: install", url: `${DOCS}/cli/installation` },
    { label: "Cursor CLI: Agent Client Protocol", url: `${DOCS}/cli/acp` },
    { label: "Cursor CLI: authentication", url: `${DOCS}/cli/reference/authentication` },
    { label: "Cursor: plans and usage", url: `${DOCS}/account/pricing` },
    { label: "Cursor pricing", url: "https://cursor.com/pricing" },
  ],
  checkedAt: "2026-10-03",
};
