import { OPENBOT_LINKS } from "../../lib/landing-links";
import type { Comparison } from "./comparison";

// Every statement about Hermes Agent here is taken from the Hermes Agent documentation,
// its repository or Nous Research's own pages, and each page used is in `sources`.
// Where they state nothing, the text says so. Check them again, and move `checkedAt`,
// whenever this file changes. Statements about OpenBot follow its privacy notes and
// the remote connection that `remote/README.md` describes.

const HERMES_DOCS = "https://hermes-agent.nousresearch.com/docs";

export const HERMES_AGENT_COMPARISON: Comparison = {
  rival: { name: "Hermes Agent", mark: "hermes-agent" },
  answer:
    "Both apps run AI agents on your own computer, and neither needs an account. Choose OpenBot if you want Codex, Claude Code, Gemini and Grok CLI to work as a team with the plans you already pay for, including Claude Pro or Max and Google AI Pro, and to reach them from iPhone and Android apps. Choose Hermes Agent if you want an open-source agent under the MIT license that learns skills over time and talks to you in messaging apps such as Telegram or WhatsApp.",
  chooseOpenBot: [
    "You pay for Claude Pro or Max, or Google AI Pro or Ultra, and want your agents to use that plan.",
    "You want Codex, Claude Code, Gemini, Grok CLI and Cursor CLI as agents in one team, each with its own job.",
    "You want iPhone and Android apps that connect to your own computer.",
    "Coworkers must join your agents on one team host, with shared channels and files.",
  ],
  rivalPlans:
    "Hermes Agent uses API keys from many providers, and signs in with ChatGPT, SuperGrok or GitHub Copilot. As its model, a Claude plan works only on Max with extra usage credits, and a consumer Gemini plan does not work.",
  chooseRival: [
    "You want an agent that makes its own skills and searches its past conversations.",
    "You want to talk to it in Telegram, WhatsApp, Signal, Slack or email.",
    "You need the MIT license, for example for commercial use.",
    "You want Nous Research to host it for you in Hermes Cloud.",
  ],
  rows: [
    {
      icon: "cpu",
      topic: "Models and plans",
      openbot:
        "Use the plans you already have: ChatGPT, Claude, Gemini, Grok or Cursor. Or run free models and your own model through OpenCode. Choose one for each agent, and change it later.",
      rival:
        "API keys from many providers, OpenRouter, and local models. Sign in with ChatGPT, SuperGrok or GitHub Copilot. As its model, a Claude plan works only on Max with extra usage credits; a consumer Gemini plan does not work.",
      better: "openbot",
    },
    {
      icon: "laptop",
      topic: "Where agents work",
      openbot: "On the computer that runs OpenBot.",
      rival:
        "On your computer, a server, or in Docker. Hermes Cloud, which Nous Research hosts, costs a daily price plus the models you use.",
    },
    {
      icon: "cloud",
      topic: "When your computer is off",
      openbot:
        "Agents keep working on the computer or server that runs OpenBot, and routines start them on a schedule. If you do not want to keep a computer on, use a hosted OpenBot server in the EU, from €20 or $25 a month.",
      rival:
        "Scheduled tasks run on the server or cloud computer that runs Hermes. On a laptop, they stop while Hermes is stopped.",
    },
    {
      icon: "phone",
      topic: "Remote access",
      openbot:
        "Apps for iPhone and Android. Chats and files go over an encrypted connection between your devices, and no cloud stores them.",
      rival:
        "Messaging apps such as Telegram, WhatsApp, Signal and Slack, which carry your messages. No native iPhone or Android app is stated.",
      better: "openbot",
    },
    {
      icon: "users",
      topic: "Teams",
      openbot:
        "Each agent is a full coding agent with its own job. They give work to each other in shared channels, and coworkers can join one team host.",
      rival:
        "10 subagents at once by default, and you can set more. Bots with their own roles talk in group chats of up to six. Several people can use one Hermes instance through messaging apps, with an allowlist.",
      better: "openbot",
    },
    {
      icon: "lock",
      topic: "Your data",
      openbot:
        "Workspaces, chats and files stay in a database on your computer. The provider you choose gets the requests you send.",
      rival:
        "Conversations, memory and skills stay in ~/.hermes on your computer, with no telemetry. The provider you choose gets the requests you send.",
    },
    {
      icon: "tag",
      topic: "Price and account",
      openbot:
        "Free for noncommercial use; commercial use needs a license. No account is necessary on one computer. Your agents use the plans you already pay for.",
      rival:
        "Free under the MIT license, also for commercial use. No account is necessary. You pay your model provider, and Hermes Cloud if you use it.",
      better: "rival",
    },
    {
      icon: "globe",
      topic: "Where you can use it",
      openbot:
        "In any country: OpenBot has no region lock. The desktop app is in English, French, Japanese and Turkish, and hosted servers run in the EU. Each AI provider sets the countries for its own plan.",
      rival:
        "Anywhere: you run it yourself. Hermes Cloud uses the nearest of 14 locations in Europe, North America, Asia and Australia. The interface is in 17 languages.",
    },
    {
      icon: "devices",
      topic: "Apps",
      openbot: "macOS, Windows and Linux, and mobile apps for iPhone and Android.",
      rival:
        "A command line, a terminal UI, a web dashboard, and Hermes Desktop for macOS, Windows and Linux. The command line also runs on Android in Termux. No iPhone or Android app is stated.",
    },
    {
      icon: "code",
      topic: "Source code",
      openbot: "On GitHub, under the PolyForm Noncommercial License 1.0.0.",
      rival: "On GitHub, under the MIT License.",
    },
  ],
  intro:
    "OpenBot and Hermes Agent are close: both run AI agents on the computer that you choose, keep your chats there, work without an account, and publish their source code. The difference is what an agent is. In OpenBot, each agent is a coding tool from the provider whose plan you pay for, and the agents work as a team. Hermes Agent is its own agent that calls a model through an API, learns skills as it works, and can run several named Bots.",
  sections: [
    {
      title: "Models and the plans you pay for",
      openbot:
        "OpenBot runs the provider tools you already use, with the plans you already pay for: Codex with your ChatGPT plan, Claude Code with your Claude plan, Gemini with your Google AI Pro or Ultra plan, Grok CLI with your Grok account or an xAI API key, and Cursor CLI with your Cursor plan or a Cursor API key. OpenCode runs free models, or your own model on any OpenAI-compatible server, also one on your computer. You choose the provider, the model and the reasoning effort for each agent. When you move an agent to a different provider, it keeps its role, workspace and conversation.",
      rival:
        "Hermes Agent calls a model through an API. It works with many providers, OpenRouter and Nous Portal, and with local models on any OpenAI-compatible server, such as Ollama or vLLM. It can sign in with a ChatGPT account, a SuperGrok or X Premium+ subscription, or GitHub Copilot. As its own model, a Claude plan works only on Max, and then it uses only the extra usage credits that you buy; with Claude Pro, you need an API key. There is no way to use a consumer Gemini plan: Gemini needs a Google API key.",
      better: "openbot",
    },
    {
      title: "Where the work happens",
      openbot:
        "OpenBot runs on the computer that hosts it. Agent workspaces, conversations and app data stay on that computer, so it must stay on while its agents work. Run it on a desktop or a server that stays on, and your agents keep working while your laptop is closed. If you do not want to keep a computer on, use a hosted OpenBot server. It is a Linux server in the EU (Germany, Finland or France), from €20 or $25 a month, and it keeps the workspaces and chats of its agents. Local-first is not offline: an agent that uses a hosted provider still sends its requests to that provider.",
      rival:
        "Hermes Agent runs on your computer, on a server, or in Docker. Its commands can run on that computer, in Docker, over SSH, or in cloud sandboxes such as Modal and Daytona. Hermes Cloud runs it on a computer that Nous Research hosts, for a daily price, and the models and tools it uses cost extra. On a laptop, tasks stop while Hermes is stopped.",
    },
    {
      title: "Phones and remote access",
      openbot:
        "The OpenBot apps for iPhone and Android connect to the computer that runs your agents. From anywhere, you chat with them, follow their progress and send files. The connection goes directly between your devices when it can, it is encrypted, and no cloud stores your chats or files. Remote access needs an OpenBot account.",
      rival:
        "Hermes Agent reaches your phone through messaging apps: Telegram, WhatsApp, Signal, Slack, SMS, email, iMessage through BlueBubbles, and many more. Your messages then go through the messaging service that you choose. Hermes Desktop can also connect to a Hermes backend on another computer. The documentation states no native iPhone or Android app.",
      better: "openbot",
    },
    {
      title: "How agents work as a team",
      openbot:
        "In OpenBot, each agent is a full coding agent: Codex, Claude Code, Gemini, Grok CLI, Cursor CLI or OpenCode, each with its own job and workspace. A lead agent can give parts of a task to other agents in a shared channel. You follow their work and step in when a decision needs you. For a team of people, one computer runs the host and the others join it; the chats and files stay on the host.",
      rival:
        "Hermes Agent starts up to 10 subagents at once by default, and you can set a higher limit. In Bot Mode, each Bot has its own role, model, memory and skills; Bots talk in group chats of up to six and send messages to each other. Bundled skills can give coding work to Claude Code, Codex or OpenCode. Several people can use one Hermes instance through messaging apps such as Slack or Telegram, and an allowlist controls who can talk to it.",
      better: "openbot",
    },
    {
      title: "Data and privacy",
      openbot:
        "OpenBot keeps workspaces, conversations, attachments and browser data in a SQLite database on the computer that runs it. OpenBot keeps no other copy. On a hosted OpenBot server, the database is on that server in the EU. An account holds only your profile, team memberships, invitations, sign-in sessions and the settings that let devices find each other.",
      rival:
        "Hermes Agent keeps conversations, memory and skills in ~/.hermes on the computer that runs it, with its sessions in SQLite. Nous Research says Hermes Agent collects no telemetry, usage data or analytics, and API calls go only to the provider that you set up.",
    },
  ],
  faq: [
    {
      question: "Is OpenBot an alternative to Hermes Agent?",
      answer:
        "Yes. Both run AI agents on your own computer and keep your chats there. OpenBot runs the coding tools of the providers you pay for, such as Codex and Claude Code, as a team. Hermes Agent is its own agent loop that calls a model through an API.",
    },
    {
      question: "What is the main difference between OpenBot and Hermes Agent?",
      answer:
        "What an agent is. An OpenBot agent is a provider's own coding tool, such as Codex with your ChatGPT plan or Claude Code with your Claude plan, and several agents work as a team. Hermes Agent is its own agent loop over many model providers. It learns skills as it works, and it talks to you in messaging apps.",
    },
    {
      question: "Can I use my Claude subscription with Hermes Agent?",
      answer:
        "As the model of Hermes Agent itself, only on Claude Max, and then it uses only the extra usage credits that you buy, not your plan's own usage. With Claude Pro, you need an API key. Its bundled Claude Code skill can also give coding work to Claude Code with your Pro or Max plan. In OpenBot, Claude Code is the agent itself and uses your Claude plan.",
    },
    {
      question: "Can I use my ChatGPT, Claude or Gemini subscription with OpenBot?",
      answer:
        "Yes. OpenBot signs in to each provider tool with your own account: your ChatGPT plan for Codex, your Claude plan for Claude Code, and a Google AI Pro or Ultra plan for Gemini. Grok CLI uses your Grok account or an xAI API key, and Cursor CLI your Cursor plan. OpenBot adds no charge of its own.",
    },
    {
      question: "Can I use local models?",
      answer:
        "Yes, with both. In OpenBot, an agent can use any OpenAI-compatible server through OpenCode, also a model on your own computer. Hermes Agent works with any OpenAI-compatible server, such as Ollama, vLLM or llama.cpp.",
    },
    {
      question: "Is Hermes Agent open source?",
      answer:
        "Yes. Hermes Agent is on GitHub under the MIT License, which also allows commercial use. OpenBot's source code is on GitHub under the PolyForm Noncommercial License 1.0.0, and commercial use needs a separate license.",
    },
    {
      question: "Does Hermes Agent have a mobile app?",
      answer:
        "The documentation states no native iPhone or Android app. You reach Hermes Agent from your phone through messaging apps such as Telegram, WhatsApp or Signal. OpenBot has apps for iPhone and Android that connect to your own computer over an encrypted connection.",
    },
    {
      question: "Do my chats leave my computer?",
      answer:
        "With both, your chats stay on the computer that runs the app, and the model provider that you choose gets the requests. With Hermes Agent, a messaging app that you connect also carries those messages.",
    },
    {
      question: "Do agents keep working when my laptop is closed?",
      answer:
        "Yes, with both, when they run on a computer that stays on. With OpenBot, run it on a desktop, a server or a hosted OpenBot server, and connect from your laptop or phone. Hermes Agent can run on a server, or in Hermes Cloud for a daily price.",
    },
    {
      question: "How much do OpenBot and Hermes Agent cost?",
      answer:
        "Both apps are free. OpenBot is free for noncommercial use, and commercial use needs a separate license. Hermes Agent is free under the MIT License. With both, you pay your model provider. Hermes Cloud costs from $0.56 a day for a running Medium instance, plus the models and tools it uses.",
    },
  ],
  sources: [
    { label: "Hermes Agent on GitHub", url: "https://github.com/NousResearch/hermes-agent" },
    { label: "Hermes Agent AI providers", url: `${HERMES_DOCS}/integrations/providers` },
    { label: "Hermes Agent FAQ", url: `${HERMES_DOCS}/reference/faq` },
    { label: "Hermes Agent platform support", url: `${HERMES_DOCS}/getting-started/platform-support` },
    { label: "Hermes Desktop", url: `${HERMES_DOCS}/user-guide/desktop` },
    { label: "Hermes Agent messaging", url: `${HERMES_DOCS}/user-guide/messaging/` },
    { label: "Hermes Agent subagents", url: `${HERMES_DOCS}/user-guide/features/delegation` },
    { label: "Hermes Agent Bot Mode", url: `${HERMES_DOCS}/user-guide/bot-mode` },
    {
      label: "Hermes Agent Claude Code skill",
      url: `${HERMES_DOCS}/user-guide/skills/bundled/autonomous-ai-agents/autonomous-ai-agents-claude-code`,
    },
    { label: "Hermes Cloud", url: "https://portal.nousresearch.com/cloud" },
    {
      label: "Hermes Agent language packs",
      url: "https://hermes-agent.nousresearch.com/docs/user-guide/features/language-packs",
    },
    { label: "OpenBot privacy notes", url: OPENBOT_LINKS.privacy },
    { label: "OpenBot source code", url: OPENBOT_LINKS.repository },
  ],
  checkedAt: "2026-10-02",
};
