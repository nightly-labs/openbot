import { COMPUTER_USE_MCP_SERVER_NAME, type McpServerConfig } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Semaphore } from "effect";
import type { AgentClient } from "../agent-client";
import { decodeRecordResponse, getArray, getRecord, getString, isRecord } from "../protocol";
import { ProviderClientOperationError } from "../provider-client-effects";

// Agents share the Codex user file. Serialize registration so their first turns do not race.
const registrationLock = Semaphore.makeUnsafe(1);

/** Codex can save tool approvals only for servers present in a file-backed config layer. */
export const readCodexMcpConfig = Effect.fn("Agent.readCodexMcpConfig")(function* (
  client: AgentClient,
  computerUse: McpServerConfig | undefined,
) {
  const response = yield* client.request(
    "config/read",
    { includeLayers: computerUse !== undefined },
    decodeRecordResponse,
  );
  if (!computerUse) return response;

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
      cause: new Error(sourceText("error.provider.computerUseConfig")),
    });
  }
  const saved = getRecord(getRecord(userLayer, "config"), "mcp_servers");
  if (saved && Object.hasOwn(saved, COMPUTER_USE_MCP_SERVER_NAME)) return response;

  // No environment or credentials are saved. Other Codex clients must not start OpenBot's driver.
  // The thread supplies the current executable and socket, including after an app update.
  const registration = { command: computerUse.command, enabled: false };
  yield* client.request(
    "config/value/write",
    {
      keyPath: `mcp_servers.${COMPUTER_USE_MCP_SERVER_NAME}`,
      value: registration,
      mergeStrategy: "replace",
      filePath,
      expectedVersion: version,
    },
    decodeRecordResponse,
  );
  // Read again so the thread and its fingerprint use the saved configuration.
  return yield* client.request("config/read", { includeLayers: false }, decodeRecordResponse);
}, registrationLock.withPermit);
