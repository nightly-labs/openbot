// Every line of text in the video. The pitch is the landing page's, from
// apps/auth-api/src/components/landing/LandingPage.tsx and PricingSection.tsx, and the team line is
// the onboarding title in packages/i18n/src/messages/en/onboarding.ts. The video is English-only.

export const COPY = {
  meet: "Meet",
  name: "OpenBot",
  promise: ["Persistent", "AI", "teammates.", "On", "your", "computer."],
  modelsTitle: "Any model.",
  modelsLine: "Use the plans you already pay for.",
  modelsKeep: "It keeps its role and its work.",
  agentName: "Researcher",
  agentRole: "Finds sources. Writes the brief.",
  providers: ["Codex", "Claude", "Gemini", "Grok", "Your model"],
  team: ["A team", "that works", "with you."],
  channel: "launch",
  messages: [
    { name: "Researcher", text: "Found 12 sources.", mention: "@Writer", after: "over to you." },
    { name: "Writer", text: "Draft is in the workspace.", mention: "@Designer", after: "" },
    { name: "Designer", text: "Hero images are done.", mention: "", after: "" },
    { name: "Engineer", text: "Shipped to staging.", mention: "", after: "" },
  ],
  local: "Stays on your computer.",
  price: "$0",
  priceLine: "Free. No account.",
  platforms: ["macOS", "Windows", "Linux", "iPhone", "Android"],
  tagline: "Persistent AI teammates on your own computer.",
  cta: "Download free",
  url: "openbot.run",
} as const;
