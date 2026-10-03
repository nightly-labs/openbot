import type { MatchupComparison } from "./comparison";

// Every statement about Cursor here is taken from cursor.com, the Cursor documentation
// and help center, and Cursor's terms. Every statement about Claude Code is taken from
// code.claude.com, claude.com and the Claude help center. Each page used is in
// `sources`. Where they state nothing, the text says so. Check them again, and move
// `checkedAt`, whenever this file changes. SpaceX acquired Cursor on 14 August 2026.

const CURSOR_DOCS = "https://cursor.com/docs";
const CLAUDE_CODE_DOCS = "https://code.claude.com/docs/en";

export const CURSOR_VS_CLAUDE_CODE: MatchupComparison = {
  kind: "matchup",
  products: [
    { name: "Cursor", mark: "cursor", provider: "cursor" },
    { name: "Claude Code", mark: "claude-code", provider: "claude" },
  ],
  answer:
    "Choose Cursor if you want a full code editor with agents in it, and models from many providers in one plan. Choose Claude Code if you want Claude's agent in the terminal and the IDE that you already use, with your Claude plan. Both run agents on your computer and in the cloud, and both cost $20 a month at the entry level.",
  chooseA: [
    "You want an editor, built from VS Code, with agents, completions and review in it.",
    "You want Grok, Claude, GPT, Gemini and Cursor's own models in one plan.",
    "You want Bugbot to review pull requests on GitHub, GitLab, Bitbucket or Azure DevOps.",
  ],
  chooseB: [
    "You already pay for Claude Pro, Max, Team or Enterprise.",
    "You want to keep your terminal and your editor, such as VS Code or a JetBrains IDE.",
    "You want Claude through Amazon Bedrock, Google Cloud or Microsoft Foundry at work.",
  ],
  rows: [
    {
      icon: "cpu",
      topic: "Models",
      a: "Cursor's own models, such as Grok 4.7 and Composer 2.5, and models from Anthropic, OpenAI, Google and Meta.",
      b: "Claude models only: Opus 5.5 is the default, with Sonnet, Haiku and Fable models.",
      better: "a",
    },
    {
      icon: "laptop",
      topic: "Where agents work",
      a: "On your computer, in the editor or the command line, or in cloud virtual machines. Cloud agents can also run on machines that you host.",
      b: "On your computer, or in cloud sessions that run in virtual machines that Anthropic manages, or in your own environment.",
    },
    {
      icon: "tag",
      topic: "Plans and price",
      a: "Hobby is free. Pro $20 a month, Pro+ $60 and Ultra $200. Teams $40 or $120 a user. Use beyond the plan is billed at API prices.",
      b: "Pro $20 a month, or $17 billed yearly. Max $100 or $200, and Team seats $25, or $20 billed yearly. The free plan does not include Claude Code.",
    },
    {
      icon: "puzzle",
      topic: "Own API key",
      a: "Keys from OpenAI, Anthropic, Google, Azure OpenAI and Amazon Bedrock, for chat models only. The command line also takes a Cursor API key.",
      b: "An Anthropic API key works, and so do Amazon Bedrock, Google Cloud and Microsoft Foundry.",
    },
    {
      icon: "users",
      topic: "Parallel work",
      a: "Parallel agents in the Agents Window, Git worktrees, and as many cloud agents as you want. Projects, in beta, lets one agent coordinate others.",
      b: "Subagents, background sessions, Git worktrees and many cloud sessions. Agent teams are experimental and off by default.",
    },
    {
      icon: "phone",
      topic: "From your phone",
      a: "Cursor for iPhone and iPad, on iOS 26 or later, for cloud agents. Android is planned; until then, a web app.",
      b: "The Claude app for iPhone and Android follows cloud sessions and controls sessions on your computer.",
      better: "b",
    },
    {
      icon: "folder",
      topic: "Your data",
      a: "With Privacy Mode on, Cursor does not train on your data. With it off, Cursor can use your code and prompts to train. Cursor does not state the default for personal plans.",
      b: "On Pro and Max, Anthropic trains on your chats only when you turn the setting on. Team, Enterprise and the API: no training by default.",
    },
    {
      icon: "devices",
      topic: "Apps",
      a: "The Cursor editor for macOS, Windows and Linux, a command line, the web and an iPhone app. Integrations with JetBrains IDEs and Xcode.",
      b: "A command line for macOS, Linux and Windows. A desktop app for macOS and Windows, with Linux in beta. Extensions for VS Code, its forks and JetBrains IDEs.",
    },
    {
      icon: "code",
      topic: "Source code",
      a: "Proprietary. The editor is a fork of VS Code.",
      b: "Proprietary.",
    },
  ],
  intro:
    "Cursor is an AI code editor from Anysphere, which SpaceX acquired in August 2026. Claude Code is Anthropic's coding agent for the terminal, the IDE, the desktop and the web. Both run agents that edit files and run commands, on your computer or in the cloud, and both read AGENTS.md-style rules, MCP servers, hooks and skills. The main difference is the shape of the tool: Cursor is the editor itself, with many models, and Claude Code is an agent that plugs into the tools that you already use, with Claude's models.",
  bothInOpenBot:
    "OpenBot runs Cursor CLI and Claude Code on your computer, each signed in with your own plan: Cursor CLI with your Cursor plan or a Cursor API key, and Claude Code with your Claude plan. Give each agent its own job. They hand work to each other in a shared channel, and you follow them from your phone. If you move an agent from one to the other, it keeps its role, workspace and conversation.",
  sections: [
    {
      title: "Models and the plans you pay for",
      a: "Cursor's own pool has Grok 4.7, 4.6 and 4.5 and Composer 2.5, and Cursor calls Grok 4.7 its flagship model. It also offers Claude, GPT, Gemini and Muse models at API prices. Hobby is free, Pro costs $20 a month, Pro+ $60 and Ultra $200, and Teams $40 or $120 a user. Each plan includes usage, and use beyond it is billed at API prices. Your own keys from OpenAI, Anthropic, Google, Azure OpenAI and Amazon Bedrock work for chat models.",
      b: "Claude Code uses Claude's models, with Opus 5.5 as the default on paid plans. Pro costs $20 a month, or $17 billed yearly, Max $100 or $200, and Team seats $25, or $20 billed yearly. The free Claude plan does not include Claude Code. Limits reset every five hours, and paid plans also have weekly limits. Claude Code also works with an Anthropic API key, Amazon Bedrock, Google Cloud and Microsoft Foundry.",
      better: "a",
    },
    {
      title: "Editor or agent",
      a: "Cursor is a code editor, built as a fork of VS Code, with extensions from Open VSX. The Agents Window runs agents next to the editor, on your computer, in worktrees, over SSH or in the cloud. The Cursor CLI, `agent`, runs the same agent in a terminal, and can hand a task to a cloud agent.",
      b: "Claude Code started in the terminal, and it does not replace your editor. Its extension works in VS Code and its forks, Cursor included, and its plugin works in JetBrains IDEs. The desktop app runs parallel sessions, local, in the cloud or over SSH, and the web app runs at claude.ai/code.",
    },
    {
      title: "Parallel work and teams",
      a: "The Agents Window runs agents in parallel, each in its own Git worktree if you want. Cloud agents run in isolated virtual machines, as many as you want at the same time, and you start them from Slack, Microsoft Teams, Linear, Jira or a GitHub comment. Projects, in beta since September 2026, lets a coordinator agent give work to other agents.",
      b: "Claude Code has subagents, each with its own context, and background sessions with `claude agents`. Git worktrees keep parallel work apart, and each cloud session runs on its own. Agent teams, where several Claude Code sessions work together, are experimental and off by default. You can start work from GitHub with @claude, and from Slack.",
    },
    {
      title: "Data and privacy",
      a: "With Privacy Mode on, Cursor does not train on your data and has zero data retention agreements with its model providers. With it off, Cursor can store and use your code and prompts to train its models. Privacy Mode is on by default for Enterprise teams; Cursor does not state the default for personal plans. Requests go through Cursor's servers, also with your own API key. Cloud agents are the only feature that stores your code, and Cursor deletes it when the agent completes.",
      b: "On Free, Pro and Max, Anthropic trains on your data only when you turn the setting on. It keeps the data for 5 years with the setting on, and for 30 days with it off. On Team, Enterprise and the API, Anthropic does not train on your data unless you opt in, and the standard retention is 30 days.",
    },
  ],
  faq: [
    {
      question: "Which is better for coding, Cursor or Claude Code?",
      answer:
        "It depends on how you work. Cursor is a full editor with agents in it and models from many providers. Claude Code is an agent that works in your terminal and plugs into the editor you already use, with Claude's models. Both run agents on your computer and in the cloud.",
    },
    {
      question: "Can I use Claude Code in Cursor?",
      answer:
        "Yes. Claude Code's extension installs in Cursor, as in other VS Code forks, and it bundles its own copy of the Claude Code command line. You can also choose Claude models inside Cursor itself, billed through your Cursor plan.",
    },
    {
      question: "Can I use Cursor and Claude Code together?",
      answer:
        "Yes. In OpenBot, Cursor CLI and Claude Code are agents in one team, each signed in with your own Cursor or Claude plan. The agents give work to each other in a shared channel on your computer, and you follow them from the OpenBot app on your phone.",
    },
    {
      question: "How much do Cursor and Claude Code cost?",
      answer:
        "Both start at $20 a month: Cursor Pro, and Claude Pro for Claude Code. Claude Pro is $17 a month if you pay yearly. Cursor also has a free Hobby plan, Pro+ at $60 and Ultra at $200. Claude Max costs $100 or $200. The free Claude plan does not include Claude Code.",
    },
    {
      question: "Who owns Cursor?",
      answer:
        "SpaceX. Cursor's blog says that SpaceX acquired it on 14 August 2026. Cursor now calls Grok 4.7 its flagship model.",
    },
    {
      question: "Do Cursor and Claude Code train on my code?",
      answer:
        "With Cursor, it depends on Privacy Mode: on, no training; off, Cursor can train on your code and prompts. On Claude's personal plans, Anthropic trains only when you turn the setting on. On business plans, Privacy Mode is on by default for Enterprise teams, and Anthropic does not train by default.",
    },
  ],
  sources: [
    { label: "Cursor pricing", url: "https://cursor.com/pricing" },
    { label: "Cursor models and pricing", url: `${CURSOR_DOCS}/account/pricing` },
    { label: "Cursor available models", url: "https://cursor.com/help/models-and-usage/available-models" },
    { label: "Cursor API keys", url: "https://cursor.com/help/models-and-usage/api-keys" },
    { label: "Cursor Agents Window", url: `${CURSOR_DOCS}/agent/agents-window` },
    { label: "Cursor cloud agents", url: `${CURSOR_DOCS}/cloud-agents` },
    { label: "Cursor on mobile", url: `${CURSOR_DOCS}/cloud-agents/mobile` },
    { label: "Cursor CLI", url: `${CURSOR_DOCS}/cli/overview` },
    { label: "Cursor Bugbot", url: `${CURSOR_DOCS}/bugbot` },
    { label: "Cursor downloads", url: "https://cursor.com/downloads" },
    { label: "Cursor data use", url: "https://cursor.com/data-use" },
    { label: "Cursor privacy", url: "https://cursor.com/help/security-and-privacy/privacy" },
    {
      label: "Cursor privacy and data governance",
      url: `${CURSOR_DOCS}/enterprise/privacy-and-data-governance`,
    },
    { label: "Cursor 3", url: "https://cursor.com/blog/cursor-3" },
    { label: "Cursor joins SpaceX", url: "https://cursor.com/blog/joining-spacex" },
    { label: "Cursor changelog", url: "https://cursor.com/changelog" },
    { label: "Cursor terms of service", url: "https://cursor.com/terms-of-service" },
    { label: "Claude Code overview", url: `${CLAUDE_CODE_DOCS}/overview` },
    { label: "Claude Code setup", url: `${CLAUDE_CODE_DOCS}/setup` },
    { label: "Claude Code in VS Code", url: `${CLAUDE_CODE_DOCS}/vs-code` },
    { label: "Claude Code model configuration", url: `${CLAUDE_CODE_DOCS}/model-config` },
    { label: "Claude Code on the web", url: `${CLAUDE_CODE_DOCS}/claude-code-on-the-web` },
    { label: "Claude Code agent teams", url: `${CLAUDE_CODE_DOCS}/agent-teams` },
    { label: "Claude Code on mobile", url: `${CLAUDE_CODE_DOCS}/mobile` },
    { label: "Claude Code desktop", url: `${CLAUDE_CODE_DOCS}/desktop` },
    { label: "Claude Code data usage", url: `${CLAUDE_CODE_DOCS}/data-usage` },
    { label: "Claude pricing", url: "https://claude.com/pricing" },
    { label: "Claude Code license", url: "https://github.com/anthropics/claude-code/blob/main/LICENSE.md" },
  ],
  checkedAt: "2026-10-03",
};
