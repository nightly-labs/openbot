import type { MatchupComparison } from "./comparison";

// Every statement about Codex here is taken from OpenAI's Codex documentation
// (developers.openai.com/codex now redirects to learn.chatgpt.com/docs), the OpenAI
// help center and the openai/codex repository. Every statement about Claude Code is
// taken from code.claude.com, claude.com and the Claude help center. Each page used is
// in `sources`. Where they state nothing, the text says so. Check them again, and move
// `checkedAt`, whenever this file changes.

const CODEX_DOCS = "https://learn.chatgpt.com/docs";
const CLAUDE_CODE_DOCS = "https://code.claude.com/docs/en";

export const CODEX_VS_CLAUDE_CODE: MatchupComparison = {
  kind: "matchup",
  products: [
    { name: "Codex", mark: "codex", provider: "codex" },
    { name: "Claude Code", mark: "claude-code", provider: "claude" },
  ],
  answer:
    "Choose Codex if you pay for ChatGPT, want OpenAI's GPT-6 models, and want a sandbox that is on from the start. Choose Claude Code if you pay for Claude and want Claude's models in your terminal and IDE. Both run on your computer and in the cloud, and both cost $20 a month at the entry level.",
  chooseA: [
    "You already pay for ChatGPT Plus, Pro or Business.",
    "You want the operating-system sandbox on by default, with no network and writes only in the workspace.",
    "You want an agent whose command line is open source, under Apache-2.0.",
  ],
  chooseB: [
    "You already pay for Claude Pro, Max, Team or Enterprise.",
    "You want Claude's models, such as Opus 5.5, in your terminal, VS Code or JetBrains IDE.",
    "You want Claude through Amazon Bedrock, Google Cloud or Microsoft Foundry at work.",
  ],
  rows: [
    {
      icon: "cpu",
      topic: "Models",
      a: "OpenAI models only: GPT-6 Astra, GPT-6.1 Sol, GPT-6 Sol and GPT-6 Luna.",
      b: "Claude models only: Opus 5.5 is the default, with Sonnet, Haiku and Fable models.",
    },
    {
      icon: "laptop",
      topic: "Where agents work",
      a: "On your computer, or in cloud tasks that run in virtual machines that OpenAI manages.",
      b: "On your computer, or in cloud sessions that run in virtual machines that Anthropic manages.",
    },
    {
      icon: "lock",
      topic: "Sandbox",
      a: "An operating-system sandbox is on by default: no network, and writes only in the workspace.",
      b: "The operating-system sandbox is off by default. Turn it on with /sandbox. Not on native Windows.",
      better: "a",
    },
    {
      icon: "tag",
      topic: "Plans and price",
      a: "Plus $20 a month, Pro $100, $200 or $500, and Business from $20 a user. Free and Go get GPT-6 Luna in the desktop app, as it rolls out. An API key also works, with no cloud features.",
      b: "Pro $20 a month, or $17 billed yearly. Max $100 or $200, and Team seats $25, or $20 billed yearly. The free plan does not include Claude Code. An API key also works.",
    },
    {
      icon: "users",
      topic: "Parallel work",
      a: "Subagents, Git worktrees for parallel chats, and many cloud tasks at the same time.",
      b: "Subagents, background sessions, Git worktrees and many cloud sessions. Agent teams are experimental and off by default.",
    },
    {
      icon: "phone",
      topic: "From your phone",
      a: "The ChatGPT app for iPhone controls tasks on your Mac or Windows PC.",
      b: "The Claude app for iPhone and Android follows cloud sessions and controls sessions on your computer.",
    },
    {
      icon: "folder",
      topic: "Your data",
      a: "On Plus and Pro, OpenAI can use your chats to improve its models unless you turn training off. Business, Enterprise and the API: no training by default.",
      b: "On Pro and Max, Anthropic trains on your chats only when you turn the setting on. Team, Enterprise and the API: no training by default.",
      better: "b",
    },
    {
      icon: "devices",
      topic: "Apps",
      a: "A command line for macOS, Linux and Windows. Codex in the ChatGPT desktop app for macOS and Windows, with Linux in preview. Extensions for VS Code, Cursor and Windsurf.",
      b: "A command line for macOS, Linux and Windows. A desktop app for macOS and Windows, with Linux in beta. Extensions for VS Code and JetBrains IDEs, and the web.",
    },
    {
      icon: "code",
      topic: "Source code",
      a: "The command line is open source under Apache-2.0. The IDE extension and the cloud are not.",
      b: "Proprietary. The GitHub repository holds plugins, examples and issues, not the source.",
      better: "a",
    },
  ],
  intro:
    "Codex and Claude Code are the coding agents of OpenAI and Anthropic. Both read your code, edit files and run commands, on your computer or in their maker's cloud. Both read rules from your repository, use MCP servers, skills and hooks, and review pull requests on GitHub. The main difference is the model and the plan: Codex uses OpenAI's models with a ChatGPT plan, and Claude Code uses Claude's models with a Claude plan.",
  bothInOpenBot:
    "OpenBot runs Codex and Claude Code on your computer, each signed in with your own plan: Codex with your ChatGPT plan, and Claude Code with your Claude plan. Give each agent its own job. They hand work to each other in a shared channel, and you follow them from your phone. If you move an agent from one to the other, it keeps its role, workspace and conversation.",
  sections: [
    {
      title: "Models and the plans you pay for",
      a: "Codex uses OpenAI's models. GPT-6 Astra is the most capable, and GPT-6.1 Sol is the recommended model for complex coding. Plus costs $20 a month, Pro $100, $200 or $500, and Business $20 a user a month billed yearly. Free and Go get GPT-6 Luna in the desktop app, as it rolls out, but not cloud tasks. Usage limits reset every five hours, and weekly limits can also apply. With an API key, you pay API prices, and cloud features such as GitHub review are not available.",
      b: "Claude Code uses Claude's models, with Opus 5.5 as the default on paid plans. Pro costs $20 a month, or $17 billed yearly, Max $100 or $200, and Team seats $25, or $20 billed yearly. The free Claude plan does not include Claude Code. Limits reset every five hours, and paid plans also have weekly limits that Claude and Claude Code share. Claude Code also works with an Anthropic API key, Amazon Bedrock, Google Cloud and Microsoft Foundry.",
    },
    {
      title: "Where the work happens",
      a: "Local work runs on your computer, in a sandbox that the operating system enforces: Seatbelt on macOS, bubblewrap on Linux, and a native sandbox on Windows. By default, the network is off and writes stay in the workspace. Cloud tasks run in virtual machines that OpenAI manages, and they keep working while your computer sleeps.",
      b: "Claude Code runs on your computer by default. Its operating-system sandbox, Seatbelt on macOS and bubblewrap on Linux, is off until you turn it on, and it is not available on native Windows. Cloud sessions run in an isolated virtual machine that Anthropic manages, or in your own environment. Your GitHub credentials never go into that virtual machine.",
      better: "a",
    },
    {
      title: "Parallel work and teams",
      a: "Codex runs subagents in parallel, and its Ultra reasoning mode uses them. Git worktrees let you run several chats in one project, and each cloud task gets its own workspace. You can start work from GitHub, Slack and Linear, and GitLab is in beta.",
      b: "Claude Code has subagents, each with its own context, and background sessions with `claude agents`. Git worktrees keep parallel work apart, and each cloud session runs on its own. Agent teams, where several Claude Code sessions work together, are experimental and off by default. You can start work from GitHub with @claude, and from Slack.",
    },
    {
      title: "Data and privacy",
      a: "On Plus and Pro, OpenAI can use your conversations to improve its models unless you turn training off in ChatGPT's data controls, and these controls apply to Codex. On Business, Enterprise, Edu and the API, OpenAI does not train on your data by default. Enterprise and Edu get controls for data retention and data residency.",
      b: "On Free, Pro and Max, Anthropic trains on your data only when you turn the setting on. It keeps the data for 5 years with the setting on, and for 30 days with it off. On Team, Enterprise and the API, Anthropic does not train on your data unless you opt in, and the standard retention is 30 days. Enterprise can get zero data retention.",
      better: "b",
    },
  ],
  faq: [
    {
      question: "Which is better for coding, Codex or Claude Code?",
      answer:
        "Neither in every case. Both edit files, run commands, work in parallel and run in the cloud. Codex gives you OpenAI's models and a sandbox that is on by default. Claude Code gives you Claude's models, such as Opus 5.5. The plan that you already pay for is often the deciding point.",
    },
    {
      question: "Can I use Codex and Claude Code together?",
      answer:
        "Yes. In OpenBot, each one is an agent with its own job, signed in with your own ChatGPT or Claude plan. The agents give work to each other in a shared channel on your computer, and you follow them from the OpenBot app on your phone.",
    },
    {
      question: "How much do Codex and Claude Code cost?",
      answer:
        "Both start at $20 a month: ChatGPT Plus for Codex, and Claude Pro for Claude Code. Claude Pro is $17 a month if you pay yearly. Higher limits cost $100 or $200 a month on both, and ChatGPT Pro also has a $500 plan. ChatGPT Free and Go get GPT-6 Luna in the desktop app as it rolls out. The free Claude plan does not include Claude Code.",
    },
    {
      question: "Is Codex open source? Is Claude Code?",
      answer:
        "The Codex command line is open source under Apache-2.0, at openai/codex on GitHub. The Codex IDE extension and Codex Cloud are not. Claude Code is proprietary: its repository on GitHub holds plugins, examples and issues, not the source code.",
    },
    {
      question: "Do Codex and Claude Code train on my code?",
      answer:
        "On personal plans it depends on a setting. On ChatGPT Plus and Pro, OpenAI can use your chats for training unless you turn it off. On Claude Pro and Max, Anthropic trains only when you turn the setting on. On business plans and the API, neither trains on your data by default.",
    },
    {
      question: "Can I use an API key instead of a plan?",
      answer:
        "Yes, with both. Codex takes an OpenAI API key in the command line, SDK and IDE extension, at API prices, but cloud tasks need a ChatGPT sign-in. Claude Code takes an Anthropic API key, and also works through Amazon Bedrock, Google Cloud and Microsoft Foundry.",
    },
  ],
  sources: [
    { label: "Codex documentation", url: CODEX_DOCS },
    { label: "Codex pricing", url: `${CODEX_DOCS}/pricing` },
    { label: "Codex models", url: `${CODEX_DOCS}/models` },
    { label: "Codex sandboxing", url: `${CODEX_DOCS}/sandboxing` },
    { label: "Codex cloud environments", url: `${CODEX_DOCS}/environments/cloud-environments` },
    { label: "Codex subagents", url: `${CODEX_DOCS}/agent-configuration/subagents` },
    { label: "Codex Git worktrees", url: `${CODEX_DOCS}/environments/git-worktrees` },
    { label: "Codex remote", url: `${CODEX_DOCS}/remote` },
    { label: "Codex IDE extension", url: `${CODEX_DOCS}/codex/ide` },
    { label: "Codex open source", url: `${CODEX_DOCS}/open-source` },
    { label: "Codex authentication", url: `${CODEX_DOCS}/auth` },
    { label: "What's new in Codex", url: `${CODEX_DOCS}/whats-new` },
    {
      label: "Using Codex with your ChatGPT plan",
      url: "https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan",
    },
    { label: "openai/codex on GitHub", url: "https://github.com/openai/codex" },
    { label: "Claude Code overview", url: `${CLAUDE_CODE_DOCS}/overview` },
    { label: "Claude Code setup", url: `${CLAUDE_CODE_DOCS}/setup` },
    { label: "Claude Code model configuration", url: `${CLAUDE_CODE_DOCS}/model-config` },
    { label: "Claude Code sandboxing", url: `${CLAUDE_CODE_DOCS}/sandboxing` },
    { label: "Claude Code on the web", url: `${CLAUDE_CODE_DOCS}/claude-code-on-the-web` },
    { label: "Claude Code agent teams", url: `${CLAUDE_CODE_DOCS}/agent-teams` },
    { label: "Claude Code worktrees", url: `${CLAUDE_CODE_DOCS}/worktrees` },
    { label: "Claude Code on mobile", url: `${CLAUDE_CODE_DOCS}/mobile` },
    { label: "Claude Code desktop", url: `${CLAUDE_CODE_DOCS}/desktop` },
    { label: "Claude Code data usage", url: `${CLAUDE_CODE_DOCS}/data-usage` },
    { label: "Claude pricing", url: "https://claude.com/pricing" },
    {
      label: "Use Claude Code with your Team or Enterprise plan",
      url: "https://support.claude.com/en/articles/11845131-use-claude-code-with-your-team-or-enterprise-plan",
    },
    { label: "Claude Code license", url: "https://github.com/anthropics/claude-code/blob/main/LICENSE.md" },
  ],
  checkedAt: "2026-10-03",
};
