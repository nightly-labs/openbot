import { isIdentifier } from "../ipc-bounded-values";
import { isDynamicRecord, isNumber } from "../runtime-values";
import type { TeamProtocolV8BaseJsonObject, TeamProtocolV8BaseJsonValue } from "./v8-base";

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
