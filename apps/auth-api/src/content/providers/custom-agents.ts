import type { ProviderPage } from "./provider-page";

// Every statement about the Agent Client Protocol and the agents here is taken from
// agentclientprotocol.com and each agent's own documentation. Each page used is in
// `sources`. The presets are in packages/contracts/src/acp-agent-presets.ts. Check the
// sources again, and move `checkedAt`, whenever this file changes.

const ACP = "https://agentclientprotocol.com/get-started";

export const CUSTOM_AGENTS_PROVIDER: ProviderPage = {
  provider: "acp",
  name: "Goose, Qwen Code or Copilot CLI",
  answer:
    "OpenBot runs any agent that speaks the Agent Client Protocol as one agent of a team, such as Goose, Qwen Code or GitHub Copilot CLI. You get shared channels with agents on other providers, and an app on your phone.",
  connect:
    "Add a custom agent and type the command that starts it, or pick an agent that OpenBot finds on your computer or in the ACP registry. Check agent starts the command once to make sure that the agent answers. Each agent signs in with its own command.",
  adds: [
    {
      icon: "puzzle",
      title: "Presets for known agents",
      text: "Presets fill in the start command for Goose, Qwen Code, GitHub Copilot CLI and Oh My Pi.",
    },
    {
      icon: "download",
      title: "The ACP registry",
      text: "Search, install, update and remove agents from the ACP registry on the computer that runs OpenBot.",
    },
    {
      icon: "lock",
      title: "Encrypted settings",
      text: "OpenBot keeps the environment variables of each agent, such as an API key, encrypted.",
    },
  ],
  vendor: "their makers",
  officialApps: [
    {
      name: "Goose",
      platforms: "macOS, Linux, Windows",
      note: "An open-source agent with a desktop app and a CLI. Apache 2.0.",
    },
    {
      name: "Qwen Code",
      platforms: "Terminal",
      note: "Qwen's coding agent. Its free tier ended on 2026-04-15.",
    },
    {
      name: "GitHub Copilot CLI",
      platforms: "Terminal",
      note: "GitHub's terminal agent. Its ACP server is in public preview.",
    },
    {
      name: "Oh My Pi",
      platforms: "Terminal",
      note: "A fork of Pi. MIT license.",
    },
  ],
  comparisons: [],
  faq: [
    {
      question: "What is the Agent Client Protocol?",
      answer:
        "The Agent Client Protocol (ACP) is an open protocol between apps and coding agents. A local agent talks JSON-RPC over its standard input and output. Zed and JetBrains govern it.",
    },
    {
      question: "Which agents work in OpenBot?",
      answer:
        "Any agent that speaks ACP over standard input and output. OpenBot has presets for Goose, Qwen Code, GitHub Copilot CLI and Oh My Pi, and finds more in the ACP registry.",
    },
    {
      question: "Can I send a message while a custom agent works?",
      answer:
        "Yes. The message waits until the current turn ends, and then the agent gets it. A custom agent works on one turn at a time.",
    },
    {
      question: "Does GitHub Copilot CLI need a paid plan?",
      answer: "No. GitHub's Free plan includes the Copilot CLI, with limited use.",
    },
  ],
  sources: [
    { label: "Agent Client Protocol: introduction", url: `${ACP}/introduction` },
    { label: "Agent Client Protocol: agents", url: `${ACP}/agents` },
    { label: "Agent Client Protocol: registry", url: `${ACP}/registry` },
    { label: "Agent Client Protocol: governance", url: "https://agentclientprotocol.com/community/governance" },
    { label: "Goose", url: "https://goose-docs.ai/" },
    { label: "Qwen Code sign-in", url: "https://qwenlm.github.io/qwen-code-docs/en/users/configuration/auth/" },
    {
      label: "GitHub Copilot CLI ACP server",
      url: "https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server",
    },
    { label: "GitHub Copilot plans", url: "https://github.com/features/copilot/plans" },
    { label: "Oh My Pi on GitHub", url: "https://github.com/can1357/oh-my-pi" },
  ],
  checkedAt: "2026-10-24",
};
