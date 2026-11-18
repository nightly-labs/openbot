import { COMPUTER_USE_MCP_SERVER_NAME, isReservedMcpServerName } from "@openbot/contracts/ipc";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result, Semaphore } from "effect";
import type { AgentClient } from "../agent-client";
import {
  CODEX_PLACEHOLDER_COMMAND,
  CODEX_PLACEHOLDER_URL,
  type CodexMcpServer,
  type CodexOwnTransports,
  codexOwnTransports,
} from "../mcp-provider-shapes";
import { decodeRecordResponse, getArray, getRecord, getString, isRecord } from "../protocol";
import { ProviderClientOperationError } from "../provider-client-effects";

// Agents share the Codex user file. Serialize registration so their first turns do not race.
const registrationLock = Semaphore.makeUnsafe(1);

/**
 * Codex can save tool approvals only for servers present in a file-backed config layer.
 *
 * `servers` builds OpenBot's servers from the transports that Codex's own files declare, because
 * those choose the keys that are registered.
 */
export const readCodexMcpConfig = Effect.fn("Agent.readCodexMcpConfig")(function* (
  client: AgentClient,
  servers: (own: CodexOwnTransports) => Readonly<Record<string, CodexMcpServer>>,
) {
  const register = Object.keys(servers({})).length > 0;
  const response = yield* client.request("config/read", { includeLayers: true }, decodeRecordResponse);
  const own = codexOwnTransports(getRecord(getRecord(response, "config"), "mcp_servers"));
  const entries = register ? Object.entries(servers(own)) : [];

  const userLayer = getArray(response, "layers")
    .filter(isRecord)
    .find((layer) => {
      const name = getRecord(layer, "name");
      return name?.type === "user" && !name.profile;
    });
  const version = getString(userLayer, "version");
  const filePath = getString(getRecord(userLayer, "name"), "file");
  if (!version || !filePath) {
    if (!register) return response;
    return yield* new ProviderClientOperationError({
      cause: new Error(sourceText("error.provider.mcpConfig")),
    });
  }
  const saved = getRecord(getRecord(userLayer, "config"), "mcp_servers");
  const edits = new Map<string, { keyPath: string; value: DynamicRecord | null; mergeStrategy: "replace" }>();
  const edit = (name: string, value: DynamicRecord | null) =>
    edits.set(name, { keyPath: `mcp_servers.${name}`, value, mergeStrategy: "replace" });
  // First the placeholders from before each key had `openbot_`, so the servers below keep their
  // approvals, and another Codex app that uses the plain key gets its server on again (#11041).
  const placeholders = plainKeyPlaceholders(saved, own);
  const removed = new Set(placeholders.map(([from]) => from));
  const moves = placeholders.filter(([, to]) => !saved || !Object.hasOwn(saved, to));
  for (const name of removed) edit(name, null);
  for (const [from, to] of moves) edit(to, getRecord(saved, from));
  const current: DynamicRecord = Object.fromEntries([
    ...Object.entries(saved ?? {}).filter(([name]) => !removed.has(name)),
    ...moves.map(([from, to]) => [to, saved?.[from]]),
  ]);
  for (const [name, server] of entries) {
    const registration =
      "command" in server
        ? { command: CODEX_PLACEHOLDER_COMMAND, enabled: false }
        : { url: CODEX_PLACEHOLDER_URL, enabled: false };
    const existing = getRecord(current, name);
    // Codex merges file and thread transport fields. Update only our own placeholder when
    // the user changes transport, and keep the saved policies. Leave user entries unchanged.
    const changedTransport =
      existing?.enabled === false &&
      ("command" in registration
        ? existing.url === CODEX_PLACEHOLDER_URL
        : existing.command === CODEX_PLACEHOLDER_COMMAND);
    if (Object.hasOwn(current, name) && !changedTransport) continue;
    const { command: _command, url: _url, ...settings } = existing ?? {};
    edit(name, { ...settings, ...registration });
  }
  if (edits.size === 0) return response;

  // Save only a disabled placeholder. URLs, arguments, and credentials stay in the thread.
  // Other Codex clients must not start servers that OpenBot owns.
  const written = yield* Effect.result(
    client.request(
      "config/batchWrite",
      { edits: [...edits.values()], filePath, expectedVersion: version },
      decodeRecordResponse,
    ),
  );
  // An agent with no server of its own needs no write: a move that failed waits for the next start.
  if (Result.isFailure(written)) {
    if (!register) return response;
    return yield* written.failure;
  }
  // Read again so the thread and its fingerprint use the saved configuration.
  return yield* client.request("config/read", { includeLayers: true }, decodeRecordResponse);
}, registrationLock.withPermit);

/**
 * OpenBot's placeholders under a key without `openbot_`, each with the key that its server has now
 * (`codexMcpServerKey`). Computer Use keeps its key, and so does a server whose `openbot_` key is
 * reserved or in Codex's own files. A key that starts with `openbot_` is already a renamed one.
 */
function plainKeyPlaceholders(saved: DynamicRecord | null, own: CodexOwnTransports): Array<[string, string]> {
  return Object.keys(saved ?? {}).flatMap((name): Array<[string, string]> => {
    const entry = getRecord(saved, name);
    const placeholder =
      entry?.enabled === false && (entry.url === CODEX_PLACEHOLDER_URL || entry.command === CODEX_PLACEHOLDER_COMMAND);
    const renamed = `openbot_${name}`;
    if (!placeholder || name.startsWith("openbot_") || name === COMPUTER_USE_MCP_SERVER_NAME) return [];
    return Object.hasOwn(own, renamed) || isReservedMcpServerName(renamed) ? [] : [[name, renamed]];
  });
}
