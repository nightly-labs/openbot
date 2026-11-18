import { isIdentifier } from "../ipc-bounded-values";
import { isDynamicRecord, isNumber } from "../runtime-values";
import type { TeamProtocolV8BaseJsonObject, TeamProtocolV8BaseJsonValue } from "./v8-base";

/**
 * Frozen optional agent-background-work-v1 contract: the chats whose background work, such as a shell
 * command, still runs after their turn ended. The provider starts a turn by itself when the work ends,
 * so a client shows that the agent waits. It adds `backgroundWork` beside the frozen keys of the
 * `snapshot` of a `runtime-snapshot` event. Each item has only these keys, spelled as the rest of that
 * snapshot is (`botId`, see `current-agent-keys.ts`):
 *
 * - `botId`: the agent;
 * - `taskId`: the thread, or null for the agent's own chat;
 * - `since`: when the work started, in epoch milliseconds on the host.
 *
 * The host adds it only for a client that advertises the capability, on protocol 9, so the wire of
 * every released client stays as it was. Such a client shows no waiting line. The host sends only the
 * agents that the member can see. A host without the capability never sends the field, so a client
 * accepts it whenever it is present. A present value that the runtime snapshot decoder refuses fails
 * closed. Widening any of it needs a second capability string.
 */
export const AGENT_BACKGROUND_WORK_CAPABILITY = "agent-background-work-v1";

const ENTRY_KEYS = ["botId", "taskId", "since"] as const;

function isJsonObject(value: TeamProtocolV8BaseJsonValue | undefined): value is TeamProtocolV8BaseJsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isV1Entry(entry: TeamProtocolV8BaseJsonValue): boolean {
  return (
    isJsonObject(entry) &&
    isIdentifier(entry.botId) &&
    (entry.taskId === null || isIdentifier(entry.taskId)) &&
    isNumber(entry.since) &&
    Number.isFinite(entry.since)
  );
}

function v1Entries(entries: unknown, sending: boolean): TeamProtocolV8BaseJsonValue {
  if (!Array.isArray(entries)) throw new Error("Invalid background work.");
  const json: TeamProtocolV8BaseJsonValue[] = JSON.parse(JSON.stringify(entries));
  const projected = json.map((entry) => {
    if (!isJsonObject(entry)) return entry;
    const picked: TeamProtocolV8BaseJsonObject = {};
    for (const key of ENTRY_KEYS) if (entry[key] !== undefined) picked[key] = entry[key];
    return picked;
  });
  return sending ? projected.filter(isV1Entry) : projected;
}

/**
 * `projected` with the background work of the `runtime-snapshot` event `source`, both on the wire
 * vocabulary. Other events are unchanged. The host passes `sending`, so an entry outside the v1 shape
 * stays on the host; a client keeps every entry, and the decoder refuses a bad one.
 */
export function withRuntimeSnapshotBackgroundWork(
  projected: TeamProtocolV8BaseJsonValue,
  source: unknown,
  sending = false,
): TeamProtocolV8BaseJsonValue {
  if (!isDynamicRecord(projected) || projected.type !== "runtime-snapshot" || !isDynamicRecord(source)) {
    return projected;
  }
  const snapshot = projected.snapshot;
  const fromSnapshot = source.snapshot;
  if (!isDynamicRecord(snapshot) || !isDynamicRecord(fromSnapshot) || fromSnapshot.backgroundWork === undefined) {
    return projected;
  }
  return {
    ...projected,
    snapshot: { ...snapshot, backgroundWork: v1Entries(fromSnapshot.backgroundWork, sending) },
  };
}
