import { sourceText } from "@openbot/i18n/source";
import { Effect, Semaphore } from "effect";
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
  const response = yield* client.request("config/read", { includeLayers: register }, decodeRecordResponse);
  if (!register) return response;
  const entries = Object.entries(servers(codexOwnTransports(getRecord(getRecord(response, "config"), "mcp_servers"))));

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
  const edits = [];
  for (const [name, server] of entries) {
    const registration =
      "command" in server
        ? { command: CODEX_PLACEHOLDER_COMMAND, enabled: false }
        : { url: CODEX_PLACEHOLDER_URL, enabled: false };
    const existing = getRecord(saved, name);
    // Codex merges file and thread transport fields. Update only our own placeholder when
    // the user changes transport, and keep the saved policies. Leave user entries unchanged.
    const changedTransport =
      existing?.enabled === false &&
      ("command" in registration
        ? existing.url === CODEX_PLACEHOLDER_URL
        : existing.command === CODEX_PLACEHOLDER_COMMAND);
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
