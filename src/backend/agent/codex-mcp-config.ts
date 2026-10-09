import { isReservedMcpServerName, type McpServerConfig } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Semaphore } from "effect";
import type { AgentClient } from "../agent-client";
import { codexMcpServerName } from "../mcp-provider-shapes";
import { decodeRecordResponse, getArray, getRecord, getString, isRecord } from "../protocol";
import { ProviderClientOperationError } from "../provider-client-effects";

// Agents share the Codex user file. Serialize registration so their first turns do not race.
const registrationLock = Semaphore.makeUnsafe(1);
const placeholderCommand = "openbot-mcp";
const placeholderUrl = "http://127.0.0.1:1";

/** Codex can save tool approvals only for servers present in a file-backed config layer. */
export const readCodexMcpConfig = Effect.fn("Agent.readCodexMcpConfig")(function* (
  client: AgentClient,
  configs: readonly McpServerConfig[],
) {
  const servers = configs.filter((server) => server.enabled && !isReservedMcpServerName(server.name));
  const response = yield* client.request("config/read", { includeLayers: servers.length > 0 }, decodeRecordResponse);
  if (servers.length === 0) return response;

  const userLayer = getArray(response, "layers")
    .filter(isRecord)
    .find((layer) => {
      const name = getRecord(layer, "name");
      return name?.type === "user" && !name.profile;
    });
  const version = getString(userLayer, "version");
  const filePath = getString(getRecord(userLayer, "name"), "file");
  if (!version || !filePath) {
    return yield* new ProviderClientOperationError({
      cause: new Error(sourceText("error.provider.mcpConfig")),
    });
  }
  const saved = getRecord(getRecord(userLayer, "config"), "mcp_servers");
  const registrations = new Map<string, { command: string; enabled: false } | { url: string; enabled: false }>();
  for (const server of servers) {
    const name = codexMcpServerName(server.name);
    if (!registrations.has(name)) {
      registrations.set(
        name,
        server.transport === "stdio"
          ? { command: placeholderCommand, enabled: false }
          : { url: placeholderUrl, enabled: false },
      );
    }
  }
  const edits = [];
  for (const [name, registration] of registrations) {
    const existing = getRecord(saved, name);
    // Codex merges file and thread transport fields. Update only our own placeholder when
    // the user changes transport, and keep the saved policies. Leave user entries unchanged.
    const changedTransport =
      existing?.enabled === false &&
      ("command" in registration ? existing.url === placeholderUrl : existing.command === placeholderCommand);
    if (saved && Object.hasOwn(saved, name) && !changedTransport) continue;
    const { command: _command, url: _url, ...settings } = existing ?? {};
    edits.push({
      keyPath: `mcp_servers.${name}`,
      value: { ...settings, ...registration },
      mergeStrategy: "replace",
    });
  }
  if (edits.length === 0) return response;

  // Save only a disabled placeholder. URLs, arguments, and credentials stay in the thread.
  // Other Codex clients must not start servers that OpenBot owns.
  yield* client.request(
    "config/batchWrite",
    {
      edits,
      filePath,
      expectedVersion: version,
    },
    decodeRecordResponse,
  );
  // Read again so the thread and its fingerprint use the saved configuration.
  return yield* client.request("config/read", { includeLayers: false }, decodeRecordResponse);
}, registrationLock.withPermit);
