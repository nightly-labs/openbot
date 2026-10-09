import { resolve } from "node:path";
import { z } from "zod";

export const root = resolve(import.meta.dirname, "../../..");
export const output = resolve(root, ".openbot-build/e2e");
export const providers = ["codex", "claude", "opencode"] as const;
type LiveProvider = (typeof providers)[number];
export const scriptedModel = "gpt-6-luna";
const defaultModels: Record<LiveProvider, string> = {
  codex: "gpt-6-luna",
  claude: "claude-haiku-5-5",
  opencode: "opencode/muse-spark-1.3-contributor-free",
};

export function modelFor(provider: LiveProvider): string {
  return process.env[`OPENBOT_E2E_${provider.toUpperCase()}_MODEL`]?.trim() || defaultModels[provider];
}

const serviceSettings = z.object({
  apiUrl: z.url(),
  siteUrl: z.url(),
  registry: z.string(),
  directory: z.string(),
});

export function settings() {
  return serviceSettings.parse(JSON.parse(process.env.OPENBOT_E2E_SERVICES ?? "{}"));
}
