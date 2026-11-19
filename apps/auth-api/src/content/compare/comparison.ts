import type { ProviderLogoVariant } from "@openbot/brand";
import { APP_LANGUAGES } from "@openbot/contracts/app-language";
import type { RivalMarkName } from "../../components/compare/rival-mark-shapes";
import type { LandingIconName } from "../../components/landing/LandingIcon";

type ComparisonSide = "openbot" | "rival";
type MatchupSide = "a" | "b";

type ComparisonRow<Side extends string = ComparisonSide> = {
  icon: LandingIconName;
  topic: string;
  better?: Side;
} & Record<Side, string>;

type ComparisonSection<Side extends string = ComparisonSide> = {
  title: string;
  better?: Side;
} & Record<Side, string>;

export interface ComparisonQuestion {
  question: string;
  answer: string;
}

export interface ComparisonSource {
  label: string;
  url: string;
}

export interface OpenBotPlan {
  provider: ProviderLogoVariant | "custom";
  name: string;
  plan: string;
}

export const OPENBOT_PLANS: readonly OpenBotPlan[] = [
  { provider: "codex", name: "ChatGPT", plan: "Your ChatGPT plan, through Codex." },
  { provider: "claude", name: "Claude", plan: "Your Claude plan, through Claude Code." },
  { provider: "antigravity", name: "Gemini", plan: "Your Google AI Pro or Ultra plan." },
  { provider: "grok", name: "Grok", plan: "Your Grok account or an xAI API key." },
  { provider: "cursor", name: "Cursor", plan: "Your Cursor plan, or a Cursor API key." },
  { provider: "opencode", name: "OpenCode", plan: "Free models, or an OpenCode Go key." },
  { provider: "cline", name: "Cline", plan: "Your Cline account, or a Cline API key." },
  { provider: "muse", name: "Muse Code", plan: "Your Meta account, or a Meta API key." },
  { provider: "pi", name: "Pi", plan: "Included with OpenBot. Sign in to a provider with /login in Pi." },
  { provider: "inception", name: "Inception", plan: "Mercury models, with an Inception API key." },
  { provider: "acp", name: "Custom agent", plan: "Any ACP agent, such as Goose, Qwen Code or GitHub Copilot." },
  { provider: "custom", name: "Your own model", plan: "Any OpenAI-compatible server, also one on your computer." },
];

export const OPENBOT_LANGUAGE_COUNT = APP_LANGUAGES.filter((language) => language !== "system").length;

const OPENBOT_PLANS_TEXT =
  "OpenBot runs the provider tools you already use, with the plans you already pay for: Codex with your ChatGPT plan, Claude Code with your Claude plan, Gemini with your Google AI Pro or Ultra plan, Grok CLI with your Grok account or an xAI API key, Cursor CLI with your Cursor plan or a Cursor API key, Cline with your Cline account, and Muse Code with your Meta account or a Meta API key. OpenCode runs free models, or your own model on any OpenAI-compatible server, also one on your computer. Pi runs the providers you sign in to with /login, and Inception's Mercury models run with an Inception API key. Any agent that speaks the Agent Client Protocol, such as Goose, Qwen Code or GitHub Copilot, runs as a custom agent. You choose the provider, the model and the reasoning effort for each agent.";

export const OPENBOT_TEXT = {
  models:
    "Use the plans you already have: ChatGPT, Claude, Gemini, Grok, Cursor, Cline or Muse Code. Or run OpenCode's free models, Pi, Inception's Mercury models, your own model, or any agent that speaks the Agent Client Protocol. Choose one for each agent, and change it later.",
  offline:
    "Agents keep working on the computer or server that runs OpenBot, and routines start them on a schedule. On macOS and Windows, Keep this computer awake stops sleep while it is on power. If you do not want to keep a computer on, use a hosted OpenBot server in the EU, from €30 or $36 a month.",
  remote:
    "Apps for iPhone and Android, and a web app, connect from anywhere. Chats and files go over an encrypted connection between your devices, with no VPN, and no cloud stores them. Private network mode keeps them on Tailscale or your own Wi-Fi.",
  teams:
    "Each agent is a full coding agent with its own job. They give work to each other in shared channels. Coworkers join one team host, and roles set who can view, chat with or manage each agent.",
  regions: `In any country: OpenBot has no region lock. The desktop app is in ${OPENBOT_LANGUAGE_COUNT} languages, from English, German and Spanish to Japanese, Korean and Turkish, and hosted servers run in the EU. Each AI provider sets the countries for its own plan.`,
  apps: "macOS, Windows and Linux, mobile apps for iPhone and Android, and a web app.",
  backupModels:
    "When a plan reaches its limit, or a provider is overloaded or down, an agent can move to a backup model on another provider. It keeps its chat and workspace, and a note in the chat shows the switch.",
  logins:
    "The Vault keeps logins, payment cards and contact info on your computer, encrypted by the operating system. Agents sign in and fill a card for you, but see only the card name and its last four digits, and you approve the first card fill on each site. 1Password and Bitwarden also connect.",
  voice:
    "Dictate a message, or talk to an agent in the Voice pane and interrupt it by speaking. Local models turn your speech into text and read replies aloud in 31 languages, so only the text goes to the agent.",
  chatApps:
    "Agents answer in Slack, Discord and Telegram, and a routine can send its answers there. Connect more than one Slack workspace or Discord server.",
  plansSection: `${OPENBOT_PLANS_TEXT} When a plan reaches its limit or a provider is down, the agent can move to a backup model. When you move an agent to a different provider, it keeps its role, workspace and conversation.`,
  plansList: OPENBOT_PLANS_TEXT,
  teamSection:
    "In OpenBot, each agent is a full coding agent: Codex, Claude Code, Gemini, Grok CLI, Cursor CLI, Cline, OpenCode, Pi, Muse Code or an agent of your own, each with its own job and workspace. A lead agent can give parts of a task to other agents in a shared channel. You follow their work and step in when a decision needs you. For a team of people, one computer runs the host and the others join it; the chats and files stay on the host. Roles set which agents each member can view, chat with or manage.",
  plansFaq:
    "Yes. OpenBot signs in to each provider tool with your own account: your ChatGPT plan for Codex, your Claude plan for Claude Code, and a Google AI Pro or Ultra plan for Gemini. Grok CLI uses your Grok account or an xAI API key, Cursor CLI your Cursor plan, Cline your Cline account, and Muse Code your Meta account. When a plan reaches its limit, an agent can move to a backup model on another provider. OpenBot adds no charge of its own.",
  workSection:
    "OpenBot runs on the computer that hosts it. Agent workspaces, conversations and app data stay on that computer, so it must stay on while its agents work. Run it on a desktop or a server that stays on, and your agents keep working while your laptop is closed. On macOS and Windows, Keep this computer awake stops sleep while the computer is on power, so routines run on time. If you do not want to keep a computer on, use a hosted OpenBot server. It is a Linux server in the EU (Germany, Finland or France), from €30 or $36 a month, and it keeps the workspaces and chats of its agents. Local-first is not offline: an agent that uses a hosted provider still sends its requests to that provider.",
  phonesSection:
    "The OpenBot apps for iPhone and Android, and the web app, connect to the computer that runs your agents. From anywhere, you chat with them, follow their progress, approve their actions and send files, and from the phone you can drive their browser. The connection goes directly between your devices when it can, it is encrypted, and no cloud stores your chats or files. You set up no VPN or tunnel. Turn on Private network, and devices connect only over Tailscale or the same Wi-Fi. The phone app locks with Face ID, Touch ID or a PIN. Agents can also answer in Slack, Discord and Telegram. Remote access needs an OpenBot account.",
} as const;

