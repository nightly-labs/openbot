import { OPENBOT_LINKS } from "../../lib/landing-links";
import type { Comparison } from "./comparison";

// Every statement about dots here is taken from openai.com, chatgpt.com and the OpenAI
// help center, and each page used is in `sources`. Where they state nothing, the text
// says so. Check them again, and move `checkedAt`, whenever this file changes. OpenAI
// writes the name in lower case, "dots"; this page calls the product ChatGPT dots,
// because a dot lives in ChatGPT. Dots started on 29 September 2026, at DevDay.

const OPENAI_HELP = "https://help.openai.com/en/articles";

export const CHATGPT_DOTS_COMPARISON: Comparison = {
  rival: { name: "ChatGPT dots", mark: "chatgpt-dots" },
  answer:
    "Choose OpenBot if you want a team of agents on your own computer, in any country, with your ChatGPT plan and the other AI plans you already pay for, such as Claude, Gemini or Grok: the app is free and needs no account. Choose ChatGPT dots if you pay for ChatGPT Pro or Business Premium, and you want one always-on agent in OpenAI's cloud.",
  chooseOpenBot: [
    "You live in the EU, Switzerland or the UK, where ChatGPT Pro does not include dots.",
    "You want ChatGPT, Claude, Gemini, Grok and Cursor agents in one team, or your own model.",
    "Your files and chats must stay on your own computer, not in OpenAI's cloud.",
    "You want a free app that works without an account, and source code that you can read.",
  ],
  rivalPlans:
    "ChatGPT dots runs on GPT-6 Astra, an OpenAI model. One dot comes with ChatGPT Pro, from $100 a month, or with Business Premium, from $100 a seat a month. Enterprise plans get a beta.",
  chooseRival: [
    "You already pay for ChatGPT Pro or Business Premium.",
    "You want an agent that works around the clock in the cloud, with no computer of yours to keep on.",
    "You want to talk to your agent in Slack, Microsoft Teams or the ChatGPT apps.",
  ],
  rows: [
    {
      icon: "cpu",
      topic: "Models and plans",
      openbot:
        "Use the plans you already have: ChatGPT, Claude, Gemini, Grok or Cursor. Or run free models and your own model through OpenCode. Choose one for each agent, and change it later.",
      rival: "GPT-6 Astra, an OpenAI model. OpenAI describes no way to use other models or your own model.",
      better: "openbot",
    },
    {
      icon: "laptop",
      topic: "Where agents work",
      openbot: "On the computer that runs OpenBot.",
      rival:
        "On a cloud computer that OpenAI runs for each dot, with Linux and Chrome. If you allow it in the ChatGPT desktop app, a dot can also use your computer.",
      better: "openbot",
    },
    {
      icon: "cloud",
      topic: "When your computer is off",
      openbot:
        "Agents keep working on the computer or server that runs OpenBot, and routines start them on a schedule. With no computer to keep on, use a hosted OpenBot server in the EU, from €20 or $25 a month.",
      rival:
        "A dot keeps working on its cloud computer while you are away, and runs reminders and recurring tasks on a schedule.",
    },
    {
      icon: "phone",
      topic: "Remote access",
      openbot:
        "Apps for iPhone and Android connect from anywhere. Chats and files go over an encrypted connection between your devices, with no VPN, and no cloud stores them.",
      rival:
        "After you create a dot on a computer, talk to it in the ChatGPT mobile app where mobile access is available, or in Slack and Microsoft Teams. Its chats and files are in your ChatGPT account.",
    },
    {
      icon: "users",
      topic: "Teams",
      openbot:
        "Each agent is a full coding agent with its own job. They give work to each other in shared channels, and coworkers can join one team host.",
      rival:
        "One dot for each person today; OpenAI plans teams of dots later. A dot works on several projects at once, can give work to other agents, and can join Slack and Teams channels.",
      better: "openbot",
    },
    {
      icon: "lock",
      topic: "Your data",
      openbot:
        "Workspaces, chats and files stay in a database on your computer. The provider you choose gets the requests you send. Product analytics, with no chat content, are on by default and linked to your account when you sign in; you can turn them off.",
      rival:
        "OpenAI keeps what a dot learns for as long as you keep the dot, and you cannot see or delete a single memory. On personal plans, the model training setting also covers the dot's work.",
      better: "openbot",
    },
    {
      icon: "tag",
      topic: "Price and account",
      openbot:
        "Free for noncommercial use; commercial use needs a license. No account is necessary on one computer. Your agents use the plans you already pay for.",
      rival:
        "Needs ChatGPT Pro, from $100 a month, or Business Premium, from $100 a seat a month for 2 seats or more. The first dot is included; OpenAI gives no price for more.",
      better: "openbot",
    },
    {
      icon: "globe",
      topic: "Where you can use it",
      openbot:
        "In any country: OpenBot has no region lock. The app is in English, French, Japanese and Turkish, and hosted servers run in the EU. Each AI provider sets the countries for its own plan.",
      rival:
        "On Pro, in the ChatGPT countries except the European Economic Area, Switzerland and the UK. On Business Premium, in all ChatGPT countries. Only for people 18 and over.",
      better: "openbot",
    },
    {
      icon: "devices",
      topic: "Apps",
      openbot: "macOS, Windows and Linux, and mobile apps for iPhone and Android.",
      rival:
        "Create a dot in the ChatGPT app for macOS or Windows, or on the web on a computer. Then talk to it in the ChatGPT mobile app, Slack or Microsoft Teams.",
    },
    {
      icon: "code",
      topic: "Source code",
      openbot: "On GitHub, under the PolyForm Noncommercial License 1.0.0.",
      rival:
        "A closed service that runs only in OpenAI's cloud. The auto-review rules that check a dot's actions are in the open-source Codex repository.",
      better: "openbot",
    },
  ],
  intro:
    "Dots are OpenAI's always-on agents in ChatGPT, which started on 29 September 2026. Each dot runs on GPT-6 Astra, has its own cloud computer, learns from your feedback, and works toward your goals around the clock, with more than 4,000 apps through plugins. OpenBot also works with your ChatGPT plan: Codex is one of its agents. The difference is where the agents run, how many work together, and where you can use them. A dot is one agent in OpenAI's cloud, and ChatGPT Pro does not include it in Europe. OpenBot runs a team of agents on your own computer, in any country, with ChatGPT and the other AI plans you choose.",
  sections: [
    {
      title: "Models and the plans you pay for",
      openbot:
        "OpenBot runs the provider tools you already use, with the plans you already pay for: Codex with your ChatGPT plan, Claude Code with your Claude plan, Gemini with your Google AI Pro or Ultra plan, Grok CLI with your Grok account or an xAI API key, and Cursor CLI with your Cursor plan or a Cursor API key. OpenCode runs free models, or your own model on any OpenAI-compatible server, also one on your computer. You choose the provider, the model and the reasoning effort for each agent. When you move an agent to a different provider, it keeps its role, workspace and conversation.",
      rival:
        "A dot runs on GPT-6 Astra, and OpenAI names no other model for it. Your first dot is included in ChatGPT Pro or Business Premium at no extra cost; OpenAI says that you can add more dots later, but gives no price. Chats with a dot do not count toward your ChatGPT limits, but the Codex and ChatGPT Work tasks that it starts do. For the first month after the start, dots usage does not count toward plan allowances.",
      better: "openbot",
    },
    {
      title: "Where the work happens",
      openbot:
        "OpenBot runs on the computer that hosts it. Agent workspaces, conversations and app data stay on that computer, so it must stay on while its agents work. Run it on a desktop or a server that stays on, and your agents keep working while your laptop is closed. With no computer to keep on, use a hosted OpenBot server: a Linux server in the EU (Germany, Finland or France), from €20 or $25 a month, that keeps the workspaces and chats of its agents. Local-first is not offline: an agent that uses a hosted provider still sends its requests to that provider.",
      rival:
        "Each dot has its own cloud computer at OpenAI, with Linux and Chrome, where it browses, makes files and runs tools. It keeps working there while you are away, and it runs reminders and recurring tasks on a schedule. Access to your own computer is off at the start: you allow it, and revoke it, in the ChatGPT desktop app. A dot can then also use your local browser when its cloud browser is blocked.",
      better: "openbot",
    },
    {
      title: "Where you can use it",
      openbot:
        "OpenBot has no region lock: download it and run it in any country. The interface is in English, French, Japanese and Turkish. Hosted OpenBot servers run in the EU, and you can pay for them in euros, US dollars or Polish złoty. Each AI provider decides where its own plan works, so check that your provider is available in your country.",
      rival:
        "On ChatGPT Pro, dots started in the ChatGPT markets except the European Economic Area, Switzerland and the UK, and OpenAI gives no date for them. On Business Premium, dots are in all the countries where ChatGPT is available. You must be 18 or older, and access can take several days to reach your account. Texting a dot is a beta for Pro users in the US only.",
      better: "openbot",
    },
    {
      title: "Phones and remote access",
      openbot:
        "The OpenBot apps for iPhone and Android connect to the computer that runs your agents. From anywhere, you chat with them, follow their progress and send files. The connection goes directly between your devices when it can, it is encrypted, and no cloud stores your chats or files. You set up no VPN or tunnel. Remote access needs an OpenBot account.",
      rival:
        "You create a dot in the ChatGPT desktop app or on the web on a computer, not on a phone. Then you talk to it in the ChatGPT mobile app, where mobile access is available, and in Slack and Microsoft Teams. Dots do not work on the mobile web. You can also talk to a dot by voice.",
    },
    {
      title: "How agents work as a team",
      openbot:
        "In OpenBot, each agent is a full coding agent: Codex, Claude Code, Gemini, Grok CLI, Cursor CLI or OpenCode, each with its own job and workspace. A lead agent can give parts of a task to other agents in a shared channel. You follow their work and step in when a decision needs you. For a team of people, one computer runs the host and the others join it; the chats and files stay on the host.",
      rival:
        "Today, each person starts with one primary dot, and OpenAI plans teams of dots that work together later. One dot works on several projects at the same time, and it can give work to other agents; its rules then apply to that work too. You can bring a dot into Slack and Microsoft Teams channels. Companies can preview specialist dots, each with its own identity.",
      better: "openbot",
    },
    {
      title: "Data and privacy",
      openbot:
        "OpenBot keeps workspaces, conversations, attachments and browser data in a SQLite database on the computer that runs it. There is no copy on OpenBot's side. An account holds your profile, team memberships, invitations, sign-in sessions, the settings that let devices find each other, and any agent templates that you publish. Product analytics, which never include chat content, are on by default and linked to your account when you sign in; you can turn them off in Settings.",
      rival:
        "A dot keeps what it learns from chats and connected apps for as long as you keep the dot. You cannot see, change or delete a single memory: only a reset of the dot deletes them, and the files and chats that it made stay. A dot shares memory with ChatGPT. On Business, Enterprise and Edu plans, OpenAI does not train on your data by default; on personal plans, the training setting also covers what a dot does. People at OpenAI can review content even with training off.",
      better: "openbot",
    },
  ],
  faq: [
    {
      question: "Is OpenBot an alternative to ChatGPT dots?",
      answer:
        "Yes, if you want your agents on your own computer. Both give you agents that keep working on your goals, and both work with your ChatGPT plan. OpenBot runs a team of agents on your computer, with Codex and the other providers you choose. A dot is one OpenAI agent on a cloud computer at OpenAI.",
    },
    {
      question: "Can I use ChatGPT dots in Europe?",
      answer:
        "Not with ChatGPT Pro, for now. Dots started for Pro in the ChatGPT markets except the European Economic Area, Switzerland and the UK, and OpenAI gives no date for them. Business Premium includes dots in all ChatGPT countries. OpenBot has no region lock: it runs on your own computer in any country, and hosted OpenBot servers run in the EU.",
    },
    {
      question: "Can I use my ChatGPT plan with OpenBot?",
      answer:
        "Yes. OpenBot runs Codex with your own ChatGPT plan, so the ChatGPT plan that you pay for works in OpenBot too. Next to it, Claude Code uses your Claude plan, Gemini a Google AI Pro or Ultra plan, Grok CLI your Grok account or an xAI API key, and Cursor CLI your Cursor plan. OpenBot adds no charge of its own.",
    },
    {
      question: "How much does ChatGPT dots cost?",
      answer:
        "Your first dot is included in ChatGPT Pro, which costs $100, $200 or $500 a month, or in Business Premium, which costs $125 a seat a month, or $100 with annual billing, for 2 seats or more. OpenAI says that you can add more dots later, but gives no price. OpenBot is free for noncommercial use, and it uses the plans you already pay for.",
    },
    {
      question: "Does a dot run on my computer?",
      answer:
        "No. Each dot works on its own cloud computer at OpenAI. Access to your computer is off at the start; you can allow it in the ChatGPT desktop app, and revoke it there. OpenBot agents work on your computer, or on a hosted OpenBot server that you choose.",
    },
    {
      question: "Do agents keep working when my laptop is closed?",
      answer:
        "Yes, with both. A dot works on OpenAI's cloud computer, so no computer of yours must stay on. OpenBot agents work on the computer or server that runs OpenBot: keep that computer on, or use a hosted OpenBot server, and connect from your laptop or phone.",
    },
    {
      question: "Is ChatGPT dots open source?",
      answer:
        "No. Dots are a closed service that runs only in OpenAI's cloud. The auto-review rules that check a dot's actions are in the open-source Codex repository. OpenBot's source code is on GitHub under the PolyForm Noncommercial License 1.0.0.",
    },
  ],
  sources: [
    { label: "Introducing dots", url: "https://openai.com/index/introducing-dots/" },
    {
      label: "Safety, security and privacy in dots",
      url: "https://openai.com/index/how-we-build-safety-security-and-privacy-into-dots/",
    },
    { label: "Dots in ChatGPT", url: "https://chatgpt.com/features/dots/" },
    { label: "Getting started with your dot", url: `${OPENAI_HELP}/20001530-getting-started-with-your-dot` },
    {
      label: "Dots privacy, security and safety FAQ",
      url: `${OPENAI_HELP}/20001529-dots-privacy-security-and-safety-faqs`,
    },
    { label: "ChatGPT release notes", url: `${OPENAI_HELP}/6825453-chatgpt-release-notes` },
    { label: "ChatGPT Pro tiers", url: `${OPENAI_HELP}/9793128-about-chatgpt-pro-tiers` },
    { label: "ChatGPT Business", url: `${OPENAI_HELP}/8792828-chatgpt-business-overview` },
    { label: "ChatGPT supported countries", url: `${OPENAI_HELP}/7947663-chatgpt-supported-countries` },
    { label: "DevDay 2026 recap", url: "https://openai.com/index/devday-2026-recap/" },
    { label: "Codex auto-review", url: "https://learn.chatgpt.com/docs/sandboxing/auto-review" },
    { label: "OpenBot privacy notes", url: OPENBOT_LINKS.privacy },
    { label: "OpenBot source code", url: OPENBOT_LINKS.repository },
  ],
  checkedAt: "2026-10-02",
};
