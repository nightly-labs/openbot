import { OPENBOT_LINKS } from "../../lib/landing-links";
import type { Comparison } from "./comparison";

// Every statement about Claude Cowork here is taken from claude.com, the Claude help
// center, Anthropic's privacy center and its terms, and each page used is in `sources`.
// Where they state nothing, the text says so. Check them again, and move `checkedAt`,
// whenever this file changes. From 16 September 2026, Cowork rolls out inside Claude with
// no separate name, first on Pro and Max; the pages still call the agent Claude Cowork.

const CLAUDE_HELP = "https://support.claude.com/en/articles";

export const CLAUDE_COWORK_COMPARISON: Comparison = {
  rival: { name: "Claude Cowork", mark: "claude-cowork" },
  answer:
    "Choose OpenBot if you want your agents on your own computer, with Claude and the other AI plans you already pay for, such as ChatGPT, Gemini or Grok: the app is free and needs no account. Choose Claude Cowork if you use only Claude, and you want an agent in Anthropic's cloud that keeps working with no computer of yours on.",
  chooseOpenBot: [
    "You want Claude, ChatGPT, Gemini, Grok and Cursor agents in one team, or your own model.",
    "Your files and chats must stay on your own computer, not in Anthropic's cloud.",
    "You want a team of agents that give work to each other, each with its own job.",
    "You want a free app that works without an account, and source code that you can read.",
  ],
  rivalPlans:
    "Claude Cowork uses only Claude models. It needs a paid Claude plan: Pro from $17 a month, Max from $100, Team from $20 a seat, or Enterprise.",
  chooseRival: [
    "You use only Claude, and you already pay for a Claude plan.",
    "You want an agent that works in the cloud, with no computer of yours to keep on.",
    "You want to start and follow tasks from the Claude app on your phone or the web.",
  ],
  rows: [
    {
      icon: "cpu",
      topic: "Models and plans",
      openbot:
        "Use the plans you already have: ChatGPT, Claude, Gemini, Grok or Cursor. Or run free models and your own model through OpenCode. Choose one for each agent, and change it later.",
      rival:
        "Claude models only, with your paid Claude plan. Companies can also use Claude through Amazon Bedrock, Google Cloud or Microsoft Foundry.",
      better: "openbot",
    },
    {
      icon: "laptop",
      topic: "Where agents work",
      openbot: "On the computer that runs OpenBot.",
      rival:
        "In Anthropic's cloud. From 6 October 2026, new tasks on Pro and Max run only in the cloud; tasks already started on your computer stay there.",
      better: "openbot",
    },
    {
      icon: "cloud",
      topic: "When your computer is off",
      openbot:
        "Agents keep working on the computer or server that runs OpenBot, and routines start them on a schedule. If you do not want to keep a computer on, use a hosted OpenBot server in the EU, from €20 or $25 a month.",
      rival: "Cloud sessions keep working when you close your laptop, and scheduled tasks run with no device online.",
    },
    {
      icon: "phone",
      topic: "Remote access",
      openbot:
        "Apps for iPhone and Android connect from anywhere. Chats and files go over an encrypted connection between your devices, with no VPN, and no cloud stores them.",
      rival:
        "Start, steer and review tasks from the Claude apps for iPhone and Android or the web, in beta. Sessions and files are saved to your Claude account.",
    },
    {
      icon: "users",
      topic: "Teams",
      openbot:
        "Each agent is a full coding agent with its own job. They give work to each other in shared channels, and coworkers can join one team host.",
      rival:
        "Claude can split a task across sub-agents that work in parallel. You cannot share a session, but you can share what it makes, and Team and Enterprise plans can share projects.",
    },
    {
      icon: "lock",
      topic: "Your data",
      openbot:
        "Workspaces, chats and files stay in a database on your computer. The provider you choose gets the requests you send. Product analytics, with no chat content, are on by default and linked to your account when you sign in; you can turn them off.",
      rival:
        "Cloud sessions and their files are saved to your Claude account; local files that a cloud session opens are processed on Anthropic's servers. On Pro and Max, you can opt out of model training.",
      better: "openbot",
    },
    {
      icon: "tag",
      topic: "Price and account",
      openbot:
        "Free for noncommercial use; commercial use needs a license. No account is necessary on one computer. Your agents use the plans you already pay for.",
      rival:
        "Needs a paid Claude plan: Pro from $17 a month, Max from $100, Team from $20 a seat, or Enterprise. Cowork uses your limits faster than chat.",
      better: "openbot",
    },
    {
      icon: "globe",
      topic: "Where you can use it",
      openbot:
        "In any country: OpenBot has no region lock. The desktop app is in English, French, Japanese and Turkish, and hosted servers run in the EU. Each AI provider sets the countries for its own plan.",
      rival:
        "In the countries where Anthropic offers Claude, which include the US, the EU, the UK and Switzerland, but not China or Russia. The app is in 11 languages.",
    },
    {
      icon: "devices",
      topic: "Apps",
      openbot: "macOS, Windows and Linux, and mobile apps for iPhone and Android.",
      rival:
        "The Claude desktop app for macOS and Windows, and Linux in beta. The Claude apps for iPhone and Android and the web, in beta.",
    },
    {
      icon: "code",
      topic: "Source code",
      openbot: "On GitHub, under the PolyForm Noncommercial License 1.0.0.",
      rival:
        "Closed source; the terms prohibit reverse engineering. Its plugins are on GitHub under the Apache License 2.0.",
      better: "openbot",
    },
  ],
  intro:
    "Claude Cowork is Anthropic's agent for work beyond code, built on the same agentic approach as Claude Code. It started in January 2026 as a research preview on the Mac, and on 16 September 2026 Anthropic started to roll it into Claude itself, first for Pro and Max. OpenBot also works with your Claude plan: Claude Code is one of its agents. The difference is where the agents run and how many providers you can use. Claude Cowork runs in Anthropic's cloud with Claude only. OpenBot runs a team of agents on your own computer, with Claude and the other AI plans you choose.",
  sections: [
    {
      title: "Models and the plans you pay for",
      openbot:
        "OpenBot runs the provider tools you already use, with the plans you already pay for: Codex with your ChatGPT plan, Claude Code with your Claude plan, Gemini with your Google AI Pro or Ultra plan, Grok CLI with your Grok account or an xAI API key, and Cursor CLI with your Cursor plan or a Cursor API key. OpenCode runs free models, or your own model on any OpenAI-compatible server, also one on your computer. You choose the provider, the model and the reasoning effort for each agent. When you move an agent to a different provider, it keeps its role, workspace and conversation.",
      rival:
        "Claude Cowork runs on Claude models, and it is available on the paid Claude plans: Pro, Max, Team and Enterprise. Companies can also use it through Amazon Bedrock, Google Cloud or Microsoft Foundry. Anthropic describes no way to use models from other companies. Cowork uses your plan's limits faster than chat.",
      better: "openbot",
    },
    {
      title: "Where the work happens",
      openbot:
        "OpenBot runs on the computer that hosts it. Agent workspaces, conversations and app data stay on that computer, so it must stay on while its agents work. Run it on a desktop or a server that stays on, and your agents keep working while your laptop is closed. If you do not want to keep a computer on, use a hosted OpenBot server. It is a Linux server in the EU (Germany, Finland or France), from €20 or $25 a month, and it keeps the workspaces and chats of its agents. Local-first is not offline: an agent that uses a hosted provider still sends its requests to that provider.",
      rival:
        "Claude Cowork sessions run in the cloud by default: the agent loop and the code run on Anthropic's servers, and sessions and files are saved to your Claude account. They keep working when you close your laptop, and scheduled tasks run with no device online. Existing desktop setups can still run sessions locally, in a Linux virtual machine on your computer, but from 6 October 2026, new tasks on Pro and Max run only in the cloud. On Team plans, cloud sessions are on by default; on Enterprise, an owner turns them on.",
      better: "openbot",
    },
    {
      title: "Phones and remote access",
      openbot:
        "The OpenBot apps for iPhone and Android connect to the computer that runs your agents. From anywhere, you chat with them, follow their progress and send files. The connection goes directly between your devices when it can, it is encrypted, and no cloud stores your chats or files. You set up no VPN or tunnel. Remote access needs an OpenBot account.",
      rival:
        "Claude Cowork runs on the web and in the Claude apps for iPhone and Android, in beta, on Pro, Max and Team plans, and on Enterprise plans where an admin turns it on. You start a task on one device, steer it from another, and pick up the result anywhere, because the session runs in Anthropic's cloud.",
    },
    {
      title: "How agents work as a team",
      openbot:
        "In OpenBot, each agent is a full coding agent: Codex, Claude Code, Gemini, Grok CLI, Cursor CLI or OpenCode, each with its own job and workspace. A lead agent can give parts of a task to other agents in a shared channel. You follow their work and step in when a decision needs you. For a team of people, one computer runs the host and the others join it; the chats and files stay on the host.",
      rival:
        "Claude Cowork is one agent that can break a complex task into smaller parts and give them to sub-agents that work at the same time. You cannot share a session with other people, but you can share the artifacts it makes. On Team and Enterprise plans, members can share projects, and owners can turn Cowork off for the organisation.",
    },
    {
      title: "Data and privacy",
      openbot:
        "OpenBot keeps workspaces, conversations, attachments and browser data in a SQLite database on the computer that runs it. OpenBot keeps no other copy. On a hosted OpenBot server, the database is on that server in the EU. An account holds your profile, team memberships, invitations, sign-in sessions, the settings that let devices find each other, and any agent templates that you publish. Product analytics, which never include chat content, are on by default and linked to your account when you sign in; you can turn them off in Settings.",
      rival:
        "Cloud sessions and their files are saved to your Claude account. Local files that a cloud session opens through the desktop app are processed on Anthropic's servers, not only on your computer. On Pro and Max, you can opt out of model training; if you allow it, Anthropic can keep your data for up to 5 years. A deleted conversation leaves Anthropic's storage within 30 days.",
      better: "openbot",
    },
  ],
  faq: [
    {
      question: "Is OpenBot an alternative to Claude Cowork?",
      answer:
        "Yes, if you want your agents on your own computer. Both give you agents that do the work, and both work with your Claude plan. OpenBot runs a team of agents on your computer, with Claude Code and the other providers you choose. Claude Cowork is Anthropic's agent in its cloud, with Claude only.",
    },
    {
      question: "Why choose OpenBot over Claude Cowork?",
      answer:
        "Your agents can use Claude, ChatGPT, Gemini or Grok, or your own model, and they work together as a team. OpenBot keeps your workspaces, chats and files on your own computer. The app is free, works without an account, and its source code is on GitHub. Claude Cowork is the better fit when you use only Claude and want an agent with no computer of yours to keep on.",
    },
    {
      question: "Can I use my Claude plan with OpenBot?",
      answer:
        "Yes. OpenBot runs Claude Code with your own Claude plan, so the Claude plan that you pay for works in OpenBot too. Next to it, Codex uses your ChatGPT plan, Gemini a Google AI Pro or Ultra plan, Grok CLI your Grok account or an xAI API key, and Cursor CLI your Cursor plan. OpenBot adds no charge of its own.",
    },
    {
      question: "Is Claude Cowork still a separate product?",
      answer:
        "It is becoming part of Claude. On 16 September 2026, Anthropic started to merge Cowork and chat into one Claude, first on Pro and Max, with more plans to follow. You start a Cowork task from the same message box as a chat.",
    },
    {
      question: "Does Claude Cowork run on my computer?",
      answer:
        "By default, no: sessions run in Anthropic's cloud, and local files that a session opens are processed on Anthropic's servers. From 6 October 2026, new tasks on Pro and Max run only in the cloud; tasks already started in a virtual machine on your computer stay there.",
    },
    {
      question: "Is Claude Cowork free?",
      answer:
        "No. Claude Cowork needs a paid Claude plan: Pro costs $17 a month with annual billing or $20 monthly, Max $100 or $200 a month, and Team $20 or $25 a seat for standard seats. OpenBot is free for noncommercial use, and it uses the plans you already pay for.",
    },
    {
      question: "Do agents keep working when my laptop is closed?",
      answer:
        "Yes, with both. Claude Cowork works in Anthropic's cloud, so no computer of yours must stay on. OpenBot agents work on the computer or server that runs OpenBot: keep that computer on, or use a hosted OpenBot server, and connect from your laptop or phone.",
    },
    {
      question: "Is Claude Cowork open source?",
      answer:
        "No. Claude Cowork is closed source, and Anthropic's terms prohibit reverse engineering. Its plugins are on GitHub under the Apache License 2.0. OpenBot's source code is on GitHub under the PolyForm Noncommercial License 1.0.0.",
    },
  ],
  sources: [
    { label: "Claude Cowork", url: "https://claude.com/product/cowork" },
    { label: "Claude Cowork and chat are now one Claude", url: "https://claude.com/blog/cowork-is-now-claude" },
    { label: "Claude Cowork for enterprise", url: "https://claude.com/blog/cowork-for-enterprise" },
    { label: "Get started with Claude Cowork", url: `${CLAUDE_HELP}/13345190-get-started-with-claude-cowork` },
    { label: "Claude Cowork architecture", url: `${CLAUDE_HELP}/14479288-claude-cowork-architecture-overview` },
    { label: "Use Claude Cowork safely", url: `${CLAUDE_HELP}/13364135-use-claude-cowork-safely` },
    {
      label: "Claude Cowork on web, desktop and mobile",
      url: `${CLAUDE_HELP}/15520349-use-claude-cowork-on-web-desktop-and-mobile`,
    },
    {
      label: "Claude Cowork on Team and Enterprise",
      url: `${CLAUDE_HELP}/13455879-use-claude-cowork-on-team-and-enterprise-plans`,
    },
    {
      label: "Claude Cowork and chat are one Claude",
      url: `${CLAUDE_HELP}/16761823-claude-cowork-and-chat-are-one-claude`,
    },
    {
      label: "Scheduled tasks in Claude Cowork",
      url: `${CLAUDE_HELP}/13854387-schedule-recurring-tasks-in-claude-cowork`,
    },
    {
      label: "Projects in Claude Cowork",
      url: `${CLAUDE_HELP}/14116274-organize-your-tasks-with-projects-in-claude-cowork`,
    },
    { label: "Install Claude Desktop", url: `${CLAUDE_HELP}/10065433-install-claude-desktop` },
    { label: "Claude release notes", url: `${CLAUDE_HELP}/12138966-release-notes` },
    { label: "Countries where Claude is offered", url: "https://www.anthropic.com/supported-countries" },
    { label: "Claude in your language", url: `${CLAUDE_HELP}/10769299-using-claude-in-your-preferred-language` },
    { label: "Claude pricing", url: "https://claude.com/pricing" },
    { label: "Claude download", url: "https://claude.com/download" },
    {
      label: "How long Anthropic stores your data",
      url: "https://privacy.claude.com/en/articles/10023548-how-long-do-you-store-my-data",
    },
    {
      label: "Is my data used for model training?",
      url: "https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training",
    },
    { label: "Anthropic consumer terms", url: "https://www.anthropic.com/legal/consumer-terms" },
    { label: "Claude knowledge work plugins", url: "https://github.com/anthropics/knowledge-work-plugins" },
    { label: "OpenBot privacy notes", url: OPENBOT_LINKS.privacy },
    { label: "OpenBot source code", url: OPENBOT_LINKS.repository },
  ],
  checkedAt: "2026-10-02",
};
