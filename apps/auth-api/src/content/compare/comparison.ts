import type { ProviderLogoVariant } from "@openbot/brand";
import type { RivalMarkName } from "../../components/compare/rival-mark-shapes";
import type { LandingIconName } from "../../components/landing/LandingIcon";

// One comparison page, as data. The page draws every part from it, and the FAQ
// structured data is built from the same questions, so the two can not disagree.

export type ComparisonSide = "openbot" | "rival";

interface ComparisonRow {
  icon: LandingIconName;
  topic: string;
  openbot: string;
  rival: string;
  /** The side that is better on this topic. Not given when neither is. */
  better?: ComparisonSide;
}

interface ComparisonSection {
  title: string;
  openbot: string;
  rival: string;
  better?: ComparisonSide;
}

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
  { provider: "opencode", name: "OpenCode", plan: "Free models, or an OpenCode Go key." },
  { provider: "custom", name: "Your own model", plan: "Any OpenAI-compatible server, also one on your computer." },
];

export interface Comparison {
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

/** How many rows of the table each side is better on. */
export function comparisonScore(comparison: Comparison): Record<ComparisonSide, number> {
  const score = { openbot: 0, rival: 0 };
  for (const row of comparison.rows) if (row.better) score[row.better] += 1;
  return score;
}

/** schema.org `FAQPage`, from the questions the page shows. */
export function comparisonFaqStructuredData(comparison: Comparison) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: comparison.faq.map((entry) => ({
      "@type": "Question",
      name: entry.question,
      acceptedAnswer: { "@type": "Answer", text: entry.answer },
    })),
  };
}
