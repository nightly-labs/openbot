import { resolve } from "node:path";
import { z } from "zod";

export const root = resolve(import.meta.dirname, "../../..");
export const output = resolve(root, ".openbot-build/e2e");
const allProviders = ["codex", "claude", "opencode", "grok", "antigravity"] as const;
type LiveProvider = (typeof allProviders)[number];
const selectedProvider = process.env.OPENBOT_E2E_PROVIDER?.trim();
if (selectedProvider && process.env.OPENBOT_E2E_SUITE !== "live")
  throw new Error("OPENBOT_E2E_PROVIDER is only allowed for focused live tests, never the release gate.");
export const providers: readonly LiveProvider[] = selectedProvider
  ? [z.enum(allProviders).parse(selectedProvider)]
  : allProviders;
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
