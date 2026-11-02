import { OPENBOT_LINKS } from "../../lib/landing-links";
import { type Comparison, OPENBOT_TEXT } from "./comparison";

// Every statement about Manus here is taken from manus.im, its documentation, help
// center, Trust Center, terms and privacy policy, and each page used is in `sources`.
// Where they state nothing, the text says so. Where two of its pages disagree, the text
// gives both or leaves the detail out. Check them again, and move `checkedAt`, whenever
// this file changes.

const MANUS_HELP = "https://help.manus.im/en/articles";

export const MANUS_COMPARISON: Comparison = {
  rival: { name: "Manus", mark: "manus" },
  answer:
    "Choose OpenBot if you want your agents on your own computer, with the AI plans you already pay for, such as ChatGPT, Claude, Gemini or Grok: the app is free. Choose Manus if you want a general agent that works in its own cloud computer, keeps working with no computer of yours on, and chooses the model for you.",
  chooseOpenBot: [
    "You already pay for ChatGPT, Claude, Gemini, Grok, Cursor, Cline or Muse Code, or you run your own model.",
    "Your files and chats must stay on your own computer, not in a cloud in the US or Singapore.",
    "You want a team of coding agents that give work to each other, each with its own job.",
    "You want a desktop app for Linux, or a free app.",
  ],
  rivalPlans:
    "Manus chooses the model for each task; you choose only between Manus 2.0 Lite, Manus 2.0 and Manus 2.0 Max. You pay Manus in credits: 300 free credits a day, or Pro plans from $20 a month.",
  chooseRival: [
    "You want an agent that works in a cloud computer, with no computer of yours to keep on.",
    "You want research, websites and slides from one prompt, with many agents in parallel.",
    "You want to give it tasks in LINE or by email.",
  ],
  rows: [
    {
      icon: "cpu",
      topic: "Models and plans",
      openbot: OPENBOT_TEXT.models,
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
      openbot: OPENBOT_TEXT.offline,
      rival:
        "Cloud tasks keep working after you close the app, and scheduled tasks run while you are offline. Tasks on your own computer need it on.",
    },
    {
      icon: "phone",
      topic: "Remote access",
      openbot: OPENBOT_TEXT.remote,
      rival:
        "Apps for iPhone and Android and a web app. You can also give tasks in Telegram, WhatsApp Business, LINE, Slack or email. The tasks and their files stay in Manus's cloud.",
    },
    {
      icon: "refresh",
      topic: "Backup models",
      openbot: OPENBOT_TEXT.backupModels,
      rival:
        "Manus chooses the model for each task. With Manus Flex, you can use your own API key. Manus states no move to a backup model.",
      better: "openbot",
    },
    {
      icon: "key",
      topic: "Logins and payments",
      openbot: OPENBOT_TEXT.logins,
      rival:
        "You sign in to sites yourself in Manus's cloud browser, and Manus keeps the session but not your password. You take over the browser for codes and CAPTCHAs. Manus states no password manager or saved cards.",
      better: "openbot",
    },
    {
      icon: "mic",
      topic: "Voice",
      openbot: OPENBOT_TEXT.voice,
      rival:
        "You can give a voice command in the phone app, and Manus writes out the voice messages that you send in chat apps. Manus states no reading of replies aloud.",
      better: "openbot",
    },
    {
      icon: "contact",
      topic: "Chat apps",
      openbot: OPENBOT_TEXT.chatApps,
      rival: "Slack, Telegram, LINE and email. Cue, its app for personal agents, also connects to iMessage.",
    },
    {
      icon: "users",
      topic: "Teams",
      openbot: OPENBOT_TEXT.teams,
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
        "Free for noncommercial use; commercial use needs a license. Your agents use the plans you already pay for.",
      rival:
        "Free with 300 credits a day. Pro plans from $20 to $200 a month, and the Team plan from $20 a seat. Needs an account, and is for people aged 18 or more.",
      better: "openbot",
    },
    {
      icon: "globe",
      topic: "Where you can use it",
      openbot: OPENBOT_TEXT.regions,
      rival:
        "Worldwide, except countries under a US embargo, for people 18 and over. Its data is stored in the US and Singapore. The website is in 17 languages.",
    },
    {
      icon: "devices",
      topic: "Apps",
      openbot: OPENBOT_TEXT.apps,
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
      openbot: OPENBOT_TEXT.plansSection,
      rival:
        "Manus says it is LLM-agnostic: it chooses the right model for each task, so you do not have to. It does not name the models. You choose only between its own tiers: the free plan gets Manus 2.0 Lite in Agent mode, and paid plans also get Manus 2.0 and Manus 2.0 Max. You pay Manus in credits, and a plan that you already pay for at another AI company does not apply.",
      better: "openbot",
    },
    {
      title: "Where the work happens",
      openbot: OPENBOT_TEXT.workSection,
      rival:
        "By default, each Manus task works in a temporary sandbox: a virtual computer with internet access in Manus's cloud. A Cloud Computer that stays on costs $30 or $50 a month more. Cloud tasks and scheduled tasks keep running while you are offline. Since March 2026, the desktop app for macOS and Windows can also let Manus run commands in the folders that you allow on your own computer; those tasks need that computer on.",
      better: "openbot",
    },
    {
      title: "Phones and remote access",
      openbot: OPENBOT_TEXT.phonesSection,
      rival:
        "Manus has apps for iPhone and Android and a web app. You can also give it tasks in Telegram, WhatsApp Business, LINE or Slack, or by email; one messaging app at a time for each workspace. The work itself happens in Manus's cloud, or on your computer when you use the desktop app.",
    },
    {
      title: "How agents work as a team",
      openbot: OPENBOT_TEXT.teamSection,
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
        "Your agents use the AI plans you already pay for, such as ChatGPT, Claude, Gemini or Grok, or your own model. OpenBot keeps your workspaces, chats and files on your own computer, it runs a team of coding agents, and it has desktop apps for macOS, Windows and Linux. The app is free, and its source code is on GitHub. Manus is the better fit when you want an agent with no computer of yours to keep on.",
    },
    {
      question: "Can I use my ChatGPT, Claude or Gemini subscription with OpenBot?",
      answer: OPENBOT_TEXT.plansFaq,
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
    { label: "Introducing Manus Flex", url: "https://manus.im/blog/introducing-manus-flex" },
    { label: "Manus Cloud Browser", url: "https://manus.im/docs/features/cloud-browser" },
    { label: "What is new in Manus 2.0", url: "https://help.manus.im/en/articles/17190150-what-is-new-in-manus-2-0" },
    {
      label: "Manus on LINE",
      url: "https://help.manus.im/en/articles/14495248-sending-and-receiving-messages-on-line",
    },
    {
      label: "Manus in Slack",
      url: "https://help.manus.im/en/articles/14432468-how-do-i-set-up-connect-and-use-manus-agents-in-slack",
    },
    {
      label: "Cue messaging apps",
      url: "https://help.manus.im/en/articles/14178640-can-i-connect-multiple-messaging-agents-at-once-in-cue",
    },
    { label: "OpenBot privacy notes", url: OPENBOT_LINKS.privacy },
    { label: "OpenBot source code", url: OPENBOT_LINKS.repository },
  ],
  checkedAt: "2026-10-02",
};
