import { join, resolve } from "node:path";
import type { AgentProviderId } from "@openbot/contracts/agent-providers";

export const PROJECT_ROOT = resolve(import.meta.dirname, "../..");
export const RENDERER_HOST = "127.0.0.1";

export const LIVE_PROVIDERS = ["codex", "claude", "antigravity"] as const satisfies AgentProviderId[];
export const BENCH_PROVIDERS = ["codex", "claude", "grok"] as const satisfies AgentProviderId[];
export type LiveProvider = (typeof LIVE_PROVIDERS)[number] | (typeof BENCH_PROVIDERS)[number];

export function isLiveProvider(value: unknown): value is LiveProvider {
  return [...LIVE_PROVIDERS, ...BENCH_PROVIDERS].some((provider) => provider === value);
}

export const BENCH_ENV = "OPENBOT_PROVIDER_LIVE_BENCH";
export const BENCH_TAG = "bench";

export function profilePath(provider: LiveProvider): string {
  const base = process.env.OPENBOT_PROVIDER_LIVE_DIR || join(PROJECT_ROOT, ".openbot-build", "provider-live");
  return join(base, provider, "profile");
}

export const LIVE_MODELS: Record<LiveProvider, string> = {
  codex: "gpt-6-luna",
  claude: "claude-haiku-5-5",
  antigravity: "gemini-3.8-flash",
  grok: "grok-4.7-build-fast",
};

export const DEVTOOLS_PATH = "/__devtools";
export const DEVTOOLS_ENDPOINT_FILE = "provider-live-devtools-endpoint";
export const DEBUGGING_PORT_FILE = "provider-live-debugging-port";
