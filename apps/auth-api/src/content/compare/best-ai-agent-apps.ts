import type { RoundupComparison } from "./comparison";

// Every statement about another app here repeats a statement on the comparison that
// includes it, where each claim has its own sources and check date. When one of those
// pages changes, change the entry here too, and move `checkedAt`. `sources` lists the
// official home or pricing page of each app.

const OPENBOT = "https://github.com/nightly-labs/openbot";

export const BEST_AI_AGENT_APPS: RoundupComparison = {
  kind: "roundup",
  answer:
    "Choose a coding agent, such as Claude Code, Codex, Cursor or Antigravity, if you want one agent with one AI plan. Choose a cloud agent, such as Devin, Manus, Claude Cowork or ChatGPT dots, if you want it to work with no computer of yours on. Choose OpenBot if you want several of these agents on your own computer, with the plans you already pay for, as one team.",
  intro:
    "An AI agent app gives a model tools: it reads and writes files, runs commands, browses the web and works until the task is done. The apps here differ in three ways: where the agent works (your computer or a cloud computer), which models it can use and who you pay for them, and how many agents work together. After OpenBot, the list goes from coding agents to personal assistants. The order is not a rank.",
  apps: [
    {
      name: "OpenBot",
      mark: "openbot",
      comparisons: [],
      bestFor: "A team of agents on your own computer, with the AI plans you already pay for.",
      runsOn: "Your computer. Apps for macOS, Windows, Linux, iPhone and Android.",
      models: "Your ChatGPT, Claude, Gemini, Grok or Cursor plan, free models, or your own model.",
      price: "Free for noncommercial use. Hosted EU server from €20 or $25 a month.",
      summary:
        "OpenBot runs Codex, Claude Code, Antigravity, Grok CLI, Cursor CLI and OpenCode as one team on your computer. Each agent has its own job, and the agents give work to each other in shared channels. You follow them from the iPhone and Android apps, with no VPN. Workspaces, chats and files stay in a database on your computer. No account is necessary on one computer.",
    },
    {
      name: "Claude Code",
      mark: "claude-code",
      comparisons: ["codex-vs-claude-code", "claude-code-vs-antigravity", "cursor-vs-claude-code"],
      bestFor: "Claude's models in your terminal and your IDE.",
      runsOn: "Your computer, or cloud sessions at Anthropic.",
      models: "Claude models only.",
      price: "Claude Pro from $17 a month billed yearly. Max $100 or $200.",
      summary:
        "Anthropic's coding agent works in the terminal, in VS Code and JetBrains IDEs, in a desktop app and on the web. Cloud sessions run in virtual machines that Anthropic manages, and the Claude app for iPhone and Android follows them. It also works with an Anthropic API key, Amazon Bedrock, Google Cloud and Microsoft Foundry.",
    },
    {
      name: "Codex",
      mark: "codex",
      comparisons: ["codex-vs-claude-code"],
      bestFor: "OpenAI's models, with a sandbox that is on by default.",
      runsOn: "Your computer, or cloud tasks at OpenAI.",
      models: "OpenAI models only.",
      price: "ChatGPT Plus $20 a month. Pro $100, $200 or $500.",
      summary:
        "OpenAI's coding agent works in a command line, in the ChatGPT desktop app and in VS Code, Cursor and Windsurf. Its operating-system sandbox is on by default, and its command line is open source under Apache-2.0. Cloud tasks run in virtual machines that OpenAI manages.",
    },
    {
      name: "Cursor",
      mark: "cursor",
      comparisons: ["cursor-vs-claude-code"],
      bestFor: "A full code editor with agents, and models from many providers.",
      runsOn: "Your computer, cloud virtual machines, or machines that you host.",
      models: "Grok, Composer, Claude, GPT, Gemini and Muse models.",
      price: "Hobby is free. Pro $20 a month, Pro+ $60 and Ultra $200.",
      summary:
        "Cursor is a code editor built from VS Code, with an Agents Window, a command line and cloud agents. SpaceX acquired it in August 2026, and Grok 4.7 is its flagship model. Bugbot reviews pull requests, and an iPhone app follows cloud agents.",
    },
    {
      name: "Antigravity",
      mark: "antigravity",
      comparisons: ["claude-code-vs-antigravity"],
      bestFor: "Gemini models, with a free plan to start.",
      runsOn: "Your computer. Remote Control connects a browser to it.",
      models: "Gemini models, with Claude Sonnet 5.5 and Opus 5.5 on Pro and Ultra.",
      price: "Free with weekly limits. Google AI Pro $19.99 a month.",
      summary:
        "Google's agent app has a desktop app, a command line and an IDE for macOS, Windows and Linux, with extensions for other editors. Its command line replaces Gemini CLI. A browser agent controls Chrome.",
    },
    {
      name: "Devin",
      mark: "devin",
      comparisons: ["devin"],
      bestFor: "An autonomous software engineer in the cloud.",
      runsOn: "Virtual machines in Cognition's cloud, or your computer.",
      models: "Models from Anthropic, OpenAI, Google, Cognition and open-source labs.",
      price: "Free with a light quota. Pro $20 a month, Max $200.",
      summary:
        "Cognition's agent works in cloud virtual machines that keep working while your laptop is closed. You start it from Slack, Microsoft Teams, GitHub, Linear or Jira, and Devin Desktop and the Devin CLI run it on your computer. It does not take your own API keys.",
    },
    {
      name: "OpenClaw",
      mark: "openclaw",
      comparisons: ["openclaw"],
      bestFor: "An open-source personal assistant in your messaging apps.",
      runsOn: "Your computer, a home server or a VPS that you rent.",
      models: "Your ChatGPT, Claude Code, SuperGrok or Copilot login, API keys, or local models.",
      price: "Free under the MIT License.",
      summary:
        "OpenClaw is an open-source assistant that talks to you in WhatsApp, Telegram, Slack, Signal, iMessage or Discord. It runs on a computer that you choose, with apps for desktop, iPhone and Android, and a large community makes plugins and skills for it.",
    },
    {
      name: "Hermes Agent",
      mark: "hermes-agent",
      comparisons: ["hermes-agent"],
      bestFor: "An open-source agent that learns skills over time.",
      runsOn: "Your computer, a server, Docker, or Hermes Cloud.",
      models: "API keys from many providers, local models, or a ChatGPT, SuperGrok or Copilot login.",
      price: "Free under the MIT License. Hermes Cloud costs extra.",
      summary:
        "Nous Research's agent makes its own skills and searches its past conversations. You talk to it in Telegram, WhatsApp, Signal, Slack or email, or in its desktop app, terminal UI and web dashboard.",
    },
    {
      name: "Claude Cowork",
      mark: "claude-cowork",
      comparisons: ["claude-cowork"],
      bestFor: "Claude as an agent for knowledge work, in Anthropic's cloud.",
      runsOn: "Anthropic's cloud.",
      models: "Claude models only.",
      price: "A paid Claude plan: Pro from $17 a month, Max from $100.",
      summary:
        "Anthropic's agent keeps working in the cloud with no computer of yours on, and runs scheduled tasks. You start and follow tasks in the Claude desktop app, on the web and in the Claude apps for iPhone and Android.",
    },
    {
      name: "Manus",
      mark: "manus",
      comparisons: ["manus"],
      bestFor: "Research, websites and slides from one prompt.",
      runsOn: "A cloud sandbox that Manus runs, or folders on your computer that you allow.",
      models: "Manus chooses the model for each task.",
      price: "Free with 300 credits a day. Pro from $20 a month.",
      summary:
        "Manus is a general agent that works in its own cloud computer and runs many agents in parallel. You give it tasks in its apps, the web, Telegram, WhatsApp Business, LINE, Slack or email. It does not take your own AI plan or API key.",
    },
    {
      name: "ChatGPT dots",
      mark: "chatgpt-dots",
      comparisons: ["chatgpt-dots"],
      bestFor: "One always-on agent for ChatGPT Pro and Business Premium users.",
      runsOn: "A cloud computer that OpenAI runs, or your computer if you allow it.",
      models: "GPT-6 Astra.",
      price: "Included with ChatGPT Pro, from $100 a month.",
      summary:
        "A dot is an OpenAI agent with its own cloud computer, with Linux and Chrome. You create it in the ChatGPT desktop app or on the web, and talk to it in the ChatGPT mobile app, Slack or Microsoft Teams. On Pro, it is not available in the European Economic Area, Switzerland or the UK.",
    },
    {
      name: "Grok Bot",
      mark: "grok-bot",
      comparisons: ["grok-bot"],
      bestFor: "Bots on a cloud computer, for Cursor and SuperGrok users.",
      runsOn: "A cloud computer that Cursor hosts, in the United States.",
      models: "Cursor manages model selection.",
      price: "Included with paid Cursor plans and SuperGrok.",
      summary:
        "xAI's agent app runs your Bots on a cloud computer, so you keep no computer of your own on. With approval, it can also run tasks on your computer. It has apps for macOS, Windows, Linux, iPhone, iPad and Android.",
    },
    {
      name: "Muse",
      mark: "muse",
      comparisons: ["muse"],
      bestFor: "A personal assistant for email and purchases.",
      runsOn: "A cloud computer that Meta hosts.",
      models: "Muse Spark, Meta's own model.",
      price: "Free with a weekly limit. $20 or $100 a month.",
      summary:
        "Meta's personal agent keeps working after you close the app. You reach it in its iPhone, Android and Mac apps, on the web and in WhatsApp. It is only for people 18 and over in the US and Canada.",
    },
  ],
  faq: [
    {
      question: "What is the best AI agent app?",
      answer:
        "It depends on where you want the agent to work and which AI plan you pay for. For coding with one model family, Claude Code, Codex, Cursor and Antigravity are the main choices. For an agent that works with no computer of yours on, Devin, Manus, Claude Cowork and ChatGPT dots work in the cloud. OpenBot runs several coding agents as one team on your own computer.",
    },
    {
      question: "Which AI agent apps are free?",
      answer:
        "OpenBot is free for noncommercial use, and OpenClaw and Hermes Agent are free under the MIT License; with all three, you pay your model provider. Cursor, Antigravity, Devin, Manus and Muse have free plans. Claude Code, Codex, Claude Cowork and ChatGPT dots need a paid plan.",
    },
    {
      question: "Which AI agents run on my own computer?",
      answer:
        "OpenBot, OpenClaw and Hermes Agent run on a computer that you choose. Claude Code, Codex, Cursor and Antigravity run on your computer, and most of them also have a cloud option. ChatGPT dots, Manus, Muse, Grok Bot and Devin can also use your computer, but they work in a cloud computer by default.",
    },
    {
      question: "Can I use more than one AI agent at a time?",
      answer:
        "Yes. In OpenBot, Codex, Claude Code, Antigravity, Grok CLI, Cursor CLI and OpenCode work as agents in one team. Each agent uses your own plan for its provider, and the agents give work to each other in shared channels.",
    },
    {
      question: "Why is OpenBot first on this list?",
      answer:
        "We make OpenBot. The other entries link to comparisons that give their sources and the date we checked them.",
    },
  ],
  sources: [
    { label: "Claude Code overview", url: "https://code.claude.com/docs/en/overview" },
    { label: "Claude pricing", url: "https://claude.com/pricing" },
    { label: "Codex documentation", url: "https://learn.chatgpt.com/docs" },
    { label: "Codex pricing", url: "https://learn.chatgpt.com/docs/pricing" },
    { label: "Cursor pricing", url: "https://cursor.com/pricing" },
    { label: "Cursor joins SpaceX", url: "https://cursor.com/blog/joining-spacex" },
    { label: "Antigravity", url: "https://antigravity.google/" },
    { label: "Antigravity pricing", url: "https://antigravity.google/pricing" },
    { label: "Devin pricing", url: "https://devin.ai/pricing" },
    { label: "OpenClaw on GitHub", url: "https://github.com/openclaw/openclaw" },
    { label: "Hermes Agent on GitHub", url: "https://github.com/NousResearch/hermes-agent" },
    { label: "Claude Cowork", url: "https://claude.com/product/cowork" },
    { label: "Manus pricing", url: "https://manus.im/pricing" },
    { label: "Dots in ChatGPT", url: "https://chatgpt.com/features/dots/" },
    { label: "Grok Bot overview", url: "https://docs.x.ai/grok-bot/overview" },
    { label: "Meta: Introducing Muse", url: "https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/" },
    { label: "Muse subscription plans", url: "https://www.meta.com/help/subscriptions/1021145227643680/" },
    { label: "OpenBot privacy notes", url: `${OPENBOT}/blob/main/PRIVACY.md` },
    { label: "OpenBot source code", url: OPENBOT },
  ],
  checkedAt: "2026-10-03",
};
