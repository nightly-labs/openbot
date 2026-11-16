import {
  DEFAULT_MODEL_SERVERS,
  PROVIDER_MODEL_SOURCE_NAME_LIMIT,
  type ProviderModelSource,
} from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentClient } from "../agent-client";
import { decodeRecordResponse, getRecord, getString } from "../protocol";

/** Codex's own provider id. Every other id is a model provider that the user's settings select. */
const OPENAI_PROVIDER_ID = "openai";

/**
 * The model provider of Codex that `OPENAI_BASE_URL` on OpenBot's Codex page makes. The user chose it in
 * OpenBot, that page shows it, and Codex keeps OpenAI's list with it, so it is not a source.
 */
export const CODEX_VARIABLE_PROVIDER = "openbot_environment";

/**
 * Where Codex gets its models when its settings do not use OpenAI's own list (#9956), from the
 * `config` of `config/read`:
 *
 * - `model_provider` other than `openai`: the turns go to that provider, such as Ollama. Its name is
 *   the `name` of its `[model_providers.<id>]` entry, or the product name of a built-in local server.
 * - `model_catalog_json`: Codex lists the models of that file in place of OpenAI's, also with the
 *   OpenAI provider. The path stays here.
 *
 * Null for OpenAI's own list. An `openai_base_url` proxy and `CODEX_VARIABLE_PROVIDER` keep OpenAI's
 * list, so they are not a source.
 */
export function codexModelSource(config: unknown): ProviderModelSource | null {
  const providerId = getString(config, "model_provider")?.trim() || OPENAI_PROVIDER_ID;
  if (providerId !== OPENAI_PROVIDER_ID && providerId !== CODEX_VARIABLE_PROVIDER) {
    const name = getString(getRecord(getRecord(config, "model_providers"), providerId), "name")?.trim();
    return { kind: "provider", name: (name || builtInName(providerId)).slice(0, PROVIDER_MODEL_SOURCE_NAME_LIMIT) };
  }
  return getString(config, "model_catalog_json")?.trim() ? { kind: "catalog" } : null;
}

/** Codex's built-in local providers have no `[model_providers]` entry. Their product names are not translated. */
const BUILT_IN_NAMES: ReadonlyMap<string, string> = new Map(
  Object.entries(DEFAULT_MODEL_SERVERS).map(([id, server]) => [id, server.name]),
);

function builtInName(providerId: string): string {
  return BUILT_IN_NAMES.get(providerId) ?? providerId;
}

/** Reads the source from the running Codex. Fails as `config/read` fails, so the caller keeps what it knew. */
export const readCodexModelSource = Effect.fn("Agent.readCodexModelSource")(function* (
  client: AgentClient,
  timeoutMs: number,
) {
  const response = yield* client.request("config/read", { includeLayers: false }, decodeRecordResponse, timeoutMs);
  return codexModelSource(getRecord(response, "config"));
});
