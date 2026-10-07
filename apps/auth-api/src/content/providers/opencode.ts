import type { ProviderPage } from "./provider-page";

// Every statement about OpenCode here is taken from opencode.ai and OpenCode's GitHub
// repository. Each page used is in `sources`. Check them again, and move `checkedAt`,
// whenever this file changes.

const DOCS = "https://opencode.ai/docs";

export const OPENCODE_PROVIDER: ProviderPage = {
  provider: "opencode",
  name: "OpenCode",
  answer:
    "OpenBot runs OpenCode as one agent of a team, on macOS, Windows or Linux, with its free models and no account. You get shared channels with agents on other providers, and an app on your phone.",
  connect:
    "Choose OpenCode, and OpenBot downloads and pins its own copy of OpenCode, or uses the one you installed. The free models need no sign-in. For more models, add an OpenCode Go key.",
  adds: [
    {
      icon: "heart",
      title: "Free to start",
      text: "OpenCode's free models need no account and no key, so a new agent works as soon as OpenCode is downloaded.",
    },
    {
      icon: "cpu",
      title: "Your own models",
      text: "OpenBot runs OpenCode on any OpenAI-compatible server too, such as Ollama or LM Studio on your computer.",
    },
  ],
  vendor: "OpenCode",
  officialApps: [
    {
      name: "OpenCode in the terminal",
      platforms: "macOS, Linux, Windows. WSL is recommended on Windows",
      note: "The terminal agent. It also speaks the Agent Client Protocol.",
    },
    {
      name: "OpenCode desktop app",
      platforms: "macOS, Windows x64, Linux. In beta",
      note: "OpenCode in a window.",
    },
    {
      name: "OpenCode web",
      platforms: "Your browser",
      note: "`opencode web` starts a local server and opens it in the browser.",
    },
    {
      name: "IDE extensions",
      platforms: "VS Code, Cursor, Zed, Windsurf, VSCodium",
      note: "OpenCode in the editor you already use.",
    },
  ],
  comparisons: ["best-ai-agent-apps"],
  faq: [
    {
      question: "Is there a GUI for OpenCode?",
      answer:
        "Yes. OpenCode has a desktop app in beta and a web interface that runs on your computer. OpenBot is a different desktop app: it runs OpenCode as one agent of a team, with agents on other providers and an app on your phone.",
    },
    {
      question: "Is OpenCode in OpenBot free?",
      answer:
        "Yes, with OpenCode's free models: they need no account. OpenCode Go, at $10 a month, and Go Plus, at $40, give reliable use of open coding models. Both are optional.",
    },
    {
      question: "Does OpenCode need WSL on Windows?",
      answer:
        "OpenCode recommends WSL for its own terminal app on Windows. OpenBot downloads the native Windows x64 build of OpenCode and runs it for you, with no WSL.",
    },
    {
      question: "Can OpenCode run a model on my computer?",
      answer:
        "Yes. In OpenBot, OpenCode runs any OpenAI-compatible server as a custom provider, such as Ollama or LM Studio on your computer.",
    },
  ],
  sources: [
    { label: "OpenCode: introduction", url: `${DOCS}/` },
    { label: "OpenCode: download", url: "https://opencode.ai/download" },
    { label: "OpenCode: web", url: `${DOCS}/web/` },
    { label: "OpenCode: Agent Client Protocol", url: `${DOCS}/acp/` },
    { label: "OpenCode Zen", url: `${DOCS}/zen/` },
    { label: "OpenCode Go", url: `${DOCS}/go/` },
    { label: "OpenCode on GitHub", url: "https://github.com/anomalyco/opencode" },
  ],
  checkedAt: "2026-10-03",
};
