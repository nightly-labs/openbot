import { BENCHMARK_SOURCES, type MatchupComparison } from "./comparison";

// Every statement about Codex here is taken from OpenAI's Codex documentation
// (developers.openai.com/codex now redirects to learn.chatgpt.com/docs), the OpenAI
// help center and the openai/codex repository. Every statement about Claude Code is
// taken from code.claude.com, claude.com and the Claude help center. Each page used is
// in `sources`. The benchmark numbers are read by hand from the Artificial Analysis
// Coding Agent Index. Where the sources state nothing, the text says so. Check them
// again, and move `checkedAt`, whenever this file changes.

const CODEX_DOCS = "https://learn.chatgpt.com/docs";
const CLAUDE_CODE_DOCS = "https://code.claude.com/docs/en";

export const CODEX_VS_CLAUDE_CODE: MatchupComparison = {
  kind: "matchup",
  products: [
    { name: "Codex", mark: "codex", provider: "codex" },
    { name: "Claude Code", mark: "claude-code", provider: "claude" },
  ],
  answer:
    "Pick Codex if you pay for ChatGPT and care what each task costs. Pick Claude Code if you pay for Claude and want the top benchmark score, and can wait for it. Both start at $20 a month, and both run on your computer or in the cloud.",
  chooseA: [
    "You already pay for ChatGPT.",
    "Cost per task matters: GPT-6.1 Sol scores 63 on the Artificial Analysis index for about $1 a task.",
    "The sandbox should be on from the first run, with no network.",
    "You'd like to read the source. The command line is Apache-2.0.",
  ],
  chooseB: [
    "You already pay for Claude.",
    "You want the best score on the index: 68, with Sonnet 5.5 at max effort.",
    "Your company buys Claude through Amazon Bedrock, Google Cloud or Microsoft Foundry.",
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
    "Codex is OpenAI's coding agent. Claude Code is Anthropic's. They do the same job: read your code, edit files and run commands, on your computer or in their maker's cloud. Both read rules from your repo, use MCP servers, skills and hooks, and review pull requests on GitHub. The real difference is whose models you get, and which subscription you already have.",
  bothInOpenBot:
    "OpenBot runs both on your computer, each signed in with your own plan: Codex with ChatGPT, Claude Code with Claude. Give each one a job. They pass work to each other in a shared channel, and you can follow along from your phone. Move an agent from one to the other and it keeps its role, workspace and conversation.",
  benchmark: {
    takeaway:
      "Claude Code with Sonnet 5.5 at max effort has the top score, 68. It's also the slowest and most expensive run here: $14.19 and 87 minutes a task. Codex with GPT-6.1 Sol at xhigh scores 63, the same as Sonnet 5.5 at xhigh, for $1.04 a task instead of $3.33, and in a bit more than half the time.",
    rows: [
      {
        agent: "claude-code",
        name: "Claude Code",
        model: "Sonnet 5.5 (max)",
        score: 68,
        costUsd: 14.19,
        minutes: 87.4,
      },
      { agent: "claude-code", name: "Claude Code", model: "Opus 5.5 (max)", score: 66, costUsd: 13.04, minutes: 64.5 },
      { agent: "claude-code", name: "Claude Code", model: "Sonnet 5.5 (xhigh)", score: 63, costUsd: 3.33, minutes: 27 },
      { agent: "codex", name: "Codex", model: "GPT-6.1 Sol (xhigh)", score: 63, costUsd: 1.04, minutes: 15.5 },
      { agent: "codex", name: "Codex", model: "GPT-6 Astra (max)", score: 62, costUsd: 7.47, minutes: 29.4 },
      { agent: "codex", name: "Codex", model: "GPT-6.1 Sol (medium)", score: 61, costUsd: 0.7, minutes: 10.9 },
    ],
    checkedAt: "2026-10-03",
  },
  sections: [
    {
      title: "Models and the plans you pay for",
      a: "Codex runs OpenAI's models only. GPT-6 Astra is the strongest, and OpenAI recommends GPT-6.1 Sol for hard coding work. Plus is $20 a month, Pro is $100, $200 or $500, and Business is $20 a seat billed yearly. Free and Go get GPT-6 Luna in the desktop app as it rolls out, but no cloud tasks. Limits reset every five hours, and weekly caps can apply. An API key works too, at API prices, but you lose cloud features like GitHub review.",
      b: "Claude Code runs Claude's models only, with Opus 5.5 as the default on paid plans. Pro is $20 a month ($17 billed yearly), Max is $100 or $200, and Team seats are $25 ($20 yearly). The free Claude plan doesn't include Claude Code. Limits reset every five hours, and paid plans have a weekly cap that Claude and Claude Code share. It also works with an Anthropic API key, Amazon Bedrock, Google Cloud and Microsoft Foundry.",
    },
    {
      title: "Where the work happens",
      a: "Codex sandboxes local work from the first run: Seatbelt on macOS, bubblewrap on Linux and a native sandbox on Windows. The network is off and writes stay in the workspace. Cloud tasks run in VMs that OpenAI manages, and they keep going while your laptop sleeps. Of the two, this is the safer default.",
      b: "Claude Code runs on your computer by default. Its sandbox (Seatbelt on macOS, bubblewrap on Linux) stays off until you turn it on, and native Windows doesn't have one. Cloud sessions run in an isolated VM that Anthropic manages, or in your own environment. Your GitHub credentials never go into that VM.",
      better: "a",
    },
    {
      title: "Parallel work and teams",
      a: "Codex runs subagents in parallel, and its Ultra reasoning mode leans on them. Git worktrees let you run several chats in one project, and each cloud task gets its own workspace. You can start work from GitHub, Slack and Linear. GitLab is in beta.",
      b: "Claude Code has subagents with their own context, and background sessions through `claude agents`. Worktrees keep parallel work apart, and each cloud session runs on its own. Agent teams, where several sessions work together, are still experimental and off by default. You can start work from GitHub with @claude, or from Slack.",
    },
    {
      title: "Data and privacy",
      a: "On Plus and Pro, OpenAI can train on your chats unless you turn that off in ChatGPT's data controls, which cover Codex too. Business, Enterprise, Edu and the API aren't used for training by default. Enterprise and Edu also get retention and data-residency controls.",
      b: "On Free, Pro and Max, Anthropic trains on your data only if you turn the setting on. With it on, data is kept for 5 years. With it off, 30 days. Team, Enterprise and the API aren't used for training unless you opt in, and Enterprise can get zero data retention. Opt-in beats opt-out, so Claude Code takes this one.",
      better: "b",
    },
  ],
  faq: [
    {
      question: "Which is better for coding, Codex or Claude Code?",
      answer:
        "On the Artificial Analysis Coding Agent Index, Claude Code with Sonnet 5.5 at max effort scores highest, 68. Codex with GPT-6.1 Sol at xhigh scores 63 for $1.04 a task, against $14.19 for that Claude run. Past the numbers, the plan you already pay for usually decides it.",
    },
    {
      question: "Can I use Codex and Claude Code together?",
      answer:
        "Yes. In OpenBot, each one is an agent with its own job, signed in with your own ChatGPT or Claude plan. They hand work to each other in a shared channel on your computer, and you follow them from the OpenBot app on your phone.",
    },
    {
      question: "How much do Codex and Claude Code cost?",
      answer:
        "Both start at $20 a month: ChatGPT Plus for Codex, Claude Pro for Claude Code. Claude Pro drops to $17 a month if you pay yearly. Higher limits cost $100 or $200 a month on both, and ChatGPT Pro also has a $500 tier. ChatGPT Free and Go get GPT-6 Luna in the desktop app as it rolls out. The free Claude plan doesn't include Claude Code.",
    },
    {
      question: "Is Codex open source? Is Claude Code?",
      answer:
        "The Codex command line is, under Apache-2.0, at openai/codex on GitHub. The IDE extension and Codex Cloud aren't. Claude Code is proprietary. Its GitHub repo holds plugins, examples and issues, not the source.",
    },
    {
      question: "Do Codex and Claude Code train on my code?",
      answer:
        "On personal plans, it comes down to one setting. ChatGPT Plus and Pro train on your chats unless you turn it off. Claude Pro and Max train only if you turn it on. On business plans and the API, neither trains on your data by default.",
    },
    {
      question: "Can I use an API key instead of a plan?",
      answer:
        "Yes, with both. Codex takes an OpenAI API key in the command line, SDK and IDE extension, at API prices, but cloud tasks need a ChatGPT sign-in. Claude Code takes an Anthropic API key, and also runs through Amazon Bedrock, Google Cloud and Microsoft Foundry.",
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
    ...BENCHMARK_SOURCES,
  ],
  checkedAt: "2026-10-03",
};
