import type { ProviderLogoVariant } from "@openbot/brand";
import type { RivalMarkName } from "../../components/compare/rival-mark-shapes";
import type { LandingIconName } from "../../components/landing/LandingIcon";

// One comparison page, as data. The page draws every part from it, and the FAQ
// structured data is built from the same questions, so the two can not disagree.
// There are three kinds: OpenBot against one rival, two other products against
// each other (a matchup), and a roundup of many apps.

export type ComparisonSide = "openbot" | "rival";
export type MatchupSide = "a" | "b";

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

interface ComparisonQuestion {
  question: string;
  answer: string;
}

interface ComparisonSource {
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
  { provider: "custom", name: "Your own model", plan: "Any OpenAI-compatible server, also one on your computer." },
];

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

export interface MatchupProduct {
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
