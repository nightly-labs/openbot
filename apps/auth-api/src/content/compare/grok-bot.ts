import { OPENBOT_LINKS } from "../../lib/landing-links";
import { type Comparison, OPENBOT_TEXT } from "./comparison";

// Every statement about Grok Bot here is taken from xAI's Grok Bot documentation,
// and each page used is in `sources`. Check them again, and move `checkedAt`,
// whenever this file changes. Statements about OpenBot follow its privacy notes and
// the remote connection that `remote/README.md` describes.

const GROK_BOT_DOCS = "https://docs.x.ai/grok-bot";

export const GROK_BOT_COMPARISON: Comparison = {
  rival: { name: "Grok Bot", mark: "grok-bot" },
  answer:
    "For most people, OpenBot is the better choice: your agents use the AI plans you already pay for, such as ChatGPT, Claude, Gemini or Grok, or your own model. They run on your own computer, and the app is free. Choose Grok Bot only if you want a cloud computer to run your Bots, so that you keep no computer of your own on.",
  chooseOpenBot: [
    "You already pay for ChatGPT, Claude, Gemini, Grok, Cursor, Cline or Muse Code, or you run your own model.",
    "Your files and chats must stay on your own computer.",
    "You want to reach your agents from your phone while they work on your own computer or server.",
    "You want a free app.",
    "You want to read the source code.",
  ],
  rivalPlans: "Cursor manages model selection. Grok Bot comes with paid Cursor plans and SuperGrok subscriptions.",
  chooseRival: [
    "You do not want to keep a computer on for your agents.",
    "You already pay for Cursor or SuperGrok.",
    "You want an iPad app.",
  ],
  rows: [
    {
      icon: "cpu",
      topic: "Models and plans",
      openbot: OPENBOT_TEXT.models,
      rival: "Cursor manages model selection.",
      better: "openbot",
    },
    {
      icon: "laptop",
      topic: "Where agents work",
      openbot: "On the computer that runs OpenBot.",
      rival:
        "On a cloud computer that Cursor hosts, in the United States. With approval, it can also run tasks on your own computer.",
      better: "openbot",
    },
    {
      icon: "cloud",
      topic: "When your computer is off",
      openbot: OPENBOT_TEXT.offline,
      rival: "Cloud work continues when you close the app or your laptop. You keep no computer on.",
    },
    {
      icon: "phone",
      topic: "Remote access",
      openbot: OPENBOT_TEXT.remote,
      rival: "The apps connect to the cloud computer that Cursor hosts, where your Bots and their files are.",
      better: "openbot",
    },
    {
      icon: "refresh",
      topic: "Backup models",
      openbot: OPENBOT_TEXT.backupModels,
      rival:
        "Cursor manages model selection, and you cannot choose a model. When weekly usage runs out, Grok Bot stops, unless you turn on on-demand usage.",
      better: "openbot",
    },
    {
      icon: "key",
      topic: "Logins and payments",
      openbot: OPENBOT_TEXT.logins,
      rival:
        "Logins stay signed in on the cloud computer, and every Bot of the account shares them. For passwords, 2FA and payment steps, you take over the computer. xAI names no password manager or saved cards.",
      better: "openbot",
    },
    {
      icon: "mic",
      topic: "Voice",
      openbot: OPENBOT_TEXT.voice,
      rival:
        "Dictate messages, or start a live voice chat on desktop and mobile. A Bot can reply with a voice memo. xAI does not say where it processes speech.",
    },
    {
      icon: "contact",
      topic: "Chat apps",
      openbot: OPENBOT_TEXT.chatApps,
      rival:
        "Team Bots work in Slack direct messages and channels, and you can tag @bot in a post on X. xAI names no Discord, Telegram or WhatsApp.",
    },
    {
      icon: "users",
      topic: "Teams",
      openbot:
        "One computer runs a team host and coworkers join it. Agents give work to each other in shared channels. Roles set which agents each member can view, chat with or manage.",
      rival:
        "Group chats with two to six Bots, and messages from Bot to Bot. On the Teams plan, every member gets Bots.",
    },
    {
      icon: "lock",
      topic: "Your data",
      openbot:
        "Workspaces, chats and files stay in a database on your computer. The provider you choose gets the requests you send.",
      rival: "Needs cloud data storage. With Privacy Mode on, customer data is not used for training.",
      better: "openbot",
    },
    {
      icon: "tag",
      topic: "Price and account",
      openbot:
        "Free for noncommercial use; commercial use needs a license. Your agents use the plans you already pay for.",
      rival: "Included with paid Cursor plans and SuperGrok subscriptions. Needs a Cursor account.",
      better: "openbot",
    },
    {
      icon: "globe",
      topic: "Where you can use it",
      openbot: OPENBOT_TEXT.regions,
      rival:
        "xAI publishes no list of countries for Grok Bot. Its cloud computers run in the United States. The desktop app is in more than 20 languages.",
    },
    {
      icon: "devices",
      topic: "Apps",
      openbot: OPENBOT_TEXT.apps,
      rival: "macOS, Windows and Linux, and mobile apps for iPhone, iPad and Android.",
    },
    {
      icon: "code",
      topic: "Source code",
      openbot: "On GitHub, under the PolyForm Noncommercial License 1.0.0.",
      rival: "Not stated by xAI.",
      better: "openbot",
    },
  ],
  intro:
    "Both products give you AI agents that stay: each one has a name, a job and its own conversation, and you come back to it as the work grows. In both, agents can pass work to each other, so you do not relay every message yourself. The difference is where that work runs, and how much of it you control.",
  sections: [
    {
      title: "Models and the plans you pay for",
      openbot: OPENBOT_TEXT.plansSection,
      rival:
        "Grok Bot gives you a managed environment: Cursor manages model selection and the computer. It comes with paid Cursor plans and SuperGrok subscriptions, so you pay for the plan that Grok Bot is part of. There is less to set up, and less of the environment is yours to change.",
      better: "openbot",
    },
    {
      title: "Where the work happens",
      openbot: OPENBOT_TEXT.workSection,
      rival:
        "Grok Bot works from a persistent cloud computer that Cursor hosts. One computer belongs to each account, and all of its Bots share it: files, browser sessions and signed-in accounts. Closing the app or your laptop does not stop cloud work.",
      better: "openbot",
    },
    {
      title: "Phones and remote access",
      openbot: OPENBOT_TEXT.phonesSection,
      rival:
        "Grok Bot has apps for iPhone, iPad and Android. Your Bots work on the cloud computer that Cursor hosts, so there is no computer of your own to keep on. Their files, browser sessions and signed-in accounts are on that cloud computer.",
      better: "openbot",
    },
    {
      title: "How agents work as a team",
      openbot:
        "In OpenBot, a lead agent can give parts of a task to other agents in a shared channel. You follow their work and step in when a decision needs you. For a team of people, one computer runs the host and the others join it; the chats and files stay on the host. Roles set which agents each member can view, chat with or manage.",
      rival:
        "Grok Bot puts two to six Bots in a group chat, and one Bot can send a message to another that it answers later. Because the Bots of an account share one computer, a login or file there is available to every Bot. On the Teams plan, every member has Bots of their own.",
    },
    {
      title: "Data and privacy",
      openbot:
        "OpenBot keeps workspaces, conversations, attachments and browser data in a SQLite database on the computer that runs it. OpenBot keeps no other copy. On a hosted OpenBot server, the database is on that server in the EU. An account holds only your profile, team memberships, invitations, sign-in sessions and the settings that let devices find each other.",
      rival:
        "Grok Bot needs cloud data storage, and its computers run in the United States. With Privacy Mode on, customer data is not used for training. Connector tokens are never stored on the computer, and Cursor keeps a record of Bot actions for 90 days.",
      better: "openbot",
    },
  ],
  faq: [
    {
      question: "Is OpenBot an alternative to Grok Bot?",
      answer:
        "Yes, if you want your agents on your own computer. Both give you persistent AI agents that work as a team. OpenBot runs them on your computer with the provider tools you choose. Grok Bot runs them on a cloud computer that Cursor hosts.",
    },
    {
      question: "Why choose OpenBot over Grok Bot?",
      answer:
        "Your agents use the AI plans you already pay for, such as ChatGPT, Claude, Gemini or Grok, or your own model. OpenBot keeps your workspaces, chats and files on your own computer, the app is free, and its source code is on GitHub. You can reach your agents from your phone too. Grok Bot is the better fit only when you do not want to keep any computer on for your agents.",
    },
    {
      question: "Can I use my ChatGPT, Claude or Gemini subscription with OpenBot?",
      answer: OPENBOT_TEXT.plansFaq,
    },
    {
      question: "Can I use my own model with OpenBot?",
      answer:
        "Yes. Through OpenCode, an agent can use any OpenAI-compatible server, also a model that runs on your own computer. You add the address of the server, and an API key if it needs one.",
    },
    {
      question: "Can OpenBot use Grok models?",
      answer:
        "Yes. OpenBot can run Grok CLI as the provider of an agent, next to Codex, Claude Code, Gemini, Cursor CLI, Cline, OpenCode, Pi and Muse Code. Grok CLI then sends that agent's requests to xAI.",
    },
    {
      question: "Does Grok Bot run on my computer?",
      answer:
        "Grok Bot works from a persistent cloud computer. Through the desktop app, it can also open files and run tasks on your own computer when the settings allow it. By default, it asks before each task.",
    },
    {
      question: "Do my chats leave my computer with OpenBot?",
      answer:
        "OpenBot keeps workspaces, conversations and files in a database on the computer that runs it, and OpenBot holds no copy. The provider you choose still gets the requests that your agents send to it.",
    },
    {
      question: "Do agents keep working when my laptop is closed?",
      answer:
        "Yes, with both. With OpenBot, run it on a desktop or a server that stays on, or on a hosted OpenBot server, and connect from your laptop or phone. Only that computer must stay on. With Grok Bot, closing the app or your laptop does not stop cloud work.",
    },
    {
      question: "Does OpenBot have a mobile app?",
      answer:
        "Yes. The OpenBot apps for iPhone and Android connect to the computer that runs your agents, over an encrypted connection. That computer must stay on, and remote access needs an OpenBot account. Your chats and files stay on that computer.",
    },
    {
      question: "How much do OpenBot and Grok Bot cost?",
      answer:
        "OpenBot is free for noncommercial use, and commercial use needs a separate license. Each provider tool uses its own plan or API key. Grok Bot is included with paid Cursor plans, the Cursor Teams plan, and SuperGrok subscriptions linked to a Cursor account.",
    },
  ],
  sources: [
    { label: "Grok Bot overview", url: `${GROK_BOT_DOCS}/overview` },
    { label: "Get started with Grok Bot", url: `${GROK_BOT_DOCS}/get-started` },
    { label: "Grok Bot computer and apps", url: `${GROK_BOT_DOCS}/computer-and-apps` },
    { label: "Grok Bot chat and collaboration", url: `${GROK_BOT_DOCS}/chat-and-collaboration` },
    { label: "Grok Bot for teams and enterprises", url: `${GROK_BOT_DOCS}/teams-and-enterprises` },
    { label: "Grok Bot settings and languages", url: `${GROK_BOT_DOCS}/settings-and-notifications` },
    { label: "Grok Bot security", url: `${GROK_BOT_DOCS}/security` },
    { label: "Grok Bot plans and billing", url: "https://cursor.com/help/grok-bot/plans" },
    { label: "Grok Bot on mobile", url: "https://docs.x.ai/grok-bot/mobile" },
    { label: "Grok Bot Team Bots", url: "https://docs.x.ai/grok-bot/team-bots" },
    { label: "Grok Bot tag on X", url: "https://docs.x.ai/grok-bot/tag-on-x" },
    { label: "OpenBot privacy notes", url: OPENBOT_LINKS.privacy },
    { label: "OpenBot source code", url: OPENBOT_LINKS.repository },
  ],
  checkedAt: "2026-10-02",
};
