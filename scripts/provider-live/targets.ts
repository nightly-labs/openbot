// The providers of the live provider test, shared by the config, the app command and the test.
import { join, resolve } from "node:path";
import type { AgentProviderId } from "@openbot/contracts/agent-providers";

export const PROJECT_ROOT = resolve(import.meta.dirname, "../..");
/** Never `localhost`: the runner and the app can resolve that name to different addresses. */
export const RENDERER_HOST = "127.0.0.1";

/** Gemini is the `antigravity` provider in the code. */
export const LIVE_PROVIDERS = ["codex", "claude", "antigravity"] as const satisfies AgentProviderId[];
export type LiveProvider = (typeof LIVE_PROVIDERS)[number];

export function isLiveProvider(value: unknown): value is LiveProvider {
  return LIVE_PROVIDERS.some((provider) => provider === value);
}

/**
 * The profile of one provider's app. It is under `.openbot-build`, which git ignores. CI names a folder
 * outside the checkout in `OPENBOT_PROVIDER_LIVE_DIR`: other jobs of the runner clean the checkout.
 */
export function profilePath(provider: LiveProvider): string {
  const base = process.env.OPENBOT_PROVIDER_LIVE_DIR || join(PROJECT_ROOT, ".openbot-build", "provider-live");
  return join(base, provider, "profile");
}

/** The model of each provider's test agent: a cheap one. The first listed model replaces a model that the provider does not list. */
export const LIVE_MODELS: Record<LiveProvider, string> = {
  codex: "gpt-6-luna",
  claude: "claude-haiku-5-5",
  antigravity: "gemini-3.8-flash",
};

/** The path of the DevTools socket that `start-app.ts` serves on the renderer port. */
export const DEVTOOLS_PATH = "/__devtools";
/** The file in the profile that holds the address of that socket. */
export const DEVTOOLS_ENDPOINT_FILE = "provider-live-devtools-endpoint";
