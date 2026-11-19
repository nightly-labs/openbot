import type { ComparisonQuestion, ComparisonSource } from "../compare/comparison";

interface PluginUse {
  title: string;
  text: string;
}

export interface PluginGuide {
  uses: readonly PluginUse[];
  faq: readonly ComparisonQuestion[];
  sources: readonly ComparisonSource[];
  checkedAt: string;
}
