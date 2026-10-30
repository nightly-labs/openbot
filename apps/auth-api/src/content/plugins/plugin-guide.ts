import type { ComparisonQuestion, ComparisonSource } from "../compare/comparison";

// The written part of one plugin page: what an agent does with the plugin, and the
// questions a reader asks before installing it. The listing itself (name, prompts,
// sign-in) comes from the plugin catalog; this file adds only what the catalog does
// not say. The FAQ structured data is built from the same questions, so the two can
// not disagree.

/** One kind of work an agent can do through the plugin's tools. */
interface PluginUse {
  title: string;
  text: string;
}

export interface PluginGuide {
  uses: readonly PluginUse[];
  faq: readonly ComparisonQuestion[];
  sources: readonly ComparisonSource[];
  /** `YYYY-MM-DD`: the day every claim about the vendor was last checked against its sources. */
  checkedAt: string;
}
