import { OPENBOT_LINKS } from "../../lib/landing-links";
import type { Comparison } from "./comparison";

// Every statement about Devin here is taken from devin.ai, the Devin documentation,
// cognition.com and Cognition's terms and Trust Center, and each page used is in
// `sources`. Where they state nothing, the text says so. Check them again, and move
// `checkedAt`, whenever this file changes. Devin Desktop was Windsurf until June 2026.

const DEVIN_DOCS = "https://docs.devin.ai";

export const DEVIN_COMPARISON: Comparison = {
  rival: { name: "Devin", mark: "devin" },
  answer:
    "Choose OpenBot if you want coding agents on your own computer that use the AI plans you already pay for, such as ChatGPT, Claude, Gemini or Grok: the app is free and needs no account. Choose Devin if you want an autonomous software engineer that works in Cognition's cloud, with no computer of yours on, and starts from Slack, GitHub, Linear or Jira.",
  chooseOpenBot: [
    "You already pay for ChatGPT, Claude, Gemini, Grok or Cursor, and want your agents to use that plan.",
    "Your code and chats must stay on your own computer, not in Cognition's cloud.",
    "You want no app vendor to keep your code or train models on it.",
    "You want native apps for iPhone and Android, or a free app that works without an account.",
  ],
  rivalPlans:
    "Devin chooses from models by Anthropic, OpenAI, Google, Cognition and open-source labs, and you pay Devin for use: Free with a light quota, Pro $20 a month, Max $200 a month. It does not take your own API keys.",
  chooseRival: [
    "You want agents in cloud virtual machines that keep working while your laptop is closed.",
    "You want to start work from Slack, Microsoft Teams, GitHub, Linear or Jira.",
    "You want many Devin sessions in parallel, each in its own virtual machine.",
  ],
  rows: [
    {
      icon: "cpu",
      topic: "Models and plans",
      openbot:
        "Use the plans you already have: ChatGPT, Claude, Gemini, Grok or Cursor. Or run free models and your own model through OpenCode. Choose one for each agent, and change it later.",
      rival:
        "Models from Anthropic, OpenAI, Google, Cognition and open-source labs, paid through your Devin plan. No own API keys. On paid plans, Devin Desktop can also run agents such as Codex CLI or Gemini CLI, billed by their provider.",
      better: "openbot",
    },
    {
      icon: "laptop",
      topic: "Where agents work",
      openbot: "On the computer that runs OpenBot.",
      rival:
        "In virtual machines in Cognition's cloud, or on your computer with Devin Desktop or the Devin CLI. The agent's planning always runs in Cognition's cloud.",
    },
    {
      icon: "cloud",
      topic: "When your computer is off",
      openbot:
        "Agents keep working on the computer or server that runs OpenBot, and routines start them on a schedule. With no computer to keep on, use a hosted OpenBot server in the EU, from €20 or $25 a month.",
      rival:
        "Devin Cloud keeps working when you close your laptop. Automations start sessions on a schedule or from events.",
    },
    {
      icon: "phone",
      topic: "Remote access",
      openbot:
        "Apps for iPhone and Android connect from anywhere. Chats and files go over an encrypted connection between your devices, with no VPN, and no cloud stores them.",
      rival:
        "A web app that you can install on your phone from the browser. Start sessions from Slack, Microsoft Teams, Linear, Jira or a GitHub comment. No iPhone or Android app is listed.",
    },
    {
      icon: "users",
      topic: "Teams",
      openbot:
        "Each agent is a full coding agent with its own job. They give work to each other in shared channels, and coworkers can join one team host.",
      rival:
        "Devin can hand parts of a task to managed Devins, each in its own virtual machine. The Teams plan takes up to 200 users, with no limit on parallel sessions.",
    },
    {
      icon: "lock",
      topic: "Your data",
      openbot:
        "Workspaces, chats and files stay in a database on your computer. The provider you choose gets the requests you send. Product analytics, with no chat content, are on by default and linked to your account when you sign in; you can turn them off.",
      rival:
        "Code and sessions are processed in Cognition's cloud. By default, Cognition can use your data for model training; only paid plans can opt out.",
      better: "openbot",
    },
    {
      icon: "tag",
      topic: "Price and account",
      openbot:
        "Free for noncommercial use; commercial use needs a license. No account is necessary on one computer. Your agents use the plans you already pay for.",
      rival:
        "Free with a light quota. Pro $20 a month, Max $200 a month, and Teams $80 a month plus $40 for each full seat. Every app needs a Devin account.",
      better: "openbot",
    },
    {
      icon: "globe",
      topic: "Where you can use it",
      openbot:
        "In any country: OpenBot has no region lock. The app is in English, French, Japanese and Turkish, and hosted servers run in the EU. Each AI provider sets the countries for its own plan.",
      rival:
        "Cognition lists no countries; its terms exclude countries under a US embargo. Devin works in Cognition's cloud, and Cognition names no EU data region.",
    },
    {
      icon: "devices",
      topic: "Apps",
      openbot: "macOS, Windows and Linux, and mobile apps for iPhone and Android.",
      rival:
        "Devin Desktop and the Devin CLI for macOS, Windows and Linux, a web app, and plugins for JetBrains IDEs. No native mobile app is listed.",
    },
    {
      icon: "code",
      topic: "Source code",
      openbot: "On GitHub, under the PolyForm Noncommercial License 1.0.0.",
      rival: "Proprietary. Cognition's terms prohibit reverse engineering.",
      better: "openbot",
    },
  ],
  intro:
    "Devin is Cognition's autonomous AI software engineer: it can write, run and test code, and open the pull request. In 2025 Cognition acquired Windsurf, and in June 2026 Windsurf became Devin Desktop. Devin now has four parts: Devin Cloud, Devin Desktop, the Devin CLI and Devin Review. OpenBot's agents are coding agents too. The difference is where they run and whose plan pays for them. Devin works mainly in Cognition's cloud, paid through a Devin plan. OpenBot runs a team of agents on your own computer, with the AI plans you choose.",
  sections: [
    {
      title: "Models and the plans you pay for",
      openbot:
        "OpenBot runs the provider tools you already use, with the plans you already pay for: Codex with your ChatGPT plan, Claude Code with your Claude plan, Gemini with your Google AI Pro or Ultra plan, Grok CLI with your Grok account or an xAI API key, and Cursor CLI with your Cursor plan or a Cursor API key. OpenCode runs free models, or your own model on any OpenAI-compatible server, also one on your computer. You choose the provider, the model and the reasoning effort for each agent. When you move an agent to a different provider, it keeps its role, workspace and conversation.",
      rival:
        "Devin supports the latest models from Anthropic, OpenAI, Google and Cognition, and open-source models such as DeepSeek, Kimi and GLM. You choose a model in Devin Desktop and the CLI, and a mode in Devin Cloud. Cognition's own SWE-2 model is post-trained from Kimi K3. Devin does not take your own API keys: you pay through your Devin plan, and extra use is billed at API prices. On Pro, Max and Teams, Devin Desktop can also run third-party agents such as Codex CLI, Claude Agent, OpenCode and Gemini CLI; their provider bills you directly.",
      better: "openbot",
    },
    {
      title: "Where the work happens",
      openbot:
        "OpenBot runs on the computer that hosts it. Agent workspaces, conversations and app data stay on that computer, so it must stay on while its agents work. Run it on a desktop or a server that stays on, and your agents keep working while your laptop is closed. With no computer to keep on, use a hosted OpenBot server: a Linux server in the EU (Germany, Finland or France), from €20 or $25 a month, that keeps the workspaces and chats of its agents. Local-first is not offline: an agent that uses a hosted provider still sends its requests to that provider.",
      rival:
        "Devin Cloud works in virtual machines in Cognition's cloud, and it keeps working when you close your laptop. Automations start sessions from a schedule, Slack, GitHub, Linear or a webhook. Devin Desktop and the Devin CLI run on your own computer. With Outposts, commands can run on machines that you operate. In every case, the agent's planning and inference run in Cognition's cloud; Enterprise can have a dedicated deployment.",
    },
    {
      title: "Phones and remote access",
      openbot:
        "The OpenBot apps for iPhone and Android connect to the computer that runs your agents. From anywhere, you chat with them, follow their progress and send files. The connection goes directly between your devices when it can, it is encrypted, and no cloud stores your chats or files. You set up no VPN or tunnel. Remote access needs an OpenBot account.",
      rival:
        "Devin's web app can be installed on a phone from the browser, as a Progressive Web App. You can also start sessions from Slack, Microsoft Teams, Linear or Jira, from a GitHub pull request with a /devin comment, or through the Devin API. The sessions themselves run in Cognition's cloud. We found no Devin app in the App Store or Google Play.",
    },
    {
      title: "How agents work as a team",
      openbot:
        "In OpenBot, each agent is a full coding agent: Codex, Claude Code, Gemini, Grok CLI, Cursor CLI or OpenCode, each with its own job and workspace. A lead agent can give parts of a task to other agents in a shared channel. You follow their work and step in when a decision needs you. For a team of people, one computer runs the host and the others join it; the chats and files stay on the host.",
      rival:
        "Devin can give parts of a large task to a team of managed Devins that work in parallel, each in its own virtual machine, and the Devin CLI has subagents. Pro and Max run up to 10 sessions at the same time; Teams and Enterprise have no limit. The Teams plan takes up to 200 users, with shared work and an admin dashboard; Enterprise adds single sign-on and a dedicated deployment.",
    },
    {
      title: "Data and privacy",
      openbot:
        "OpenBot keeps workspaces, conversations, attachments and browser data in a SQLite database on the computer that runs it. There is no copy on OpenBot's side. An account holds your profile, team memberships, invitations, sign-in sessions, the settings that let devices find each other, and any agent templates that you publish. Product analytics, which never include chat content, are on by default and linked to your account when you sign in; you can turn them off in Settings.",
      rival:
        "Devin processes your code and sessions in Cognition's cloud on AWS, and keeps the data for as long as you are a customer. By default, Cognition can use your data for model training; on a paid plan you can opt out, and on Enterprise it trains only with your written consent. Cognition is SOC 2 Type II certified. A deployment in your own cloud is only for Enterprise.",
      better: "openbot",
    },
  ],
  faq: [
    {
      question: "Is OpenBot an alternative to Devin?",
      answer:
        "Yes, if you want your coding agents on your own computer. Both give you agents that write, run and test code. OpenBot runs a team of agents on your computer with the AI plans you choose. Devin is an autonomous software engineer that works mainly in Cognition's cloud, paid through a Devin plan.",
    },
    {
      question: "Why choose OpenBot over Devin?",
      answer:
        "Your agents use the AI plans you already pay for, such as ChatGPT, Claude, Gemini or Grok, or your own model. OpenBot keeps your code, chats and files on your own computer, and OpenBot does not train models on them. It has native apps for iPhone and Android. The app is free, works without an account, and its source code is on GitHub. Devin is the better fit when you want agents in the cloud that start from Slack, GitHub or Jira.",
    },
    {
      question: "Can I use my ChatGPT, Claude or Gemini subscription with OpenBot?",
      answer:
        "Yes. OpenBot signs in to each provider tool with your own account: your ChatGPT plan for Codex, your Claude plan for Claude Code, and a Google AI Pro or Ultra plan for Gemini. Grok CLI uses your Grok account or an xAI API key, and Cursor CLI your Cursor plan. OpenBot adds no charge of its own.",
    },
    {
      question: "Can I use my own API key or plan with Devin?",
      answer:
        "Not for Devin's own agent: Cognition says Devin does not support third-party API keys, and you pay through your Devin plan. On Pro, Max and Teams, Devin Desktop can run third-party agents such as Codex CLI or Gemini CLI, and those providers bill you directly.",
    },
    {
      question: "Is Devin Desktop the same as Windsurf?",
      answer:
        "Yes. Cognition acquired Windsurf in 2025, and in June 2026 it launched the next version of Windsurf as Devin Desktop. Its Devin Local agent replaces Cascade. Devin Local runs on your computer, but its model still runs in Cognition's cloud.",
    },
    {
      question: "Does Devin train on my code?",
      answer:
        "It can. Cognition's terms say that it may use customer data for model training, and that customers on a paid plan can opt out. On Enterprise, Cognition trains only with your written consent. OpenBot does not train models; your provider's own terms apply to the requests you send it.",
    },
    {
      question: "Do agents keep working when my laptop is closed?",
      answer:
        "Yes, with both. Devin Cloud works in Cognition's cloud, so no computer of yours must stay on. OpenBot agents work on the computer or server that runs OpenBot: keep that computer on, or use a hosted OpenBot server, and connect from your laptop or phone.",
    },
    {
      question: "How much do OpenBot and Devin cost?",
      answer:
        "OpenBot is free for noncommercial use, commercial use needs a separate license, and your agents use the plans you already pay for. Devin has a free plan with a light quota; Pro costs $20 a month, Max $200 a month, and Teams $80 a month plus $40 for each full seat. Extra use is billed at API prices.",
    },
  ],
  sources: [
    { label: "Devin", url: "https://devin.ai" },
    { label: "Devin pricing", url: "https://devin.ai/pricing" },
    { label: "Devin Cloud", url: "https://devin.ai/cloud" },
    { label: "Devin download", url: "https://devin.ai/download" },
    { label: "Windsurf is now Devin Desktop", url: "https://devin.ai/blog/windsurf-is-now-devin-desktop" },
    { label: "Windsurf's next chapter", url: "https://devin.ai/blog/windsurfs-next-chapter" },
    { label: "Devin Cloud in your terminal", url: "https://devin.ai/blog/devin-cloud-in-your-terminal" },
    { label: "Introducing Devin 2.2", url: "https://cognition.com/blog/introducing-devin-2-2" },
    { label: "SWE-2", url: "https://cognition.com/blog/swe-2" },
    { label: "Introducing Devin", url: `${DEVIN_DOCS}/get-started/devin-intro` },
    { label: "Devin CLI", url: `${DEVIN_DOCS}/work-with-devin/devin-cli` },
    { label: "Devin CLI models", url: `${DEVIN_DOCS}/cli/models` },
    { label: "Devin Desktop getting started", url: `${DEVIN_DOCS}/desktop/getting-started` },
    { label: "Devin Desktop third-party agents", url: `${DEVIN_DOCS}/desktop/acp` },
    { label: "Devin advanced capabilities", url: `${DEVIN_DOCS}/work-with-devin/advanced-capabilities` },
    { label: "Devin automations", url: `${DEVIN_DOCS}/product-guides/automations` },
    { label: "Devin Outposts", url: `${DEVIN_DOCS}/cloud/outposts/overview` },
    { label: "Devin integrations", url: `${DEVIN_DOCS}/integrations/overview` },
    { label: "Devin release notes", url: `${DEVIN_DOCS}/release-notes/overview` },
    { label: "Devin enterprise deployment", url: `${DEVIN_DOCS}/enterprise/deployment/overview` },
    { label: "Security at Cognition", url: `${DEVIN_DOCS}/admin/security` },
    {
      label: "Devin enterprise security",
      url: `${DEVIN_DOCS}/enterprise/security-access/security/enterprise-security`,
    },
    { label: "Devin self-serve plans", url: `${DEVIN_DOCS}/admin/billing/self-serve` },
    { label: "Cognition platform terms", url: "https://cognition.com/legal/platform-terms-of-service" },
    { label: "Cognition Trust Center", url: "https://trust.cognition.ai" },
    { label: "OpenBot privacy notes", url: OPENBOT_LINKS.privacy },
    { label: "OpenBot source code", url: OPENBOT_LINKS.repository },
  ],
  checkedAt: "2026-09-27",
};