export interface Comparison {
  kind?: "openbot";
  rival: {
    name: string;
    mark: RivalMarkName;
  };
  answer: string;
  chooseOpenBot: readonly string[];
  chooseRival: readonly string[];
  rivalPlans: string;
  rows: readonly ComparisonRow[];
  intro: string;
  sections: readonly ComparisonSection[];
  faq: readonly ComparisonQuestion[];
  sources: readonly ComparisonSource[];
  checkedAt: string;
}

export const BENCHMARK_URL = "https://artificialanalysis.ai/agents/coding-agents";
export const BENCHMARK_METHOD_URL = "https://artificialanalysis.ai/methodology/coding-agents-benchmarking";

export const BENCHMARK_SOURCES: readonly ComparisonSource[] = [
  { label: "Artificial Analysis Coding Agent Index", url: BENCHMARK_URL },
  { label: "Artificial Analysis coding agent methodology", url: BENCHMARK_METHOD_URL },
];

type BenchmarkAgent = Extract<RivalMarkName, "claude-code" | "codex" | "devin" | "antigravity">;

export interface BenchmarkRow {
  agent: BenchmarkAgent;
  name: string;
  model: string;
  score: number;
  costUsd: number;
  minutes: number;
  note?: string;
}

export interface Benchmark {
  takeaway: string;
  rows: readonly BenchmarkRow[];
  checkedAt: string;
}

interface MatchupProduct {
  name: string;
  mark: RivalMarkName;
  provider: ProviderLogoVariant;
}

export interface MatchupComparison {
  kind: "matchup";
  products: readonly [MatchupProduct, MatchupProduct];
  answer: string;
  chooseA: readonly string[];
  chooseB: readonly string[];
  rows: readonly ComparisonRow<MatchupSide>[];
  intro: string;
  bothInOpenBot: string;
  benchmark?: Benchmark;
  sections: readonly ComparisonSection<MatchupSide>[];
  faq: readonly ComparisonQuestion[];
  sources: readonly ComparisonSource[];
  checkedAt: string;
}

export interface RoundupApp {
  name: string;
  mark: RivalMarkName | "openbot";
  comparisons: readonly string[];
  bestFor: string;
  runsOn: string;
  models: string;
  price: string;
  summary: string;
}

export interface RoundupComparison {
  kind: "roundup";
  answer: string;
  intro: string;
  apps: readonly RoundupApp[];
  benchmark?: Benchmark;
  faq: readonly ComparisonQuestion[];
  sources: readonly ComparisonSource[];
  checkedAt: string;
}

export type ComparePage = Comparison | MatchupComparison | RoundupComparison;

export function comparisonScore<Side extends string>(
  rows: readonly ComparisonRow<Side>[],
  sides: readonly [Side, Side],
): readonly [number, number] {
  const count = (side: Side) => rows.filter((row) => row.better === side).length;
  return [count(sides[0]), count(sides[1])];
}

export function comparisonFaqStructuredData(page: Pick<ComparePage, "faq">) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: page.faq.map((entry) => ({
      "@type": "Question",
      name: entry.question,
      acceptedAnswer: { "@type": "Answer", text: entry.answer },
    })),
  };
}

export function roundupAppAnchor(app: RoundupApp): string {
  return `app-${app.mark}`;
}

export function roundupItemListStructuredData(
  roundup: RoundupComparison,
  name: string,
  appUrl: (app: RoundupApp) => string,
) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    itemListElement: roundup.apps.map((app, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: app.name,
      url: appUrl(app),
    })),
  };
}
