import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_MODEL_SERVERS,
  PROVIDER_MODEL_SOURCE_NAME_LIMIT,
  type ProviderModelSource,
} from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentClient } from "../agent-client";
import { decodeRecordResponse, getRecord, getString, isRecord } from "../protocol";

const OPENAI_PROVIDER_ID = "openai";

export const CODEX_VARIABLE_PROVIDER = "openbot_environment";

function codexModelSource(config: unknown): ProviderModelSource | null {
  const providerId = getString(config, "model_provider")?.trim() || OPENAI_PROVIDER_ID;
  if (providerId !== OPENAI_PROVIDER_ID && providerId !== CODEX_VARIABLE_PROVIDER) {
    const name = getString(getRecord(getRecord(config, "model_providers"), providerId), "name")?.trim();
    return { kind: "provider", name: (name || builtInName(providerId)).slice(0, PROVIDER_MODEL_SOURCE_NAME_LIMIT) };
  }
  return getString(config, "model_catalog_json")?.trim() ? { kind: "catalog" } : null;
}

const BUILT_IN_NAMES: ReadonlyMap<string, string> = new Map(
  Object.entries(DEFAULT_MODEL_SERVERS).map(([id, server]) => [id, server.name]),
);

function builtInName(providerId: string): string {
  return BUILT_IN_NAMES.get(providerId) ?? providerId;
}

function codexStartSettings(config: unknown, timeoutMs: number) {
  const providerId = getString(config, "model_provider")?.trim() || OPENAI_PROVIDER_ID;
  const provider = getRecord(getRecord(config, "model_providers"), providerId);
  const catalog = getString(config, "model_catalog_json")?.trim() || null;
  const key = (catalogHash: string | null) => JSON.stringify([providerId, provider, catalog, catalogHash]);
  if (!catalog) return Effect.succeed(key(null));
  return Effect.tryPromise({
    try: async (signal) =>
      createHash("sha256")
        .update(await readFile(catalog.startsWith("file:") ? fileURLToPath(catalog) : catalog, { signal }))
        .digest("hex"),
    catch: (cause) => cause,
  }).pipe(
    Effect.timeout(timeoutMs),
    Effect.map(key),
    Effect.catch((cause) => Effect.succeed(isRecord(cause) && cause.code === "ENOENT" ? key("missing") : null)),
  );
}

const OPENAI_HOSTS: ReadonlySet<string> = new Set(["api.openai.com", "chatgpt.com"]);

function codexRouteBaseUrl(config: unknown): string | null | undefined {
  const providerId = getString(config, "model_provider")?.trim() || OPENAI_PROVIDER_ID;
  if (providerId === OPENAI_PROVIDER_ID) return getString(config, "openai_base_url")?.trim() || null;
  const provider = getRecord(getRecord(config, "model_providers"), providerId);
  return provider ? getString(provider, "base_url")?.trim() || null : undefined;
}

function codexRoutesToOpenai(config: unknown): boolean {
  const baseUrl = codexRouteBaseUrl(config);
  if (baseUrl === undefined) return false;
  if (baseUrl === null) return true;
  const url = URL.parse(baseUrl);
  return url?.protocol === "https:" && OPENAI_HOSTS.has(url.hostname);
}

export const readCodexRoutesToOpenai = Effect.fn("Agent.readCodexRoutesToOpenai")(function* (
  client: AgentClient,
  timeoutMs: number,
) {
  const response = yield* client.request("config/read", { includeLayers: false }, decodeRecordResponse, timeoutMs);
  return codexRoutesToOpenai(getRecord(response, "config"));
});

export const readCodexModelSource = Effect.fn("Agent.readCodexModelSource")(function* (
  client: AgentClient,
  timeoutMs: number,
) {
  const response = yield* client.request("config/read", { includeLayers: false }, decodeRecordResponse, timeoutMs);
  const config = getRecord(response, "config");
  return { source: codexModelSource(config), startSettings: yield* codexStartSettings(config, timeoutMs) };
});
