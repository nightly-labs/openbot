import { OPENBOT_LINKS } from "../../lib/landing-links";
import { type Comparison, OPENBOT_TEXT } from "./comparison";

// Every statement about OpenClaw here is taken from the OpenClaw documentation, its
// repository or openclaw.ai, and each page used is in `sources`. Where they state
// nothing, the text says so. Check them again, and move `checkedAt`, whenever this file
// changes. Statements about OpenBot follow its privacy notes and the remote connection
// that `remote/README.md` describes.

const OPENCLAW_DOCS = "https://docs.openclaw.ai";

export const OPENCLAW_COMPARISON: Comparison = {
  rival: { name: "OpenClaw", mark: "openclaw" },
  answer:
    "OpenBot and OpenClaw are close: both run AI agents on your own computer, use the AI plans you already pay for, and have apps for desktop, iPhone and Android. Choose OpenBot if you want Codex, Claude Code, Gemini and Grok CLI to work as a team of separate agents, and to reach them from your phone anywhere with no VPN. Choose OpenClaw if you want one personal assistant that talks to you in WhatsApp, Signal or iMessage, under the MIT license.",
  chooseOpenBot: [
    "You want Codex, Claude Code, Gemini, Grok CLI, Cursor CLI, Cline, Pi and Muse Code as separate agents in one team, each with its own job.",
    "You want your phone to reach your agents from anywhere, with no VPN, tunnel or public address to set up.",
    "You pay for Google AI Pro or Ultra and want your agents to use that plan.",
    "You want your agents to work 24/7 with no VPS to set up: use a hosted OpenBot server.",
  ],
  rivalPlans:
    "OpenClaw signs in with ChatGPT or Codex, a Claude Code login, SuperGrok or X Premium, and GitHub Copilot, or uses API keys and local models. Gemini needs an API key or Vertex AI: OpenClaw does not offer a new Google sign-in.",
  chooseRival: [
    "You want to talk to your assistant in WhatsApp, Signal or iMessage.",
    "You need the MIT license, for example for commercial use.",
    "You want many plugins and skills from a large open-source community.",
  ],
  rows: [
    {
      icon: "cpu",
      topic: "Models and plans",
      openbot: OPENBOT_TEXT.models,
      rival:
        "Sign in with ChatGPT, a Claude Code login, SuperGrok or X Premium, or GitHub Copilot. Or use API keys and local models. Gemini needs an API key or Vertex AI; a consumer Gemini plan does not work.",
      better: "openbot",
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
      openbot: OPENBOT_TEXT.offline,
      rival:
        "Scheduled jobs run on the computer that runs the Gateway. On a laptop, sleep and restarts stop it. OpenClaw has no hosted tier: for 24/7 work it recommends a VPS that you rent, set up and update over SSH.",
      better: "openbot",
    },
    {
      icon: "phone",
      topic: "Remote access",
      openbot: OPENBOT_TEXT.remote,
      rival:
        "Apps for iPhone and Android connect to the Gateway over your local network, a tailnet such as Tailscale, an SSH tunnel, or a public HTTPS address that you set up. Messaging apps such as WhatsApp and Telegram also work, and carry your messages.",
      better: "openbot",
    },
    {
      icon: "refresh",
      topic: "Backup models",
      openbot: OPENBOT_TEXT.backupModels,
      rival:
        "After rate limits, billing errors and timeouts, OpenClaw tries your other accounts at the same provider, then the backup models that you list. A model that you chose by hand for a session does not change.",
    },
    {
      icon: "key",
      topic: "Logins and payments",
      openbot: OPENBOT_TEXT.logins,
      rival:
        "OpenClaw recommends that you sign in to sites yourself in its browser. On a Mac, it can sign in with 1Password: you confirm each use, and the password never reaches the model. OpenClaw states no payment cards.",
      better: "openbot",
    },
    {
      icon: "mic",
      topic: "Voice",
      openbot: OPENBOT_TEXT.voice,
      rival:
        "Talk mode on Mac, iPhone and Android listens, answers aloud, and stops when you speak. A local model can read replies on a Mac, but speech recognition can use Apple's online service.",
    },
    {
      icon: "contact",
      topic: "Chat apps",
      openbot: OPENBOT_TEXT.chatApps,
      rival: "WhatsApp, Telegram, Slack, Discord, Signal, iMessage, Microsoft Teams, Matrix and more than 20 others.",
      better: "rival",
    },
    {
      icon: "users",
      topic: "Teams",
      openbot: OPENBOT_TEXT.teams,
      rival:
        "Several isolated agents in one Gateway, each with its own workspace, and subagents for parallel work. Agents can run through Codex, Claude Code or Gemini CLI. A team can share one Gateway, with shared sessions and roles.",
    },
    {
      icon: "lock",
      topic: "Your data",
      openbot:
        "Workspaces, chats and files stay in a database on your computer. The provider you choose gets the requests you send.",
      rival: "Sessions, memory and settings stay in ~/.openclaw on the computer that runs the Gateway.",
    },
    {
      icon: "tag",
      topic: "Price and account",
      openbot:
        "Free for noncommercial use; commercial use needs a license. Your agents use the plans you already pay for.",
      rival:
        "Free under the MIT license, also for commercial use. No subscription and no hosted tier. You pay your model provider, and a VPS if you rent one.",
      better: "rival",
    },
    {
      icon: "globe",
      topic: "Where you can use it",
      openbot: OPENBOT_TEXT.regions,
      rival: "Anywhere: you run it yourself, and there is no hosted version. The Control UI is in 21 languages.",
    },
    {
      icon: "devices",
      topic: "Apps",
      openbot: OPENBOT_TEXT.apps,
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
    "OpenClaw started as Warelay, a WhatsApp gateway, then was called Clawdbot and Moltbot, and took its current name in January 2026. Like OpenBot, it runs AI agents on a computer that you choose, keeps your data there, works with the AI plans you pay for, and has apps for desktop and phone. The difference is how the agents are organised and how you reach them. In OpenBot, each provider's coding tool is its own agent in a team, and your phone connects from anywhere. OpenClaw is a personal assistant that runs in a Gateway: it can run its turns through Codex, Claude Code or Gemini CLI, and it talks to you through messaging apps.",
  sections: [
    {
      title: "Models and the plans you pay for",
      openbot: OPENBOT_TEXT.plansSection,
      rival:
        "OpenClaw signs in with a ChatGPT account or a Codex login, reuses a Claude Code login on the same computer, and recommends Grok sign-in with a SuperGrok or X Premium subscription. It also works with GitHub Copilot, API keys from many providers, and local models through Ollama, LM Studio, vLLM or llama.cpp. Gemini needs a Google API key or Vertex AI: OpenClaw does not offer a new Gemini CLI or Antigravity sign-in, because Google ended that sign-in for consumer Gemini CLI and the Antigravity terms prohibit third-party tools.",
    },
    {
      title: "Where the work happens",
      openbot: OPENBOT_TEXT.workSection,
      rival:
        "OpenClaw runs in a Gateway on the computer that you choose. The desktop apps install the Gateway for you; you can also run it on a home server, in Docker, or on a VPS. Scheduled jobs and a regular heartbeat run in the Gateway. On a laptop, sleep, network drops and restarts disconnect it, so OpenClaw recommends a VPS for 24/7 work.",
    },
    {
      title: "Phones and remote access",
      openbot: OPENBOT_TEXT.phonesSection,
      rival:
        "The OpenClaw apps for iPhone and Android connect to the Gateway over your local network or a tailnet. The Gateway listens only on the computer itself by default; to reach it from outside, OpenClaw recommends Tailscale, an SSH tunnel, or a public HTTPS address that you set up. You can also talk to OpenClaw in WhatsApp, Telegram, Slack, Discord, Signal, iMessage and many more; your messages then go through the messaging service that you choose.",
      better: "openbot",
    },
    {
      title: "How agents work as a team",
      openbot: OPENBOT_TEXT.teamSection,
      rival:
        "One OpenClaw Gateway can run several isolated agents, each with its own workspace and session history, and messages go to the right agent by rules. An agent can run its turns through Codex, Claude Code or Gemini CLI, and it can start subagents, 5 active in each session by default. Through ACP, it can also give work to Claude Code, Codex, Cursor, Gemini CLI and others. A team can share one Gateway, with shared sessions and roles; OpenClaw says a Gateway is one trust domain, for people who already trust each other.",
    },
    {
      title: "Data and privacy",
      openbot:
        "OpenBot keeps workspaces, conversations, attachments and browser data in a SQLite database on the computer that runs it. OpenBot keeps no other copy. On a hosted OpenBot server, the database is on that server in the EU. An account holds your profile, team memberships, invitations, sign-in sessions, the settings that let devices find each other, and any agent templates that you publish. Product analytics, which never include chat content, are on by default and linked to your account when you sign in; you can turn them off in Settings.",
      rival:
        "OpenClaw keeps settings, sessions and memory under ~/.openclaw on the computer that runs the Gateway, with session history in SQLite and memory in Markdown files. A daily update check is on by default and sends the app version and system details; anonymous feature statistics are off until you turn them on. OpenClaw says that third-party skills and inbound messages are untrusted input.",
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
        "OpenClaw started as Warelay and was then called Clawdbot. It became Moltbot in January 2026 and OpenClaw a few days later. ClawBot by Ipsion AI is a different, hosted product, and it says it is not part of the OpenClaw project.",
    },
    {
      question: "What is the main difference between OpenBot and OpenClaw?",
      answer:
        "How the agents are organised and how you reach them. In OpenBot, each provider's coding tool, such as Codex with your ChatGPT plan or Claude Code with your Claude plan, is its own agent, and the agents work as a team. OpenClaw is one assistant that can run its turns through Codex, Claude Code or Gemini CLI, and you reach it through messaging apps or its own apps on your network.",
    },
    {
      question: "Can I use my ChatGPT, Claude or Gemini subscription with OpenBot?",
      answer: OPENBOT_TEXT.plansFaq,
    },
    {
      question: "Can I use my Claude or Gemini subscription with OpenClaw?",
      answer:
        "Claude, yes: OpenClaw can reuse a Claude Code login on the same computer, and that use comes from your plan's limits. Gemini, no: OpenClaw needs a Google API key or Vertex AI, and it does not offer a new Google account sign-in.",
    },
    {
      question: "Can I reach my agents from my phone?",
      answer:
        "Yes, with both. The OpenBot apps connect from anywhere over an encrypted connection between your devices, with no VPN. The OpenClaw apps connect over your local network, a tailnet, an SSH tunnel or a public HTTPS address that you set up, and you can also talk to OpenClaw in messaging apps such as WhatsApp or Telegram.",
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
        "Yes, with both, when they run on a computer that stays on. With OpenBot, run it on a desktop, a server or a hosted OpenBot server, and connect from your laptop or phone. OpenClaw recommends a VPS or a home server for its Gateway.",
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
    { label: "OpenClaw agent runtimes", url: `${OPENCLAW_DOCS}/concepts/agent-runtimes` },
    { label: "OpenClaw ACP agents", url: `${OPENCLAW_DOCS}/tools/acp-agents` },
    { label: "OpenClaw subagents", url: `${OPENCLAW_DOCS}/tools/subagents/operations` },
    { label: "OpenClaw channels", url: `${OPENCLAW_DOCS}/channels` },
    { label: "OpenClaw scheduled jobs", url: `${OPENCLAW_DOCS}/automation/cron-jobs` },
    { label: "OpenClaw files on disk", url: `${OPENCLAW_DOCS}/help/faq/where-things-live-on-disk` },
    { label: "OpenClaw multi-agent routing", url: `${OPENCLAW_DOCS}/concepts/multi-agent` },
    { label: "OpenClaw for teams", url: `${OPENCLAW_DOCS}/start/teams` },
    { label: "OpenClaw telemetry", url: `${OPENCLAW_DOCS}/gateway/telemetry` },
    { label: "OpenClaw hosting FAQ", url: `${OPENCLAW_DOCS}/help/faq-first-run/providers-and-hosting` },
    { label: "ClawBot by Ipsion AI", url: "https://clawbot-ai.app" },
    { label: "OpenClaw Control UI settings", url: "https://docs.openclaw.ai/web/control-ui/settings" },
    { label: "OpenClaw model failover", url: "https://docs.openclaw.ai/concepts/model-failover" },
    { label: "OpenClaw browser login", url: "https://docs.openclaw.ai/tools/browser-login" },
    { label: "OpenClaw 1Password", url: "https://docs.openclaw.ai/gateway/1password" },
    { label: "OpenClaw Talk mode", url: "https://docs.openclaw.ai/nodes/talk" },
    { label: "OpenBot privacy notes", url: OPENBOT_LINKS.privacy },
    { label: "OpenBot source code", url: OPENBOT_LINKS.repository },
  ],
  checkedAt: "2026-10-02",
};
