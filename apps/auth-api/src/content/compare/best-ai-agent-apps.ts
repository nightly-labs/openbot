import { BENCHMARK_SOURCES, type RoundupComparison } from "./comparison";

const OPENBOT = "https://github.com/nightly-labs/openbot";

export const BEST_AI_AGENT_APPS: RoundupComparison = {
  kind: "roundup",
  answer:
    "An AI agent app is an app where an AI model does the task for you, not only answers: it reads and writes files, runs commands, uses a browser and keeps going until the work is done. For one coding agent on one AI plan, pick Claude Code, Codex, Cursor or Antigravity. For an agent that keeps working with your computer off, pick a cloud agent like Devin, Manus, Claude Cowork or ChatGPT dots. If you want several of these agents working together on your own computer, with plans you already pay for, that's what we built OpenBot for.",
  intro:
    "AI agent apps give a model tools and let it act. A chatbot answers a question; an AI agent app plans the steps, uses the tools and checks its own work. The 13 AI agent apps below differ in three ways: where the agent works (your computer or someone else's), which models it uses and who you pay for them, and how many agents can work together. After OpenBot, the list runs from coding agents to personal assistants. It's not a ranking.",
  apps: [
    {
      name: "OpenBot",
      mark: "openbot",
      comparisons: [],
      bestFor: "A team of agents on your own computer, with the AI plans you already pay for.",
      runsOn: "Your computer. Apps for macOS, Windows, Linux, iPhone and Android, and a web app.",
      models:
        "Your ChatGPT, Claude, Gemini, Grok, Cursor, Cline or Muse Code plan, free models, Inception's Mercury models, your own model, or any ACP agent.",
      price: "Free for noncommercial use. Hosted EU server from €30 or $36 a month.",
      summary:
        "OpenBot runs Codex, Claude Code, Antigravity, Grok CLI, Cursor CLI, Cline, OpenCode, Pi, Muse Code and custom ACP agents as one team on your computer. Each agent gets a job, and they pass work to each other in shared channels. When a plan hits its limit, an agent can move to a backup model on another provider. You follow along from the iPhone and Android apps or the web app, no VPN needed, and agents answer in Slack, Discord and Telegram too. Workspaces, chats and files stay in a database on your computer.",
    },
    {
      name: "Claude Code",
      mark: "claude-code",
      comparisons: ["codex-vs-claude-code", "claude-code-vs-antigravity", "cursor-vs-claude-code"],
      bestFor: "Claude's models in your terminal and your IDE.",
      runsOn: "Your computer, or cloud sessions at Anthropic.",
      models: "Claude models.",
      price: "Claude Pro from $17 a month billed yearly. Max $100, Ultra $200.",
      summary:
        "Anthropic's coding agent works in the terminal, VS Code, JetBrains IDEs, a desktop app and the web. Cloud sessions run in VMs that Anthropic manages, and you can follow them from the Claude phone app. Its best run on the Artificial Analysis Coding Agent Index scores 58 with Fable 5.2, one point behind Antigravity, for $15.47 a task. It also works with an Anthropic API key, Bedrock, Google Cloud and Microsoft Foundry.",
    },
    {
      name: "Codex",
      mark: "codex",
      comparisons: ["codex-vs-claude-code"],
      bestFor: "OpenAI's models, with a sandbox that is on by default.",
      runsOn: "Your computer, or cloud tasks at OpenAI.",
      models: "OpenAI models.",
      price: "ChatGPT Plus $20 a month. Pro $100, $200 or $500.",
      summary:
        "OpenAI's coding agent works in a command line, the ChatGPT desktop app, and VS Code, Cursor and Windsurf. The sandbox is on from the first run, and the command line is open source under Apache-2.0. Cloud tasks run in VMs that OpenAI manages. It's the cheap one on the benchmark: 50 for $0.90 a task with GPT-6.2 Sol, its default model, and 53 with GPT-6.2 Astra.",
    },
    {
      name: "Cursor",
      mark: "cursor",
      comparisons: ["cursor-vs-claude-code"],
      bestFor: "A full code editor with agents, and models from many providers.",
      runsOn: "Your computer, cloud virtual machines, or machines that you host.",
      models: "Grok and Composer models. Claude, GPT, Gemini, Muse and others from Premium, at API prices.",
      price: "Free. Plus $8 a month, Premium $30, Super $100 and Ultra $200.",
      summary:
        "Cursor is a code editor built from VS Code, with an Agents Window, a command line and cloud agents. SpaceX bought it in August 2026, and Grok 4.7 is now its flagship model. Since October 2026, its plans come with The X Subscription and share usage with Grok. Bugbot reviews pull requests, and an iPhone app follows cloud agents.",
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
        "Google's agent platform has a desktop app, a command line and an IDE for macOS, Windows and Linux, plus extensions for other editors. Its command line replaced Gemini CLI for personal plans, and it has the top score on the Artificial Analysis index, 59, with Gemini 4 Neon. A browser agent drives Chrome for you.",
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
        "Cognition's agent works in cloud VMs that keep going while your laptop is closed. You start it from Slack, Microsoft Teams, GitHub, Linear or Jira, and Devin Desktop and the Devin CLI run it on your computer. It doesn't take your own API keys, but on Pro, Max and Teams a personal ChatGPT plan can pay for its GPT models.",
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
        "OpenClaw is an open-source assistant that talks to you in WhatsApp, Telegram, Slack, Signal, iMessage or Discord. It runs on a computer you choose, with apps for desktop, iPhone and Android, and a big community writes plugins and skills for it.",
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
        "Nous Research's agent writes its own skills and searches its past conversations. You talk to it in Telegram, WhatsApp, Signal, Slack or email, or in its desktop app, terminal UI or web dashboard.",
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
        "Anthropic's agent keeps working in the cloud while your computer is off, and it runs scheduled tasks. You start and follow tasks in the Claude desktop app, on the web, or in the Claude apps for iPhone and Android.",
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
        "Manus is a general agent that works on its own cloud computer and runs many agents in parallel. You hand it tasks in its apps, on the web, or through Telegram, WhatsApp Business, LINE, Slack or email. It doesn't take your own AI plan or API key.",
    },
    {
      name: "ChatGPT dots",
      mark: "chatgpt-dots",
      comparisons: ["chatgpt-dots"],
      bestFor: "One always-on agent for ChatGPT Pro, Business and Enterprise users.",
      runsOn: "A cloud computer that OpenAI runs, or your computer if you allow it.",
      models: "GPT-6 Astra.",
      price:
        "Included with ChatGPT Pro, from $100 a month, and with Business and Enterprise. Coming to some Plus users.",
      summary:
        "A dot is an OpenAI agent with its own cloud computer running Linux and Chrome. You set it up in the ChatGPT phone or desktop app, or on the web, and talk to it in ChatGPT, Slack or Microsoft Teams. It isn't available in the European Economic Area, Switzerland or the UK.",
    },
    {
      name: "Grok Bot",
      mark: "grok-bot",
      comparisons: ["grok-bot"],
      bestFor: "Bots on a cloud computer, for X Subscription users.",
      runsOn: "A cloud computer that Cursor hosts, in the United States.",
      models: "Grok Bot picks the model for each task.",
      price: "Included with X Subscription Premium, Super and Ultra, and older paid Cursor and SuperGrok plans.",
      summary:
        "xAI's agent app runs your Bots on a cloud computer, so your own machine can stay off. If you approve it, it can also run tasks on your computer. There are apps for macOS, Windows, Linux, iPhone, iPad and Android.",
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
        "Meta's personal agent keeps working after you close the app. You reach it in its iPhone, Android and Mac apps, on the web, or in WhatsApp. It's only for adults (18+) in the US, Canada, the UK, Australia and Singapore. OpenBot runs Muse Code, Meta's coding agent, not this app.",
    },
  ],
  benchmark: {
    takeaway:
      "Four apps on this list are coding agents that Artificial Analysis tests. Since November 2026, the index is on version 2.1, with new tests and a new cost method. The best runs of Antigravity, Claude Code and Devin are within one point: 59, 58 and 58. Codex reaches 53. Cost per task varies far more than score: from $0.90 for Codex with GPT-6.2 Sol to $15.47 for Claude Code with Fable 5.2. OpenBot isn't on the index. It runs these agents rather than competing with them.",
    rows: [
      {
        agent: "antigravity",
        name: "Antigravity CLI",
        model: "Gemini 4 Neon (xhigh)",
        score: 59,
        costUsd: 6.86,
        minutes: 30.5,
      },
      {
        agent: "claude-code",
        name: "Claude Code",
        model: "Fable 5.2 (xhigh)",
        score: 58,
        costUsd: 15.47,
        minutes: 53.3,
      },
      {
        agent: "devin",
        name: "Devin Fusion CLI",
        model: "Claude Opus 5.5 Max + GPT-6 Luna High",
        score: 58,
        costUsd: 8.75,
        minutes: 54.9,
      },
      { agent: "codex", name: "Codex", model: "GPT-6.2 Astra (max)", score: 53, costUsd: 5.12, minutes: 25.1 },
      { agent: "codex", name: "Codex", model: "GPT-6.2 Sol (xhigh)", score: 50, costUsd: 0.9, minutes: 12.6 },
    ],
    checkedAt: "2026-11-27",
  },
  faq: [
    {
      question: "What is an AI agent app?",
      answer:
        "An AI agent app runs an AI model that acts, not only answers. You give it a task, and it plans the steps, reads and writes files, runs commands, uses a browser or your other apps, and checks the result. Some AI agent apps work on your own computer, like Claude Code, Codex and OpenBot. Others work on a cloud computer, like Devin, Manus and ChatGPT dots.",
    },
    {
      question: "What is the best AI agent app?",
      answer:
        "Depends where you want the agent to work and which AI plan you pay for. For coding with one model family, it's Claude Code, Codex, Cursor or Antigravity. On the Artificial Analysis index, Antigravity, Claude Code and Devin score highest, and Codex costs least per task. For an agent that works while your computer is off, Devin, Manus, Claude Cowork and ChatGPT dots run in the cloud. OpenBot runs several coding agents as one team on your own computer.",
    },
    {
      question: "Which AI agent apps are free?",
      answer:
        "OpenBot is free for noncommercial use, and OpenClaw and Hermes Agent are free under the MIT License. With all three, you still pay your model provider. Cursor, Antigravity, Devin, Manus and Muse have free plans. Codex comes with ChatGPT Free and Go, but only with GPT-6 Luna in the desktop app and no cloud tasks. Claude Code, Claude Cowork and ChatGPT dots need a paid plan.",
    },
    {
      question: "Which AI agents run on my own computer?",
      answer:
        "OpenBot, OpenClaw and Hermes Agent run on a computer you choose. Claude Code, Codex, Cursor and Antigravity run on your computer, and most also have a cloud option. ChatGPT dots, Manus, Muse, Grok Bot and Devin can use your computer too, but they work on a cloud computer by default.",
    },
    {
      question: "Can I use more than one AI agent at a time?",
      answer:
        "Yes. In OpenBot, Codex, Claude Code, Antigravity, Grok CLI, Cursor CLI, Cline, OpenCode, Pi and Muse Code work as agents on one team. Each one uses your own plan for its provider, and they hand work to each other in shared channels.",
    },
    {
      question: "Why is OpenBot first on this list?",
      answer:
        "Because we make it. Every other entry links to a comparison with its sources and the date we checked them.",
    },
  ],
  sources: [
    { label: "Claude Code overview", url: "https://code.claude.com/docs/en/overview" },
    { label: "Claude pricing", url: "https://claude.com/pricing" },
    { label: "Codex documentation", url: "https://learn.chatgpt.com/docs" },
    { label: "Codex pricing", url: "https://learn.chatgpt.com/docs/pricing" },
    { label: "Cursor pricing", url: "https://cursor.com/pricing" },
    { label: "Cursor models", url: "https://cursor.com/docs/models" },
    { label: "Cursor joins SpaceX", url: "https://cursor.com/blog/joining-spacex" },
    { label: "Antigravity", url: "https://antigravity.google/" },
    { label: "Antigravity pricing", url: "https://antigravity.google/pricing" },
    { label: "Devin pricing", url: "https://devin.ai/pricing" },
    { label: "Devin with your ChatGPT plan", url: "https://docs.devin.ai/admin/billing/chatgpt" },
    { label: "OpenClaw on GitHub", url: "https://github.com/openclaw/openclaw" },
    { label: "Hermes Agent on GitHub", url: "https://github.com/NousResearch/hermes-agent" },
    { label: "Claude Cowork", url: "https://claude.com/product/cowork" },
    { label: "Manus pricing", url: "https://manus.im/pricing" },
    { label: "Manus plans and credits", url: "https://help.manus.im/en/articles/11711111" },
    { label: "Dots in ChatGPT", url: "https://chatgpt.com/features/dots/" },
    {
      label: "Getting started with your dot",
      url: "https://help.openai.com/en/articles/20001530-getting-started-with-your-dot",
    },
    { label: "Grok Bot overview", url: "https://docs.x.ai/grok-bot/overview" },
    { label: "Grok Bot in the X Subscription", url: "https://docs.x.ai/x-subscription/grok-bot" },
    { label: "Grok Bot FAQ", url: "https://docs.x.ai/grok-bot/faq" },
    { label: "Meta: Introducing Muse", url: "https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/" },
    {
      label: "Meta: Muse in Singapore",
      url: "https://about.fb.com/news/2026/10/muse-is-now-available-in-singapore-the-worlds-first-personal-ai-agent-built-for-everyone/",
    },
    { label: "Meta: Muse in Australia", url: "https://about.fb.com/news/2026/11/muse-is-now-available-in-australia/" },
    {
      label: "Meta: Muse in the UK",
      url: "https://about.fb.com/news/2026/11/muse-now-available-in-the-uk-muse-does-the-work-you-stay-in-control/",
    },
    { label: "Muse subscription plans", url: "https://www.meta.com/help/subscriptions/1021145227643680/" },
    { label: "OpenBot privacy notes", url: `${OPENBOT}/blob/main/PRIVACY.md` },
    { label: "OpenBot source code", url: OPENBOT },
    ...BENCHMARK_SOURCES,
  ],
  checkedAt: "2026-11-27",
};
