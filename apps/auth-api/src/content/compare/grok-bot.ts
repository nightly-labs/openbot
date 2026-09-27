import { OPENBOT_LINKS } from "../../lib/landing-links";
import type { Comparison } from "./comparison";

// Every statement about Grok Bot here is taken from xAI's Grok Bot documentation,
// and each page used is in `sources`. Check them again, and move `checkedAt`,
// whenever this file changes. Statements about OpenBot follow its privacy notes and
// the remote connection that `remote/README.md` describes.

const GROK_BOT_DOCS = "https://docs.x.ai/grok-bot";

export const GROK_BOT_COMPARISON: Comparison = {
  rival: { name: "Grok Bot", mark: "grok-bot" },
  answer:
    "For most people, OpenBot is the better choice: your agents use the AI plans you already pay for, such as ChatGPT, Claude, Gemini or Grok, or your own model. They run on your own computer, and the app is free and needs no account. Choose Grok Bot only if you want a cloud computer to run your Bots, so that you keep no computer of your own on.",
  chooseOpenBot: [
    "You already pay for ChatGPT, Claude, Gemini or Grok, or you run your own model.",
    "Your files and chats must stay on your own computer.",
    "You want to reach your agents from your phone while they work on your own computer or server.",
    "You want a free app that works without an account.",
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
      openbot:
        "Use the plans you already have: ChatGPT, Claude, Gemini or Grok. Or run free models and your own model through OpenCode. Choose one for each agent, and change it later.",
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
      openbot:
        "Agents keep working on the computer or server that runs OpenBot. Only that computer must stay on, not your laptop.",
      rival: "Cloud work continues when you close the app or your laptop. You keep no computer on.",
      better: "rival",
    },
    {
      icon: "phone",
      topic: "Remote access",
      openbot:
        "Connect from your phone or another computer. Chats and files go over an encrypted connection between your devices, and no cloud stores them.",
      rival: "The apps connect to the cloud computer that Cursor hosts, where your Bots and their files are.",
      better: "openbot",
    },
    {
      icon: "users",
      topic: "Teams",
      openbot:
        "One computer runs a team host and coworkers join it. Agents give work to each other in shared channels.",
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
        "Free for noncommercial use; commercial use needs a license. No account is necessary on one computer. Your agents use the plans you already pay for.",
      rival: "Included with paid Cursor plans and SuperGrok subscriptions. Needs a Cursor account.",
      better: "openbot",
    },
    {
      icon: "devices",
      topic: "Apps",
      openbot: "macOS, Windows and Linux, and mobile apps for iPhone and Android.",
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
      openbot:
        "OpenBot runs the provider tools you already use, with the plans you already pay for: Codex with your ChatGPT plan, Claude Code with your Claude plan, Gemini with your Google AI Pro or Ultra plan, and Grok CLI with your Grok account or an xAI API key. OpenCode runs free models, or your own model on any OpenAI-compatible server, also one on your computer. You choose the provider, the model and the reasoning effort for each agent. When you move an agent to a different provider, it keeps its role, workspace and conversation.",
      rival:
        "Grok Bot gives you a managed environment: Cursor manages model selection and the computer. It comes with paid Cursor plans and SuperGrok subscriptions, so you pay for the plan that Grok Bot is part of. There is less to set up, and less of the environment is yours to change.",
      better: "openbot",
    },
    {
      title: "Where the work happens",
      openbot:
        "OpenBot runs on the computer that hosts it. Agent workspaces, conversations and app data stay on that computer, so it must stay on while its agents work. Run it on a desktop or a server that stays on, and your agents keep working while your laptop is closed. Local-first is not offline: an agent that uses a hosted provider still sends its requests to that provider.",
      rival:
        "Grok Bot works from a persistent cloud computer that Cursor hosts. One computer belongs to each account, and all of its Bots share it: files, browser sessions and signed-in accounts. Closing the app or your laptop does not stop cloud work.",
      better: "openbot",
    },
    {
      title: "Phones and remote access",
      openbot:
        "The OpenBot apps for iPhone and Android connect to the computer that runs your agents. From anywhere, you chat with them, follow their progress and send files. The connection goes directly between your devices when it can, it is encrypted, and no cloud stores your chats or files. Remote access needs an OpenBot account.",
      rival:
        "Grok Bot has apps for iPhone, iPad and Android. Your Bots work on the cloud computer that Cursor hosts, so there is no computer of your own to keep on. Their files, browser sessions and signed-in accounts are on that cloud computer.",
      better: "openbot",
    },
    {
      title: "How agents work as a team",
      openbot:
        "In OpenBot, a lead agent can give parts of a task to other agents in a shared channel. You follow their work and step in when a decision needs you. For a team of people, one computer runs the host and the others join it; the chats and files stay on the host.",
      rival:
        "Grok Bot puts two to six Bots in a group chat, and one Bot can send a message to another that it answers later. Because the Bots of an account share one computer, a login or file there is available to every Bot. On the Teams plan, every member has Bots of their own.",
    },
    {
      title: "Data and privacy",
      openbot:
        "OpenBot keeps workspaces, conversations, attachments and browser data in a SQLite database on the computer that runs it. There is no copy on OpenBot's side. An account holds only your profile, team memberships, invitations, sign-in sessions and the settings that let devices find each other.",
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
        "Your agents use the AI plans you already pay for, such as ChatGPT, Claude, Gemini or Grok, or your own model. OpenBot keeps your workspaces, chats and files on your own computer, the app is free and works without an account, and its source code is on GitHub. You can reach your agents from your phone too. Grok Bot is the better fit only when you do not want to keep any computer on for your agents.",
    },
    {
      question: "Can I use my ChatGPT, Claude or Gemini subscription with OpenBot?",
      answer:
        "Yes. OpenBot signs in to each provider tool with your own account: your ChatGPT plan for Codex, your Claude plan for Claude Code, and a Google AI Pro or Ultra plan for Gemini. Grok CLI uses your Grok account or an xAI API key. OpenBot adds no charge of its own.",
    },
    {
      question: "Can I use my own model with OpenBot?",
      answer:
        "Yes. Through OpenCode, an agent can use any OpenAI-compatible server, also a model that runs on your own computer. You add the address of the server, and an API key if it needs one.",
    },
    {
      question: "Can OpenBot use Grok models?",
      answer:
        "Yes. OpenBot can run Grok CLI as the provider of an agent, next to Codex, Claude Code and OpenCode. Grok CLI then sends that agent's requests to xAI.",
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
        "Yes, with both. With OpenBot, run it on a desktop or a server that stays on, and connect from your laptop or phone. Only that computer must stay on. With Grok Bot, closing the app or your laptop does not stop cloud work.",
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
    { label: "Grok Bot security", url: `${GROK_BOT_DOCS}/security` },
    { label: "OpenBot privacy notes", url: OPENBOT_LINKS.privacy },
    { label: "OpenBot source code", url: OPENBOT_LINKS.repository },
  ],
  checkedAt: "2026-09-27",
};
