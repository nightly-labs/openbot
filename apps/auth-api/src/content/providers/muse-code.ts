import type { ProviderPage } from "./provider-page";

// Every statement about Muse Code here is taken from dev.meta.ai. Each page used is in
// `sources`. Muse Code is Meta's coding agent; the Muse app, Meta's personal agent, is on
// /compare/muse. Check the sources again, and move `checkedAt`, whenever this file changes.

const DOCS = "https://dev.meta.ai/docs";

export const MUSE_CODE_PROVIDER: ProviderPage = {
  provider: "muse",
  name: "Muse Code",
  answer:
    "OpenBot runs Muse Code, Meta's coding agent, as one agent of a team, on macOS, Windows or Linux, with your Meta account or a Meta API key. You get shared channels with agents on other providers, and an app on your phone.",
  connect:
    "Choose Muse, and OpenBot downloads and pins its own copy of Muse Code. Sign in with your Meta account in the browser, or save a Meta API key.",
  adds: [
    {
      icon: "cpu",
      title: "Meta's models",
      text: "A Muse Code agent uses the Meta models that Muse Code lists, such as Muse Spark 1.3.",
    },
    {
      icon: "contact",
      title: "Steer it while it works",
      text: "Send a message while a Muse Code agent works, and the message changes the course of the current turn.",
    },
  ],
  vendor: "Meta",
  officialApps: [
    {
      name: "Muse Code in the terminal",
      platforms: "macOS, Linux, Windows",
      note: "The terminal agent. `muse exec` runs it with no interface, and `muse serve` runs it as a server.",
    },
    {
      name: "Muse Code SDK",
      platforms: "TypeScript. In developer preview",
      note: "The engine behind the CLI, for your own program.",
    },
  ],
  comparisons: ["muse"],
  faq: [
    {
      question: "Is Muse Code the same as the Muse app?",
      answer:
        "No. Muse Code is Meta's coding agent for the terminal. The Muse app is Meta's personal agent on a cloud computer. OpenBot runs Muse Code, and OpenBot vs Muse compares OpenBot with the app.",
    },
    {
      question: "Is there a GUI for Muse Code?",
      answer:
        "Meta ships Muse Code for the terminal and as an SDK, with no desktop app. OpenBot is a desktop app that runs Muse Code as one agent of a team, with agents on other providers and an app on your phone.",
    },
    {
      question: "How much does Muse Code cost?",
      answer:
        "Meta's plans cost $5, $15, $50 and $200 a month, and each one gives more use. By default, a plan is in Contributor mode: you get more use, and Meta can train on your content. You can also pay for each token with a Meta API key. Prices can be different in your region.",
    },
  ],
  sources: [
    { label: "Meta: Muse Code", url: "https://dev.meta.ai/products/muse-code/" },
    { label: "Muse Code documentation", url: `${DOCS}/muse-code/` },
    { label: "Muse Code sign-in", url: `${DOCS}/muse-code/auth` },
    { label: "Muse Code subscriptions", url: `${DOCS}/muse-code/subscriptions` },
    { label: "Meta Model API prices and rate limits", url: `${DOCS}/pricing-rate-limits` },
    {
      label: "Meta: Muse Code plans and features",
      url: "https://dev.meta.ai/resources/blog/muse-code-new-plans-and-features",
    },
  ],
  checkedAt: "2026-10-24",
};
