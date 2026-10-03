import type { MatchupComparison } from "./comparison";

// Every statement about Claude Code here is taken from code.claude.com, claude.com and
// the Claude help center. Every statement about Antigravity is taken from
// antigravity.google, gemini.google, Google's developers blog and the ACP registry
// entry that Google LLC publishes. Each page used is in `sources`. Where they state
// nothing, the text says so. Check them again, and move `checkedAt`, whenever this
// file changes. Gemini CLI stopped serving Google AI Pro, Ultra and free users on
// 18 June 2026, and Google sends them to Antigravity CLI: that is why this page
// compares Antigravity and not Gemini CLI.

const CLAUDE_CODE_DOCS = "https://code.claude.com/docs/en";
const ANTIGRAVITY_DOCS = "https://antigravity.google/docs";

export const CLAUDE_CODE_VS_ANTIGRAVITY: MatchupComparison = {
  kind: "matchup",
  products: [
    { name: "Claude Code", mark: "claude-code", provider: "claude" },
    { name: "Antigravity", mark: "antigravity", provider: "antigravity" },
  ],
  answer:
    "Choose Claude Code if you pay for Claude, want Claude's models in your terminal and IDE, and want to start or follow work from a phone app. Choose Antigravity if you want Google's agent platform with Gemini models, a free plan to start, and Claude models on Google AI Pro or Ultra.",
  chooseA: [
    "You already pay for Claude Pro, Max, Team or Enterprise.",
    "You want cloud sessions that run in Anthropic's cloud, not on your computer.",
    "You want the Claude app for iPhone and Android to follow and control your sessions.",
  ],
  chooseB: [
    "You already pay for Google AI Pro or Ultra, or you want to start on a free plan.",
    "You want Gemini models, with Claude Sonnet 5.5 and Opus 5.5 on Pro and Ultra.",
    "You want a desktop app made for agents, with a browser agent that controls Chrome.",
  ],
  rows: [
    {
      icon: "cpu",
      topic: "Models",
      a: "Claude models only: Opus 5.5 is the default, with Sonnet, Haiku and Fable models.",
      b: "Gemini 3.8 Flash is the default, with other Gemini models. Claude Sonnet 5.5 and Opus 5.5 on Pro and Ultra.",
      better: "b",
    },
    {
      icon: "laptop",
      topic: "Where agents work",
      a: "On your computer, or in cloud sessions that run in virtual machines that Anthropic manages.",
      b: "On your computer. Remote Control connects a browser to it. A cloud agent is a separate Gemini API product.",
    },
    {
      icon: "lock",
      topic: "Sandbox",
      a: "The operating-system sandbox is off by default. Turn it on with /sandbox. Not on native Windows.",
      b: "The terminal sandbox is on by default on macOS and Linux. Windows does not have it yet.",
      better: "b",
    },
    {
      icon: "tag",
      topic: "Plans and price",
      a: "Pro $20 a month, or $17 billed yearly. Max $100 or $200, and Team seats $25, or $20 billed yearly. The free plan does not include Claude Code.",
      b: "A free plan with weekly limits. Google AI Pro $19.99 a month, and AI Ultra $99.99 or $199.99. Enterprise through Google Cloud.",
      better: "b",
    },
    {
      icon: "puzzle",
      topic: "Own API key",
      a: "An Anthropic API key works, and so do Amazon Bedrock, Google Cloud and Microsoft Foundry.",
      b: "No own key or endpoint for more limits. The IDE extensions can sign in with a Gemini API key.",
      better: "a",
    },
    {
      icon: "users",
      topic: "Parallel work",
      a: "Subagents, background sessions, Git worktrees and many cloud sessions. Agent teams are experimental and off by default.",
      b: "Parallel local subagents, several workspaces and Git worktrees, and scheduled tasks.",
    },
    {
      icon: "phone",
      topic: "From your phone",
      a: "The Claude app for iPhone and Android follows cloud sessions and controls sessions on your computer.",
      b: "Remote Control in any web browser. You can add it to your phone's home screen. No native app is stated.",
      better: "a",
    },
    {
      icon: "folder",
      topic: "Your data",
      a: "On Pro and Max, Anthropic trains on your chats only when you turn the setting on. Team, Enterprise and the API: no training by default.",
      b: "On personal plans, Google can use your interactions to improve its products, and people can review them. You can opt out. Enterprise: no training.",
      better: "a",
    },
    {
      icon: "devices",
      topic: "Apps",
      a: "A command line for macOS, Linux and Windows. A desktop app for macOS and Windows, with Linux in beta. Extensions for VS Code and JetBrains IDEs, and the web.",
      b: "The Antigravity 2.0 desktop app and command line for macOS, Windows and Linux, and the Antigravity IDE. Extensions for VS Code, Visual Studio, JetBrains IDEs, Zed and Xcode.",
    },
    {
      icon: "code",
      topic: "Source code",
      a: "Proprietary.",
      b: "Proprietary. Gemini CLI, which it replaces for personal plans, stays open source.",
    },
  ],
  intro:
    "Claude Code is Anthropic's coding agent, and Antigravity is Google's agent platform. Both read your code, edit files and run commands on your computer, work in parallel, and read rules, skills, hooks and MCP servers from your project. On 18 June 2026, Gemini CLI stopped serving Google AI Pro, Ultra and free users, and Google sent them to Antigravity CLI. So for a personal Google plan, Antigravity is now the agent to compare with Claude Code.",
  bothInOpenBot:
    "OpenBot runs Claude Code and Gemini on your computer, each signed in with your own plan: Claude Code with your Claude plan, and Gemini with your Google AI Pro or Ultra plan, through Google's Antigravity ACP server. Give each agent its own job. They hand work to each other in a shared channel, and you follow them from your phone. If you move an agent from one to the other, it keeps its role, workspace and conversation.",
  sections: [
    {
      title: "Models and the plans you pay for",
      a: "Claude Code uses Claude's models, with Opus 5.5 as the default on paid plans. Pro costs $20 a month, or $17 billed yearly, Max $100 or $200, and Team seats $25, or $20 billed yearly. The free Claude plan does not include Claude Code. Claude Code also works with an Anthropic API key, Amazon Bedrock, Google Cloud and Microsoft Foundry.",
      b: "Antigravity uses Gemini 3.8 Flash for local agents by default, and also offers Gemini 3.7 Flash, 3.6 Flash and 3.1 Pro on every plan. Claude Sonnet 5.5 and Opus 5.5 come with paid Pro and Ultra subscriptions. The free plan has weekly limits. Google AI Pro costs $19.99 a month and AI Ultra $99.99 or $199.99 in the US; their limits reset every five hours, up to a weekly limit. Your own API key can not add limits.",
      better: "b",
    },
    {
      title: "Where the work happens",
      a: "Claude Code runs on your computer by default. Its operating-system sandbox is off until you turn it on, and it is not available on native Windows. Cloud sessions run in an isolated virtual machine that Anthropic manages, not on your computer. From the Claude app on your phone, you follow cloud sessions and control sessions on your computer.",
      b: "Antigravity runs its agents on your computer, in a terminal sandbox that is on by default on macOS and Linux. Remote Control lets you drive a session from any web browser, but the agent still runs on your computer. Google runs the Antigravity agent in its cloud only as Managed Agents, a separate product in the Gemini API.",
    },
    {
      title: "Parallel work and teams",
      a: "Claude Code has subagents, each with its own context, and background sessions with `claude agents`. Git worktrees keep parallel work apart, and each cloud session runs on its own. Agent teams are experimental and off by default. You can start work from GitHub with @claude, and from Slack.",
      b: "Antigravity 2.0 works across several workspaces and Git worktrees, and gives parts of a task to parallel local subagents. It can run tasks on a schedule. In the command line, /agents shows the subagents that work in the background.",
    },
    {
      title: "Data and privacy",
      a: "On Free, Pro and Max, Anthropic trains on your data only when you turn the setting on. It keeps the data for 5 years with the setting on, and for 30 days with it off. On Team, Enterprise and the API, Anthropic does not train on your data unless you opt in.",
      b: "On personal plans, Google records your interactions and uses them to improve its products and machine learning technologies, and human reviewers can read them. You can opt out in the settings. On Enterprise, Google never uses your code, prompts or transcripts to train its foundation models, and data residency in the US or the EU is available. Google states no retention period.",
      better: "a",
    },
  ],
  faq: [
    {
      question: "Is Antigravity the same as Gemini CLI?",
      answer:
        "No. Gemini CLI is Google's open-source command line. Antigravity is Google's agent platform, with a desktop app, the Antigravity CLI, an IDE and IDE extensions. On 18 June 2026, Gemini CLI stopped serving Google AI Pro, Ultra and free users, and Google told them to use Antigravity CLI. Paid API keys and Gemini Code Assist licences still work with Gemini CLI.",
    },
    {
      question: "Which is better for coding, Claude Code or Antigravity?",
      answer:
        "It depends on your plan and how you work. Claude Code gives you Claude's models, cloud sessions and a phone app. Antigravity gives you Gemini models, a free plan, Claude models on Pro and Ultra, and a sandbox that is on by default on macOS and Linux.",
    },
    {
      question: "Can I use Claude Code and Antigravity together?",
      answer:
        "Yes. In OpenBot, Claude Code and Gemini are agents in one team, each signed in with your own Claude or Google AI plan. OpenBot runs Gemini through Google's Antigravity ACP server. The agents give work to each other in a shared channel on your computer.",
    },
    {
      question: "Can I use Claude models in Antigravity?",
      answer:
        "Yes, on paid plans. Claude Sonnet 5.5 and Opus 5.5 are on Google AI Pro, but not on a trial, and on Ultra. They are not on the free plan or Enterprise.",
    },
    {
      question: "How much do Claude Code and Antigravity cost?",
      answer:
        "Claude Code needs a paid Claude plan: Pro is $20 a month, or $17 billed yearly, and Max is $100 or $200. Antigravity has a free plan with weekly limits. Google AI Pro costs $19.99 a month in the US, and AI Ultra $99.99 or $199.99.",
    },
    {
      question: "Do Claude Code and Antigravity train on my code?",
      answer:
        "On personal plans, Anthropic trains on your data only when you turn the setting on. Google can use your Antigravity interactions to improve its products unless you opt out. On business plans, neither trains on your data by default.",
    },
  ],
  sources: [
    { label: "Claude Code overview", url: `${CLAUDE_CODE_DOCS}/overview` },
    { label: "Claude Code setup", url: `${CLAUDE_CODE_DOCS}/setup` },
    { label: "Claude Code model configuration", url: `${CLAUDE_CODE_DOCS}/model-config` },
    { label: "Claude Code sandboxing", url: `${CLAUDE_CODE_DOCS}/sandboxing` },
    { label: "Claude Code on the web", url: `${CLAUDE_CODE_DOCS}/claude-code-on-the-web` },
    { label: "Claude Code agent teams", url: `${CLAUDE_CODE_DOCS}/agent-teams` },
    { label: "Claude Code on mobile", url: `${CLAUDE_CODE_DOCS}/mobile` },
    { label: "Claude Code desktop", url: `${CLAUDE_CODE_DOCS}/desktop` },
    { label: "Claude Code data usage", url: `${CLAUDE_CODE_DOCS}/data-usage` },
    { label: "Claude pricing", url: "https://claude.com/pricing" },
    { label: "Claude Code license", url: "https://github.com/anthropics/claude-code/blob/main/LICENSE.md" },
    { label: "Antigravity", url: "https://antigravity.google/" },
    { label: "Antigravity documentation", url: `${ANTIGRAVITY_DOCS}/home/` },
    { label: "Antigravity overview", url: `${ANTIGRAVITY_DOCS}/overview/` },
    { label: "Antigravity models", url: `${ANTIGRAVITY_DOCS}/models/` },
    { label: "Antigravity plans", url: `${ANTIGRAVITY_DOCS}/plans/` },
    { label: "Antigravity pricing", url: "https://antigravity.google/pricing" },
    { label: "Antigravity sandbox", url: `${ANTIGRAVITY_DOCS}/sandbox/` },
    { label: "Antigravity Remote Control", url: `${ANTIGRAVITY_DOCS}/remote-control/` },
    { label: "Antigravity CLI reference", url: `${ANTIGRAVITY_DOCS}/cli/reference/` },
    { label: "Antigravity enterprise", url: `${ANTIGRAVITY_DOCS}/enterprise/` },
    { label: "Antigravity FAQ", url: `${ANTIGRAVITY_DOCS}/faq/` },
    { label: "Antigravity terms", url: "https://antigravity.google/terms" },
    { label: "Antigravity download", url: "https://antigravity.google/download" },
    { label: "Google AI subscriptions", url: "https://gemini.google/subscriptions/?hl=en" },
    {
      label: "Transitioning Gemini CLI to Antigravity CLI",
      url: "https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/",
    },
    {
      label: "Antigravity in the ACP registry",
      url: "https://github.com/agentclientprotocol/registry/tree/main/antigravity-acp",
    },
    { label: "Gemini API managed agents", url: "https://ai.google.dev/gemini-api/docs/antigravity-agent" },
  ],
  checkedAt: "2026-10-03",
};
