// Slug to provider page for /providers. Eager, for the reason given in content/news/index.ts.

import { CLAUDE_CODE_PROVIDER } from "./claude-code";
import { CLINE_PROVIDER } from "./cline";
import { CODEX_PROVIDER } from "./codex";
import { CURSOR_PROVIDER } from "./cursor";
import { GEMINI_PROVIDER } from "./gemini";
import { GROK_PROVIDER } from "./grok";
import { LOCAL_MODELS_PROVIDER } from "./local-models";
import { OPENCODE_PROVIDER } from "./opencode";
import type { ProviderPage } from "./provider-page";

export const PROVIDER_PAGES: Readonly<Record<string, ProviderPage>> = {
  "claude-code": CLAUDE_CODE_PROVIDER,
  codex: CODEX_PROVIDER,
  gemini: GEMINI_PROVIDER,
  grok: GROK_PROVIDER,
  cursor: CURSOR_PROVIDER,
  opencode: OPENCODE_PROVIDER,
  cline: CLINE_PROVIDER,
  "local-models": LOCAL_MODELS_PROVIDER,
};

/** The slug of the provider page about a plan's provider, for a link from a comparison. */
export function providerPageSlug(provider: ProviderPage["provider"]): string | undefined {
  return Object.keys(PROVIDER_PAGES).find((slug) => PROVIDER_PAGES[slug]?.provider === provider);
}
