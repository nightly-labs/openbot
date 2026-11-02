import type { ProviderPage } from "./provider-page";

// Every statement about Inception and Mercury here is taken from inceptionlabs.ai and
// Inception's documentation. Each page used is in `sources`. OpenBot runs Mercury in its own
// copy of Pi (`src/backend/pi-key-providers.ts`). Check the sources again, and move `checkedAt`,
// whenever this file changes.

const DOCS = "https://docs.inceptionlabs.ai/get-started";

export const INCEPTION_PROVIDER: ProviderPage = {
  provider: "inception",
  name: "Inception",
  answer:
    "OpenBot runs Inception's Mercury models as one agent of a team, on macOS, Windows or Linux, with an Inception API key. You get shared channels with agents on other providers.",
  connect:
    "Download Pi in OpenBot first: Mercury runs in OpenBot's copy of Pi. Then select Connect on the Inception row and paste an Inception API key. OpenBot keeps the key encrypted and does not change Pi's own settings.",
  adds: [
    {
      icon: "cpu",
      title: "Three Mercury models",
      text: "Choose Mercury 3, with a context of 1 million tokens, or Mercury 2.5 or Mercury 2.",
    },
    {
      icon: "lock",
      title: "Your key stays in OpenBot",
      text: "OpenBot keeps the Inception API key in its encrypted store, not in Pi's settings files.",
    },
  ],
  vendor: "Inception",
  officialApps: [
    {
      name: "Mercury Chat",
      platforms: "Your browser",
      note: "A chat with the Mercury models.",
    },
    {
      name: "Inception API Platform",
      platforms: "Your browser, and any OpenAI-compatible client",
      note: "API keys and use of the Mercury models.",
    },
  ],
  comparisons: ["best-ai-agent-apps"],
  faq: [
    {
      question: "What is Mercury?",
      answer:
        "Mercury is Inception's family of diffusion language models. They make tokens in parallel, at more than 1,000 tokens a second, Inception says. Mercury 3 came out on 19 October 2026, with a context of 1 million tokens.",
    },
    {
      question: "How much does Mercury cost?",
      answer:
        "For each million tokens, Mercury 3 costs $0.10 for input and $0.35 for output, at 50% off for its launch. Mercury 2.5 costs $0.20 and $0.75, and Mercury 2 costs $0.25 and $0.75. New accounts get 100 million free tokens.",
    },
    {
      question: "Why does Inception need Pi?",
      answer:
        "OpenBot runs Mercury in its own copy of Pi. Download Pi once in OpenBot, and Inception agents then use it with your Inception API key.",
    },
    {
      question: "Can I use Inception agents from my phone or share them with a team?",
      answer:
        "Yes. An Inception agent runs on the computer that has your Inception API key, and you use it from your phone or share it with your team like any other agent. On a server, an owner or admin saves the key in the server's provider settings.",
    },
  ],
  sources: [
    { label: "Inception", url: "https://inceptionlabs.ai" },
    { label: "Inception: models and prices", url: `${DOCS}/models` },
    { label: "Inception: get started", url: `${DOCS}/get-started` },
    { label: "Inception: introducing Mercury 3", url: "https://www.inceptionlabs.ai/blog/introducing-mercury-3" },
  ],
  checkedAt: "2026-10-24",
};
