import type { ProviderPage } from "./provider-page";

// Every statement about Codex here is taken from learn.chatgpt.com, where OpenAI
// moved the Codex documentation. Each page used is in `sources`. Check them again,
// and move `checkedAt`, whenever this file changes.

const DOCS = "https://learn.chatgpt.com/docs";

export const CODEX_PROVIDER: ProviderPage = {
  provider: "codex",
  name: "Codex",
  answer:
    "OpenBot runs OpenAI Codex as one agent of a team, on macOS, Windows or Linux, with the ChatGPT plan you already pay for. You get shared channels with agents on other providers, and an app on your phone.",
  connect:
    "Choose ChatGPT, and OpenBot downloads and pins its own copy of Codex, or uses the one you installed. Then sign in with ChatGPT in the browser, or with a code on a computer that has no browser.",
  adds: [
    {
      icon: "devices",
      title: "The same app on every desktop",
      text: "OpenBot runs Codex on macOS on Apple silicon and Intel, on Windows 10 or later, and on x64 or arm64 Linux, on any distribution that runs an AppImage.",
    },
  ],
  vendor: "OpenAI",
  officialApps: [
    {
      name: "ChatGPT desktop app, Codex mode",
      platforms: "macOS on Apple silicon, Windows. Linux in preview",
      note: "Codex with a graphical interface. Native on Windows, with no WSL.",
    },
    {
      name: "Codex command line",
      platforms: "macOS, Linux, Windows",
      note: "The terminal agent. Windows 11 is recommended; Windows 10 is best effort.",
    },
    {
      name: "IDE extension",
      platforms: "VS Code, Cursor, Windsurf, JetBrains IDEs",
      note: "Codex in the editor you already use.",
    },
    {
      name: "Codex in ChatGPT",
      platforms: "Web, and the ChatGPT apps for phones",
      note: "Cloud tasks that run on OpenAI's servers.",
    },
  ],
  comparisons: ["codex-vs-claude-code", "best-ai-agent-apps"],
  faq: [
    {
      question: "Is there a Codex desktop app for Windows and Linux?",
      answer:
        "Yes. OpenAI's ChatGPT desktop app has a Codex mode on Windows, and on Linux in preview. OpenBot is a different desktop app: it runs Codex on macOS, Windows and Linux, as one agent of a team.",
    },
    {
      question: "Does Codex in OpenBot need an OpenAI API key?",
      answer:
        "No. You sign in with ChatGPT, so your ChatGPT plan pays for the work. OpenAI includes Codex in the Free, Go, Plus, Pro, Business, Edu and Enterprise plans, with limits for each plan.",
    },
    {
      question: "Does Codex need WSL on Windows?",
      answer:
        "No. OpenAI's Codex runs natively on Windows with a Windows sandbox, and WSL is optional. OpenBot runs Codex on Windows 10 or later, on x64.",
    },
    {
      question: "Can Codex and Claude Code work together in OpenBot?",
      answer:
        "Yes. Each agent has its own provider. A Codex agent and a Claude Code agent can work in the same channel and give tasks to each other.",
    },
  ],
  sources: [
    { label: "Codex: the desktop app", url: `${DOCS}/app` },
    { label: "Codex: the Windows app", url: `${DOCS}/windows/windows-app` },
    { label: "Codex: the Windows sandbox", url: `${DOCS}/windows/windows-sandbox` },
    { label: "Codex: the Linux app", url: `${DOCS}/linux/linux-app` },
    { label: "Codex: command line", url: `${DOCS}/codex/cli` },
    { label: "Codex: IDE extension", url: `${DOCS}/codex/ide` },
    { label: "Codex pricing", url: `${DOCS}/pricing` },
  ],
  checkedAt: "2026-10-03",
};
