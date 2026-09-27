import { OPENBOT_LINKS } from "../../lib/landing-links";
import type { Comparison } from "./comparison";

// Every statement about OpenClaw here is taken from the OpenClaw documentation, its
// repository or openclaw.ai, and each page used is in `sources`. Where they state
// nothing, the text says so. Check them again, and move `checkedAt`, whenever this file
// changes. Statements about OpenBot follow its privacy notes and the remote connection
// that `remote/README.md` describes.

const OPENCLAW_DOCS = "https://docs.openclaw.ai";

export const OPENCLAW_COMPARISON: Comparison = {
  rival: { name: "OpenClaw", mark: "openclaw" },
  answer:
    "OpenBot and OpenClaw are close: both run AI agents on your own computer, use the AI plans you already pay for, and have apps for desktop, iPhone and Android. Choose OpenBot if you want Codex, Claude Code, Gemini and Grok CLI to work as a team, and to reach them from your phone anywhere with no VPN. Choose OpenClaw if you want one personal assistant that talks to you in WhatsApp, Telegram or Slack, under the MIT license.",
  chooseOpenBot: [
    "You want Codex, Claude Code, Gemini and Grok CLI as agents in one team, each with its own job.",
    "You want your phone to reach your agents from anywhere, with no VPN, tailnet or SSH tunnel.",
    "You pay for Google AI Pro or Ultra and want your agents to use that plan.",
    "You want one desktop app that sets up everything, with no separate gateway to run.",
  ],
  rivalPlans:
    "OpenClaw signs in with ChatGPT or Codex, a Claude Code login, SuperGrok or X Premium, and GitHub Copilot, or uses API keys and local models. Gemini needs an API key: OpenClaw does not offer a new Google sign-in.",
  chooseRival: [
    "You want to talk to your assistant in WhatsApp, Telegram, Slack, Signal, iMessage or Discord.",
    "You need the MIT license, for example for commercial use.",
    "You want many plugins and skills from a large open-source community.",
  ],
  rows: [
    {
      icon: "cpu",
      topic: "Models and plans",
      openbot:
        "Use the plans you already have: ChatGPT, Claude, Gemini or Grok. Or run free models and your own model through OpenCode. Choose one for each agent, and change it later.",
      rival:
        "Sign in with ChatGPT, a Claude Code login, SuperGrok or X Premium, or GitHub Copilot. Or use API keys and local models. Gemini needs an API key; a consumer Gemini plan does not work.",
    },
    {
      icon: "laptop",
      topic: "Where agents work",
      openbot: "On the computer that runs OpenBot.",
      rival: "On the computer that runs the OpenClaw Gateway: your own computer, a home server or a VPS that you rent.",
    },
    {
      icon: "cloud",
      topic: "When your computer is off",
      openbot:
        "Agents keep working on the computer or server that runs OpenBot. Only that computer must stay on, not your laptop.",
      rival:
        "Scheduled jobs run on the computer that runs the Gateway. On a laptop, sleep and restarts stop it; OpenClaw recommends a VPS for 24/7 work.",
    },
    {
      icon: "phone",
      topic: "Remote access",
      openbot:
        "Apps for iPhone and Android connect from anywhere. Chats and files go over an encrypted connection between your devices, with no VPN, and no cloud stores them.",
      rival:
        "Apps for iPhone and Android connect to the Gateway over your local network, a tailnet such as Tailscale, or an SSH tunnel. Messaging apps such as WhatsApp and Telegram also work, and carry your messages.",
      better: "openbot",
    },
    {
      icon: "users",
      topic: "Teams",
      openbot:
        "Each agent is a full coding agent with its own job. They give work to each other in shared channels, and coworkers can join one team host.",
      rival:
        "Several isolated agents in one Gateway, each with its own workspace, and subagents for parallel work. A team can share one Gateway, with shared sessions and roles.",
    },
    {
      icon: "lock",
      topic: "Your data",
      openbot:
        "Workspaces, chats and files stay in a database on your computer. The provider you choose gets the requests you send. Product analytics, with no chat content, are on by default; you can turn them off.",
      rival:
        "Sessions, memory and settings stay in ~/.openclaw on the computer that runs the Gateway. A daily update check is on by default; anonymous feature statistics are opt-in.",
    },
    {
      icon: "tag",
      topic: "Price and account",
      openbot:
        "Free for noncommercial use; commercial use needs a license. No account is necessary on one computer. Your agents use the plans you already pay for.",
      rival:
        "Free under the MIT license, also for commercial use. No subscription and no hosted tier. You pay your model provider, and a VPS if you rent one.",
      better: "rival",
    },
    {
      icon: "devices",
      topic: "Apps",
      openbot: "macOS, Windows and Linux, and mobile apps for iPhone and Android.",
      rival: "macOS, Windows and Linux, apps for iPhone and Android, a web Control UI, and a command line.",
    },
    {
      icon: "code",
      topic: "Source code",
      openbot: "On GitHub, under the PolyForm Noncommercial License 1.0.0.",
      rival: "On GitHub, under the MIT License.",
    },
  ],
  intro:
    "OpenClaw was first called Clawdbot, then Moltbot, and took its current name in January 2026. Like OpenBot, it runs AI agents on a computer that you choose, keeps your data there, works with the AI plans you pay for, and has apps for desktop and phone. The difference is what an agent is and how you reach it. In OpenBot, each agent is a coding tool from the provider whose plan you pay for, the agents work as a team, and your phone connects from anywhere. OpenClaw is a personal assistant that runs in a Gateway and talks to you through messaging apps.",
  sections: [
    {
      title: "Models and the plans you pay for",
      openbot:
        "OpenBot runs the provider tools you already use, with the plans you already pay for: Codex with your ChatGPT plan, Claude Code with your Claude plan, Gemini with your Google AI Pro or Ultra plan, and Grok CLI with your Grok account or an xAI API key. OpenCode runs free models, or your own model on any OpenAI-compatible server, also one on your computer. You choose the provider, the model and the reasoning effort for each agent. When you move an agent to a different provider, it keeps its role, workspace and conversation.",
      rival:
        "OpenClaw signs in with a ChatGPT account or a Codex login, reuses a Claude Code login on the same computer, and recommends Grok sign-in with a SuperGrok or X Premium subscription. It also works with GitHub Copilot, API keys from many providers, and local models through Ollama, LM Studio, vLLM or llama.cpp. Gemini needs a Google API key: OpenClaw does not offer a new Gemini CLI or Antigravity sign-in, because Google ended that sign-in for consumer Gemini CLI and the Antigravity terms prohibit third-party tools.",
    },
    {
      title: "Where the work happens",
      openbot:
        "OpenBot runs on the computer that hosts it. Agent workspaces, conversations and app data stay on that computer, so it must stay on while its agents work. Run it on a desktop or a server that stays on, and your agents keep working while your laptop is closed. Local-first is not offline: an agent that uses a hosted provider still sends its requests to that provider.",
      rival:
        "OpenClaw runs in a Gateway on the computer that you choose. The desktop apps install the Gateway for you; you can also run it on a home server, in Docker, or on a VPS. Scheduled jobs and a regular heartbeat run in the Gateway. On a laptop, sleep, network drops and restarts disconnect it, so OpenClaw recommends a VPS for 24/7 work.",
    },
    {
      title: "Phones and remote access",
      openbot:
        "The OpenBot apps for iPhone and Android connect to the computer that runs your agents. From anywhere, you chat with them, follow their progress and send files. The connection goes directly between your devices when it can, it is encrypted, and no cloud stores your chats or files. You set up no VPN or tunnel. Remote access needs an OpenBot account.",
      rival:
        "The OpenClaw apps for iPhone and Android connect to the Gateway over your local network or a tailnet. The Gateway listens only on the computer itself by default; to reach it from outside, OpenClaw recommends Tailscale, or an SSH tunnel. You can also talk to OpenClaw in WhatsApp, Telegram, Slack, Discord, Signal, iMessage and many more; your messages then go through the messaging service that you choose.",
      better: "openbot",
    },
    {
      title: "How agents work as a team",
      openbot:
        "In OpenBot, each agent is a full coding agent: Codex, Claude Code, Gemini, Grok CLI or OpenCode, each with its own job and workspace. A lead agent can give parts of a task to other agents in a shared channel. You follow their work and step in when a decision needs you. For a team of people, one computer runs the host and the others join it; the chats and files stay on the host.",
      rival:
        "One OpenClaw Gateway can run several isolated agents, each with its own workspace and session history, and messages go to the right agent by rules. An agent can start subagents, 5 at a time by default. Through ACP, it can also give work to Claude Code, Codex, Cursor, Gemini CLI and others. A team can share one Gateway, with shared sessions and roles; OpenClaw says a Gateway is one trust domain, for people who already trust each other.",
    },
    {
      title: "Data and privacy",
      openbot:
        "OpenBot keeps workspaces, conversations, attachments and browser data in a SQLite database on the computer that runs it. There is no copy on OpenBot's side. An account holds only your profile, team memberships, invitations, sign-in sessions and the settings that let devices find each other. Product analytics, which never include chat content, are on by default; you can turn them off in Settings.",
      rival:
        "OpenClaw keeps settings, sessions and memory under ~/.openclaw on the computer that runs the Gateway, with session history in SQLite and memory in Markdown files. A daily update check is on by default and sends the version and platform; anonymous feature statistics are off until you turn them on. OpenClaw says that third-party skills and inbound messages are untrusted input.",
    },
  ],
  faq: [
    {
      question: "Is OpenBot an alternative to OpenClaw?",
      answer:
        "Yes. Both run AI agents on your own computer and keep your data there. OpenBot runs the coding tools of the providers you pay for, such as Codex and Claude Code, as a team, and your phone reaches them from anywhere. OpenClaw is a personal assistant that runs in a Gateway and talks to you in messaging apps.",
    },
    {
      question: "Is OpenClaw the same as Clawdbot or ClawBot?",
      answer:
        "OpenClaw was first called Clawdbot. It became Moltbot in January 2026 and OpenClaw a few days later. ClawBot by Ipsion AI is a different, hosted product, and it says it is not part of the OpenClaw project.",
    },
    {
      question: "What is the main difference between OpenBot and OpenClaw?",
      answer:
        "What an agent is and how you reach it. An OpenBot agent is a provider's own coding tool, such as Codex with your ChatGPT plan or Claude Code with your Claude plan, and several agents work as a team. OpenClaw is one assistant runtime over many model providers, and you reach it through messaging apps or its own apps on your network.",
    },
    {
      question: "Can I use my ChatGPT, Claude or Gemini subscription with OpenBot?",
      answer:
        "Yes. OpenBot signs in to each provider tool with your own account: your ChatGPT plan for Codex, your Claude plan for Claude Code, and a Google AI Pro or Ultra plan for Gemini. Grok CLI uses your Grok account or an xAI API key. OpenBot adds no charge of its own.",
    },
    {
      question: "Can I use my Claude or Gemini subscription with OpenClaw?",
      answer:
        "Claude, yes: OpenClaw can reuse a Claude Code login on the same computer, and that use comes from your plan's limits. Gemini, no: OpenClaw needs a Google API key, and it does not offer a new Google account sign-in.",
    },
    {
      question: "Can I reach my agents from my phone?",
      answer:
        "Yes, with both. The OpenBot apps connect from anywhere over an encrypted connection between your devices, with no VPN. The OpenClaw apps connect over your local network, a tailnet or an SSH tunnel, and you can also talk to OpenClaw in messaging apps such as WhatsApp or Telegram.",
    },
    {
      question: "Is OpenClaw open source?",
      answer:
        "Yes. OpenClaw is on GitHub under the MIT License, which also allows commercial use. OpenBot's source code is on GitHub under the PolyForm Noncommercial License 1.0.0, and commercial use needs a separate license.",
    },
    {
      question: "Do my chats leave my computer?",
      answer:
        "With both, your chats stay on the computer that runs the app, and the model provider that you choose gets the requests. With OpenClaw, a messaging app that you connect also carries those messages.",
    },
    {
      question: "Do agents keep working when my laptop is closed?",
      answer:
        "Yes, with both, when they run on a computer that stays on. With OpenBot, run it on a desktop or a server, and connect from your laptop or phone. OpenClaw recommends a VPS or a home server for its Gateway.",
    },
    {
      question: "How much do OpenBot and OpenClaw cost?",
      answer:
        "Both apps are free. OpenBot is free for noncommercial use, and commercial use needs a separate license. OpenClaw is free under the MIT License, with no subscription and no hosted tier. With both, you pay your model provider.",
    },
  ],
  sources: [
    { label: "OpenClaw on GitHub", url: "https://github.com/openclaw/openclaw" },
    { label: "OpenClaw", url: "https://openclaw.ai" },
    { label: "Introducing OpenClaw", url: "https://openclaw.ai/blog/introducing-openclaw" },
    { label: "OpenClaw lore", url: `${OPENCLAW_DOCS}/start/lore` },
    { label: "OpenClaw Anthropic provider", url: `${OPENCLAW_DOCS}/providers/anthropic` },
    { label: "OpenClaw Google provider", url: `${OPENCLAW_DOCS}/providers/google` },
    { label: "OpenClaw xAI provider", url: `${OPENCLAW_DOCS}/providers/xai` },
    { label: "OpenClaw OpenAI authentication", url: `${OPENCLAW_DOCS}/providers/openai/authentication` },
    { label: "OpenClaw iOS app", url: `${OPENCLAW_DOCS}/platforms/ios` },
    { label: "OpenClaw Android app", url: `${OPENCLAW_DOCS}/platforms/android` },
    { label: "OpenClaw remote access", url: `${OPENCLAW_DOCS}/gateway/remote` },
    { label: "OpenClaw multi-agent routing", url: `${OPENCLAW_DOCS}/concepts/multi-agent` },
    { label: "OpenClaw for teams", url: `${OPENCLAW_DOCS}/start/teams` },
    { label: "OpenClaw telemetry", url: `${OPENCLAW_DOCS}/gateway/telemetry` },
    { label: "OpenClaw hosting FAQ", url: `${OPENCLAW_DOCS}/help/faq-first-run/providers-and-hosting` },
    { label: "OpenBot privacy notes", url: OPENBOT_LINKS.privacy },
    { label: "OpenBot source code", url: OPENBOT_LINKS.repository },
  ],
  checkedAt: "2026-09-27",
};
