import { resolve } from "node:path";
import { z } from "zod";

export const root = resolve(import.meta.dirname, "../../..");
export const output = resolve(root, ".openbot-build/e2e");
const allProviders = ["codex", "claude", "opencode", "grok", "antigravity"] as const;
export type LiveProvider = (typeof allProviders)[number];
const selectedProviders = process.env.OPENBOT_E2E_PROVIDER?.trim();
if (selectedProviders && process.env.OPENBOT_E2E_SUITE !== "live")
  throw new Error("OPENBOT_E2E_PROVIDER is only allowed for focused live tests, never the release gate.");
// A comma-separated list, such as `codex,claude`. Without it, every provider is required.
const selected = selectedProviders
  ? z.array(z.enum(allProviders)).parse(selectedProviders.split(",").map((entry) => entry.trim()))
  : allProviders;
export const providers: readonly LiveProvider[] = allProviders.filter((provider) => selected.includes(provider));

/** Skips a live case when a focused run did not select all of its providers. Release runs select all. */
export function requireProviders(
  testType: { skip(condition: boolean, description: string): void },
  required: readonly LiveProvider[],
) {
  const missing = required.filter((provider) => !providers.includes(provider));
  testType.skip(missing.length > 0, `OPENBOT_E2E_PROVIDER does not select ${missing.join(", ")}.`);
}
export const scriptedModel = "gpt-6-luna";
const defaultModels: Record<LiveProvider, string> = {
  codex: "gpt-6-luna",
  claude: "claude-haiku-5-5",
  opencode: "opencode/muse-spark-1.3-contributor-free",
  grok: "grok-4.6",
  antigravity: "",
};

export function modelFor(provider: LiveProvider): string {
  const variable = `OPENBOT_E2E_${provider.toUpperCase()}_MODEL`;
  const model = process.env[variable]?.trim() || defaultModels[provider];
  if (!model) throw new Error(`Set ${variable} to a model ID available to the runner account.`);
  return model;
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
