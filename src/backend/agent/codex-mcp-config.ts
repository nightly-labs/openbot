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

const registrationLock = Semaphore.makeUnsafe(1);

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

  const written = yield* Effect.result(
    client.request(
      "config/batchWrite",
      { edits: [...edits.values()], filePath, expectedVersion: version },
      decodeRecordResponse,
    ),
  );
  if (Result.isFailure(written)) {
    if (!register) return response;
    return yield* written.failure;
  }
  return yield* client.request("config/read", { includeLayers: true }, decodeRecordResponse);
}, registrationLock.withPermit);

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
