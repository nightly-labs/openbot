import type { ProviderLogoVariant } from "@openbot/brand";
import { APP_LANGUAGES } from "@openbot/contracts/app-language";
import type { RivalMarkName } from "../../components/compare/rival-mark-shapes";
import type { LandingIconName } from "../../components/landing/LandingIcon";

// One comparison page, as data. The page draws every part from it, and the FAQ
// structured data is built from the same questions, so the two can not disagree.
// There are three kinds: OpenBot against one rival, two other products against
// each other (a matchup), and a roundup of many apps.

type ComparisonSide = "openbot" | "rival";
type MatchupSide = "a" | "b";

/** One row of the table: the text of each side, keyed by the side. */
type ComparisonRow<Side extends string = ComparisonSide> = {
  icon: LandingIconName;
  topic: string;
  /** The side that is better on this topic. Not given when neither is. */
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

/** A plan or a model that an OpenBot agent can run on. The same on every comparison. */
export interface OpenBotPlan {
  /** The provider whose logo the page shows, or `custom` for a model server of your own. */
  provider: ProviderLogoVariant | "custom";
  name: string;
  plan: string;
}

// The released providers (`packages/contracts/src/agent-providers.ts`), with the
// sign-in each one uses (`src/backend/provider-drivers.ts`), and the custom
// OpenAI-compatible provider that OpenCode runs.
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

/** The app languages, without "system". From the contract, so a new language changes the pages. */
export const OPENBOT_LANGUAGE_COUNT = APP_LANGUAGES.filter((language) => language !== "system").length;

const OPENBOT_PLANS_TEXT =
  "OpenBot runs the provider tools you already use, with the plans you already pay for: Codex with your ChatGPT plan, Claude Code with your Claude plan, Gemini with your Google AI Pro or Ultra plan, Grok CLI with your Grok account or an xAI API key, Cursor CLI with your Cursor plan or a Cursor API key, Cline with your Cline account, and Muse Code with your Meta account or a Meta API key. OpenCode runs free models, or your own model on any OpenAI-compatible server, also one on your computer. Pi runs the providers you sign in to with /login, and Inception's Mercury models run with an Inception API key. Any agent that speaks the Agent Client Protocol, such as Goose, Qwen Code or GitHub Copilot, runs as a custom agent. You choose the provider, the model and the reasoning effort for each agent.";

/**
 * The OpenBot side of the rows and sections that are the same on each "OpenBot vs" page. A page
 * writes its own text only where the rival changes what OpenBot must say. The claims come from the
 * repository: `packages/contracts/src/agent-providers.ts` and the release notes in `CHANGELOG.md`.
 */
export const OPENBOT_TEXT = {
  models:
    "Use the plans you already have: ChatGPT, Claude, Gemini, Grok, Cursor, Cline or Muse Code. Or run OpenCode's free models, Pi, Inception's Mercury models, your own model, or any agent that speaks the Agent Client Protocol. Choose one for each agent, and change it later.",
  offline:
    "Agents keep working on the computer or server that runs OpenBot, and routines start them on a schedule. On macOS and Windows, Keep this computer awake stops sleep while it is on power. If you do not want to keep a computer on, use a hosted OpenBot server in the EU, from €20 or $25 a month.",
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
  /** The OpenBot side of the "How agents work as a team" section. */
  teamSection:
    "In OpenBot, each agent is a full coding agent: Codex, Claude Code, Gemini, Grok CLI, Cursor CLI, Cline, OpenCode, Pi, Muse Code or an agent of your own, each with its own job and workspace. A lead agent can give parts of a task to other agents in a shared channel. You follow their work and step in when a decision needs you. For a team of people, one computer runs the host and the others join it; the chats and files stay on the host. Roles set which agents each member can view, chat with or manage.",
  /** The answer to "Can I use my … subscription with OpenBot?". */
  plansFaq:
    "Yes. OpenBot signs in to each provider tool with your own account: your ChatGPT plan for Codex, your Claude plan for Claude Code, and a Google AI Pro or Ultra plan for Gemini. Grok CLI uses your Grok account or an xAI API key, Cursor CLI your Cursor plan, Cline your Cline account, and Muse Code your Meta account. When a plan reaches its limit, an agent can move to a backup model on another provider. OpenBot adds no charge of its own.",
  workSection:
    "OpenBot runs on the computer that hosts it. Agent workspaces, conversations and app data stay on that computer, so it must stay on while its agents work. Run it on a desktop or a server that stays on, and your agents keep working while your laptop is closed. On macOS and Windows, Keep this computer awake stops sleep while the computer is on power, so routines run on time. If you do not want to keep a computer on, use a hosted OpenBot server. It is a Linux server in the EU (Germany, Finland or France), from €20 or $25 a month, and it keeps the workspaces and chats of its agents. Local-first is not offline: an agent that uses a hosted provider still sends its requests to that provider.",
  phonesSection:
    "The OpenBot apps for iPhone and Android, and the web app, connect to the computer that runs your agents. From anywhere, you chat with them, follow their progress, approve their actions and send files, and from the phone you can drive their browser. The connection goes directly between your devices when it can, it is encrypted, and no cloud stores your chats or files. You set up no VPN or tunnel. Turn on Private network, and devices connect only over Tailscale or the same Wi-Fi. The phone app locks with Face ID, Touch ID or a PIN. Agents can also answer in Slack, Discord and Telegram. Remote access needs an OpenBot account.",
} as const;

/** OpenBot against one rival. The kind is optional, so the first pages need no edit. */
export interface Comparison {
  kind?: "openbot";
  rival: {
    /** The product's own spelling. */
    name: string;
    mark: RivalMarkName;
  };
  /** The one-sentence answer under the title. */
  answer: string;
  chooseOpenBot: readonly string[];
  chooseRival: readonly string[];
  /** How the rival gets its models and how you pay for them, next to `OPENBOT_PLANS`. */
  rivalPlans: string;
  rows: readonly ComparisonRow[];
  /** What the two have in common, before the differences. */
  intro: string;
  sections: readonly ComparisonSection[];
  faq: readonly ComparisonQuestion[];
  sources: readonly ComparisonSource[];
  /** `YYYY-MM-DD`: the day every claim about the rival was last checked against its sources. */
  checkedAt: string;
}

export const BENCHMARK_URL = "https://artificialanalysis.ai/agents/coding-agents";
export const BENCHMARK_METHOD_URL = "https://artificialanalysis.ai/methodology/coding-agents-benchmarking";

/** The benchmark pages, for the `sources` of a page that shows the chart. */
export const BENCHMARK_SOURCES: readonly ComparisonSource[] = [
  { label: "Artificial Analysis Coding Agent Index", url: BENCHMARK_URL },
  { label: "Artificial Analysis coding agent methodology", url: BENCHMARK_METHOD_URL },
];

/** The coding agents that the benchmark chart has a colour for (`styles.css`). */
type BenchmarkAgent = Extract<RivalMarkName, "claude-code" | "codex" | "devin" | "antigravity">;

/** One agent and model on the Artificial Analysis Coding Agent Index. */
export interface BenchmarkRow {
  agent: BenchmarkAgent;
  /** The agent's name, as Artificial Analysis gives it. */
  name: string;
  /** The model and effort, as Artificial Analysis gives them. */
  model: string;
  /** The index score, rounded as Artificial Analysis shows it. */
  score: number;
  /** The average cost of one task, in US dollars, at pay-per-token API prices. */
  costUsd: number;
  /** The average wall-clock time of one task, in minutes. */
  minutes: number;
  /** A short note under the model, such as "Not public yet". */
  note?: string;
}

/**
 * Numbers from the Artificial Analysis Coding Agent Index, read by hand from
 * artificialanalysis.ai/agents/coding-agents. The page credits and links them.
 */
export interface Benchmark {
  /** What the numbers say, in one or two sentences. */
  takeaway: string;
  rows: readonly BenchmarkRow[];
  /** `YYYY-MM-DD`: the day the numbers were read. */
  checkedAt: string;
}

interface MatchupProduct {
  /** The product's own spelling. */
  name: string;
  mark: RivalMarkName;
  /** The OpenBot plan that runs this product, which the page shows first. */
  provider: ProviderLogoVariant;
}

/**
 * Two products that OpenBot runs, against each other. Neither side is OpenBot, and
 * neither is recommended: the page compares them, then says that OpenBot runs both.
 */
export interface MatchupComparison {
  kind: "matchup";
  products: readonly [MatchupProduct, MatchupProduct];
  /** The one-sentence answer under the title. */
  answer: string;
  chooseA: readonly string[];
  chooseB: readonly string[];
  rows: readonly ComparisonRow<MatchupSide>[];
  intro: string;
  /** How OpenBot runs both products, with the plans you have, as one team. */
  bothInOpenBot: string;
  /** Not given when the benchmark does not test one of the two products. */
  benchmark?: Benchmark;
  sections: readonly ComparisonSection<MatchupSide>[];
  faq: readonly ComparisonQuestion[];
  sources: readonly ComparisonSource[];
  /** `YYYY-MM-DD`: the day every claim about the two products was last checked against its sources. */
  checkedAt: string;
}

export interface RoundupApp {
  name: string;
  mark: RivalMarkName | "openbot";
  /** The slugs of the comparisons that include this app. */
  comparisons: readonly string[];
  bestFor: string;
  runsOn: string;
  models: string;
  price: string;
  summary: string;
}

/** Many apps in one list, each with the comparisons that include it. OpenBot is first, and the page says who wrote it. */
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

/** How many rows of the table each of the two sides is better on, in the order given. */
export function comparisonScore<Side extends string>(
  rows: readonly ComparisonRow<Side>[],
  sides: readonly [Side, Side],
): readonly [number, number] {
  const count = (side: Side) => rows.filter((row) => row.better === side).length;
  return [count(sides[0]), count(sides[1])];
}

/** schema.org `FAQPage`, from the questions the page shows. */
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

/** The id of an app's entry on a roundup page. Each app has its own mark. */
export function roundupAppAnchor(app: RoundupApp): string {
  return `app-${app.mark}`;
}

/**
 * schema.org `ItemList` of a roundup, in the order the page shows. No rating or
 * review: OpenBot is on the list, and a maker does not review its own app.
 */
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
