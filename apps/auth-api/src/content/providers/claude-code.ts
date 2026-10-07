import type { ProviderPage } from "./provider-page";

// Every statement about Claude Code here is taken from code.claude.com and
// claude.com. Each page used is in `sources`. Check them again, and move
// `checkedAt`, whenever this file changes.

const DOCS = "https://code.claude.com/docs/en";

export const CLAUDE_CODE_PROVIDER: ProviderPage = {
  provider: "claude",
  name: "Claude Code",
  answer:
    "OpenBot runs Claude Code as one agent of a team, on macOS, Windows or Linux, with the Claude plan you already pay for. You get shared channels with agents on other providers, and an app on your phone.",
  connect:
    "Choose Claude, and OpenBot downloads and pins its own copy of Claude Code, or uses the one you installed. Then sign in with your Claude account. If `claude` works in your terminal, it works in OpenBot.",
  adds: [
    {
      icon: "laptop",
      title: "A full desktop app on Linux",
      text: "Anthropic's desktop app is in beta on Linux, for Ubuntu and Debian only. OpenBot runs Claude Code on x64 and arm64 Linux, as an AppImage.",
    },
  ],
  vendor: "Anthropic",
  officialApps: [
    {
      name: "Claude desktop app, Code tab",
      platforms: "macOS, Windows. Linux in beta, Ubuntu 22.04+ and Debian 12+",
      note: "Claude Code with a graphical interface. Needs a paid Claude plan.",
    },
    {
      name: "Claude Code command line",
      platforms: "macOS 13+, Windows 10+, Ubuntu, Debian, Alpine",
      note: "The terminal agent. No WSL is necessary on Windows.",
    },
    {
      name: "IDE extensions",
      platforms: "VS Code and its forks, JetBrains IDEs",
      note: "Claude Code in the editor you already use.",
    },
    {
      name: "Claude Code on the web",
      platforms: "Browser, and the Claude apps for iPhone and Android",
      note: "Cloud sessions on Pro, Max, Team and Enterprise plans.",
    },
  ],
  comparisons: ["codex-vs-claude-code", "cursor-vs-claude-code", "claude-code-vs-antigravity", "claude-cowork"],
  faq: [
    {
      question: "Is there a GUI for Claude Code?",
      answer:
        "Yes. Anthropic's Claude desktop app has a Code tab for macOS and Windows, and Linux in beta. OpenBot is a different desktop app: it runs Claude Code as one agent of a team, with agents on other providers and an app on your phone.",
    },
    {
      question: "Does OpenBot need an Anthropic API key for Claude Code?",
      answer:
        "No. OpenBot uses the sign-in of Claude Code, so your Claude Pro or Max plan works. OpenBot does not copy your credentials. The free Claude plan does not include Claude Code.",
    },
    {
      question: "Can I run Claude Code on Linux with a graphical app?",
      answer:
        "Yes. Anthropic's desktop app is in beta on Linux, for Ubuntu 22.04 or later and Debian 12 or later. OpenBot runs Claude Code on x64 and arm64 Linux as an AppImage, on any distribution that runs an AppImage.",
    },
    {
      question: "Can Claude Code and Codex work together in OpenBot?",
      answer:
        "Yes. Each agent has its own provider. A Claude Code agent and a Codex agent can work in the same channel and give tasks to each other.",
    },
  ],
  sources: [
    { label: "Claude Code: desktop app", url: `${DOCS}/desktop` },
    { label: "Claude Code: desktop app on Linux", url: `${DOCS}/desktop-linux` },
    { label: "Claude Code: set up", url: `${DOCS}/setup` },
    { label: "Claude Code: overview", url: `${DOCS}/overview` },
    { label: "Claude Code on the web", url: `${DOCS}/claude-code-on-the-web` },
    { label: "Claude pricing", url: "https://claude.com/pricing" },
  ],
  checkedAt: "2026-10-03",
};
