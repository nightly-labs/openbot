import { OPENBOT_LINKS } from "../../lib/landing-links";
import type { Comparison } from "./comparison";

// Every statement about Manus here is taken from manus.im, its documentation, help
// center, Trust Center, terms and privacy policy, and each page used is in `sources`.
// Where they state nothing, the text says so. Where two of its pages disagree, the text
// gives both or leaves the detail out. Check them again, and move `checkedAt`, whenever
// this file changes.

const MANUS_HELP = "https://help.manus.im/en/articles";

export const MANUS_COMPARISON: Comparison = {
  rival: { name: "Manus", mark: "manus" },
  answer:
    "Choose OpenBot if you want your agents on your own computer, with the AI plans you already pay for, such as ChatGPT, Claude, Gemini or Grok: the app is free and needs no account. Choose Manus if you want a general agent that works in its own cloud computer, keeps working with no computer of yours on, and chooses the model for you.",
  chooseOpenBot: [
    "You already pay for ChatGPT, Claude, Gemini, Grok or Cursor, or you run your own model.",
    "Your files and chats must stay on your own computer, not in a cloud in the US or Singapore.",
    "You want a team of coding agents that give work to each other, each with its own job.",
    "You want a desktop app for Linux, or a free app that works without an account.",
  ],
  rivalPlans:
    "Manus chooses the model for each task; you choose only between Manus 2.0 Lite, Manus 2.0 and Manus 2.0 Max. You pay Manus in credits: 300 free credits a day, or Pro plans from $20 a month.",
  chooseRival: [
    "You want an agent that works in a cloud computer, with no computer of yours to keep on.",
    "You want research, websites and slides from one prompt, with many agents in parallel.",
    "You want to give it tasks in Telegram, WhatsApp Business, LINE, Slack or email.",
  ],
  rows: [
    {
      icon: "cpu",
      topic: "Models and plans",
      openbot:
        "Use the plans you already have: ChatGPT, Claude, Gemini, Grok or Cursor. Or run free models and your own model through OpenCode. Choose one for each agent, and change it later.",
      rival:
        "Manus chooses the model for each task. You choose Manus 2.0 Lite, Manus 2.0 or Manus 2.0 Max. Manus states no way to use your own AI plan, API key or model.",
      better: "openbot",
    },
    {
      icon: "laptop",
      topic: "Where agents work",
      openbot: "On the computer that runs OpenBot.",
      rival:
        "In a cloud sandbox that Manus runs, by default. With the desktop app, Manus can also run commands in the folders that you allow on your Mac or Windows PC.",
      better: "openbot",
    },
    {
      icon: "cloud",
      topic: "When your computer is off",
      openbot:
        "Agents keep working on the computer or server that runs OpenBot, and routines start them on a schedule. If you do not want to keep a computer on, use a hosted OpenBot server in the EU, from €20 or $25 a month.",
      rival:
        "Cloud tasks keep working after you close the app, and scheduled tasks run while you are offline. Tasks on your own computer need it on.",
    },
    {
      icon: "phone",
      topic: "Remote access",
      openbot:
        "Apps for iPhone and Android connect from anywhere. Chats and files go over an encrypted connection between your devices, with no VPN, and no cloud stores them.",
      rival:
        "Apps for iPhone and Android and a web app. You can also give tasks in Telegram, WhatsApp Business, LINE, Slack or email. The tasks and their files stay in Manus's cloud.",
    },
    {
      icon: "users",
      topic: "Teams",
      openbot:
        "Each agent is a full coding agent with its own job. They give work to each other in shared channels, and coworkers can join one team host.",
      rival:
        "Wide Research runs many agents in parallel on one task. Up to 50 people can work in one task, and the Team plan pools credits across seats.",
    },
    {
      icon: "lock",
      topic: "Your data",
      openbot:
        "Workspaces, chats and files stay in a database on your computer. The provider you choose gets the requests you send. Product analytics, with no chat content, are on by default and linked to your account when you sign in; you can turn them off.",
      rival:
        "Tasks, files and the commands the agent runs are stored in Manus's cloud, in the US and Singapore. Its terms give Manus a permanent license to use your content, in aggregate, to improve the service.",
      better: "openbot",
    },
    {
      icon: "tag",
      topic: "Price and account",
      openbot:
        "Free for noncommercial use; commercial use needs a license. No account is necessary on one computer. Your agents use the plans you already pay for.",
      rival:
        "Free with 300 credits a day. Pro plans from $20 to $200 a month, and the Team plan from $20 a seat. Needs an account, and is for people aged 18 or more.",
      better: "openbot",
    },
    {
      icon: "globe",
      topic: "Where you can use it",
      openbot:
        "In any country: OpenBot has no region lock. The desktop app is in English, French, Japanese and Turkish, and hosted servers run in the EU. Each AI provider sets the countries for its own plan.",
      rival:
        "Worldwide, except countries under a US embargo, for people 18 and over. Its data is stored in the US and Singapore. The website is in 17 languages.",
    },
    {
      icon: "devices",
      topic: "Apps",
      openbot: "macOS, Windows and Linux, and mobile apps for iPhone and Android.",
      rival: "macOS and Windows, apps for iPhone and Android, and the web. A Linux desktop app: not stated by Manus.",
    },
    {
      icon: "code",
      topic: "Source code",
      openbot: "On GitHub, under the PolyForm Noncommercial License 1.0.0.",
      rival: "Closed source. Its terms prohibit reverse engineering.",
      better: "openbot",
    },
  ],
  intro:
    "Manus is a general AI agent from Butterfly Effect, a company in Singapore. Meta acquired Manus in December 2025, and Manus resumed independent operations on 1 September 2026. Both products give you agents that do the work, not only answers. The difference is where the agents run and which model does the thinking. Manus works in its own cloud computer and chooses the model for you. OpenBot runs a team of agents on your own computer, with the AI plans you choose.",
  sections: [
    {
      title: "Models and the plans you pay for",
      openbot:
        "OpenBot runs the provider tools you already use, with the plans you already pay for: Codex with your ChatGPT plan, Claude Code with your Claude plan, Gemini with your Google AI Pro or Ultra plan, Grok CLI with your Grok account or an xAI API key, and Cursor CLI with your Cursor plan or a Cursor API key. OpenCode runs free models, or your own model on any OpenAI-compatible server, also one on your computer. You choose the provider, the model and the reasoning effort for each agent. When you move an agent to a different provider, it keeps its role, workspace and conversation.",
      rival:
        "Manus says it is LLM-agnostic: it chooses the right model for each task, so you do not have to. It does not name the models. You choose only between its own tiers: the free plan gets Manus 2.0 Lite in Agent mode, and paid plans also get Manus 2.0 and Manus 2.0 Max. You pay Manus in credits, and a plan that you already pay for at another AI company does not apply.",
      better: "openbot",
    },
    {
      title: "Where the work happens",
      openbot:
        "OpenBot runs on the computer that hosts it. Agent workspaces, conversations and app data stay on that computer, so it must stay on while its agents work. Run it on a desktop or a server that stays on, and your agents keep working while your laptop is closed. If you do not want to keep a computer on, use a hosted OpenBot server. It is a Linux server in the EU (Germany, Finland or France), from €20 or $25 a month, and it keeps the workspaces and chats of its agents. Local-first is not offline: an agent that uses a hosted provider still sends its requests to that provider.",
      rival:
        "By default, each Manus task works in a temporary sandbox: a virtual computer with internet access in Manus's cloud. A Cloud Computer that stays on costs $30 or $50 a month more. Cloud tasks and scheduled tasks keep running while you are offline. Since March 2026, the desktop app for macOS and Windows can also let Manus run commands in the folders that you allow on your own computer; those tasks need that computer on.",
      better: "openbot",
    },
    {
      title: "Phones and remote access",
      openbot:
        "The OpenBot apps for iPhone and Android connect to the computer that runs your agents. From anywhere, you chat with them, follow their progress and send files. The connection goes directly between your devices when it can, it is encrypted, and no cloud stores your chats or files. You set up no VPN or tunnel. Remote access needs an OpenBot account.",
      rival:
        "Manus has apps for iPhone and Android and a web app. You can also give it tasks in Telegram, WhatsApp Business, LINE or Slack, or by email; one messaging app at a time for each workspace. The work itself happens in Manus's cloud, or on your computer when you use the desktop app.",
    },
    {
      title: "How agents work as a team",
      openbot:
        "In OpenBot, each agent is a full coding agent: Codex, Claude Code, Gemini, Grok CLI, Cursor CLI or OpenCode, each with its own job and workspace. A lead agent can give parts of a task to other agents in a shared channel. You follow their work and step in when a decision needs you. For a team of people, one computer runs the host and the others join it; the chats and files stay on the host.",
      rival:
        "Manus is one agent that can split a large task: Wide Research starts hundreds of independent agents that work in parallel. Paid plans run up to 20 tasks at the same time. Up to 50 people can work in one task, and only the owner of the task pays the credits. The Team plan pools credits and adds single sign-on; the owner of a team can see all the session data of its members.",
    },
    {
      title: "Data and privacy",
      openbot:
        "OpenBot keeps workspaces, conversations, attachments and browser data in a SQLite database on the computer that runs it. OpenBot keeps no other copy. On a hosted OpenBot server, the database is on that server in the EU. An account holds your profile, team memberships, invitations, sign-in sessions, the settings that let devices find each other, and any agent templates that you publish. Product analytics, which never include chat content, are on by default and linked to your account when you sign in; you can turn them off in Settings.",
      rival:
        "Manus stores your data in the US and Singapore. Its privacy policy says that it collects the files of each task, the shell commands the agent runs and their output, and the code. Manus says its model providers do not train on your data. For individual plans, it states no training opt-out, and its terms give Manus a permanent license to use your content, in aggregate, to improve the service. The Team plan says Manus does not train models on your data.",
      better: "openbot",
    },
  ],
  faq: [
    {
      question: "Is OpenBot an alternative to Manus?",
      answer:
        "Yes, if you want your agents on your own computer. Both give you AI agents that do the work. OpenBot runs a team of agents on your computer with the AI plans you choose. Manus is a general agent that works in a cloud computer that Manus runs, with models that Manus chooses.",
    },
    {
      question: "Why choose OpenBot over Manus?",
      answer:
        "Your agents use the AI plans you already pay for, such as ChatGPT, Claude, Gemini or Grok, or your own model. OpenBot keeps your workspaces, chats and files on your own computer, it runs a team of coding agents, and it has desktop apps for macOS, Windows and Linux. The app is free, works without an account, and its source code is on GitHub. Manus is the better fit when you want an agent with no computer of yours to keep on.",
    },
    {
      question: "Can I use my ChatGPT, Claude or Gemini subscription with OpenBot?",
      answer:
        "Yes. OpenBot signs in to each provider tool with your own account: your ChatGPT plan for Codex, your Claude plan for Claude Code, and a Google AI Pro or Ultra plan for Gemini. Grok CLI uses your Grok account or an xAI API key, and Cursor CLI your Cursor plan. OpenBot adds no charge of its own.",
    },
    {
      question: "Can I use my own AI plan or model with Manus?",
      answer:
        "Manus states no way to do this. It chooses the model for each task, and you pay Manus in credits. You can choose only between Manus 2.0 Lite, Manus 2.0 and Manus 2.0 Max.",
    },
    {
      question: "Is Manus owned by Meta?",
      answer:
        "Not now. Meta acquired Manus in December 2025. In August 2026, Manus said it was separating from Meta to comply with regulatory requirements, and it resumed independent operations on 1 September 2026, led by its founding team.",
    },
    {
      question: "Is OpenManus the same as Manus?",
      answer:
        "No. OpenManus is a separate open-source project under the MIT License. Manus itself is closed source, and its terms prohibit reverse engineering.",
    },
    {
      question: "Does Manus work on my computer?",
      answer:
        "Partly. By default, Manus works in a cloud sandbox. The desktop app for macOS and Windows can let it run commands in the folders that you allow on your computer, while the app runs. Your tasks and their data are still stored in Manus's cloud.",
    },
    {
      question: "Do agents keep working when my laptop is closed?",
      answer:
        "Yes, with both. Manus works in its cloud, so no computer of yours must stay on. OpenBot agents work on the computer or server that runs OpenBot: keep that computer on, or use a hosted OpenBot server, and connect from your laptop or phone.",
    },
    {
      question: "How much do OpenBot and Manus cost?",
      answer:
        "OpenBot is free for noncommercial use, commercial use needs a separate license, and your agents use the plans you already pay for. Manus is free with 300 credits a day; Pro plans cost $20 to $200 a month and the Team plan starts at $20 a seat. Manus payments are not refundable.",
    },
  ],
  sources: [
    { label: "Manus", url: "https://manus.im" },
    { label: "Introducing Manus 2.0", url: "https://manus.im/blog/introducing-manus-2-0" },
    { label: "Manus pricing", url: "https://manus.im/pricing" },
    {
      label: "Manus membership pricing",
      url: `${MANUS_HELP}/11711111-what-is-the-current-membership-pricing-for-manus`,
    },
    { label: "Manus Team plan", url: "https://manus.im/team" },
    { label: "Manus: A note to our users", url: "https://manus.im/blog/a-note-to-our-users" },
    {
      label: "Manus resumes independent operations",
      url: "https://manus.im/blog/manus-resumes-independent-operations",
    },
    { label: "Manus joins Meta", url: "https://manus.im/blog/manus-joins-meta-for-next-era-of-innovation" },
    { label: "Manus docs: Welcome", url: "https://manus.im/docs/introduction/welcome" },
    { label: "Manus docs: Desktop", url: "https://manus.im/docs/features/desktop" },
    { label: "Manus docs: Wide Research", url: "https://manus.im/docs/features/wide-research" },
    { label: "Manus docs: Scheduled tasks", url: "https://manus.im/docs/features/scheduled-tasks" },
    { label: "Manus My Computer", url: "https://manus.im/blog/manus-my-computer-desktop" },
    { label: "Manus desktop app download", url: `${MANUS_HELP}/14089011-how-to-download-the-manus-desktop-app` },
    { label: "Manus Cloud Computer", url: `${MANUS_HELP}/15392111-what-is-the-cloud-computer` },
    {
      label: "Manus Cloud Computer plans",
      url: `${MANUS_HELP}/15392078-understanding-cloud-computer-plans-and-billing`,
    },
    { label: "Manus Collab", url: `${MANUS_HELP}/12135428-how-can-i-use-manus-collab` },
    { label: "Manus in Telegram", url: "https://manus.im/blog/manus-agents-telegram" },
    {
      label: "One messaging agent at a time",
      url: `${MANUS_HELP}/14178640-can-i-connect-multiple-messaging-agents-at-once`,
    },
    { label: "Mail Manus", url: `${MANUS_HELP}/12059745-how-can-i-use-mail-manus` },
    { label: "Manus Trust Center FAQ", url: "https://trust.manus.im/faq" },
    { label: "Manus privacy policy", url: "https://manus.im/privacy" },
    { label: "Manus terms of use", url: "https://manus.im/terms" },
    { label: "Manus download", url: "https://manus.im/download" },
    { label: "OpenManus on GitHub", url: "https://github.com/FoundationAgents/OpenManus" },
    { label: "OpenBot privacy notes", url: OPENBOT_LINKS.privacy },
    { label: "OpenBot source code", url: OPENBOT_LINKS.repository },
  ],
  checkedAt: "2026-10-02",
};
