import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { File, Paths } from "expo-file-system";

export interface LiveActivityFailure {
  serverId: string;
  agentId: string;
  turnId: string;
}

export interface LiveActivityDismissals {
  shown: { failure: LiveActivityFailure; startedAt: number } | null;
  dismissed: LiveActivityFailure[];
}

const FILE_NAME = "live-activity-dismissals.json";

export function emptyLiveActivityDismissals(): LiveActivityDismissals {
  return { shown: null, dismissed: [] };
}

export function loadLiveActivityDismissals(): LiveActivityDismissals {
  try {
    const file = new File(Paths.document, FILE_NAME);
    if (!file.exists) return emptyLiveActivityDismissals();
    const saved = JSON.parse(file.textSync());
    if (!isDynamicRecord(saved)) return emptyLiveActivityDismissals();
    const shown = isDynamicRecord(saved.shown) ? saved.shown : null;
    return {
      shown:
        shown && isFailure(shown.failure) && typeof shown.startedAt === "number"
          ? { failure: shown.failure, startedAt: shown.startedAt }
          : null,
      dismissed: Array.isArray(saved.dismissed) ? saved.dismissed.filter(isFailure) : [],
    };
  } catch {
    return emptyLiveActivityDismissals();
  }
}

export function saveLiveActivityDismissals(dismissals: LiveActivityDismissals): void {
  try {
    const file = new File(Paths.document, FILE_NAME);
    if (!dismissals.shown && dismissals.dismissed.length === 0) {
      if (file.exists) file.delete();
      return;
    }
    file.writeSync(JSON.stringify(dismissals));
  } catch {}
}

export function sameLiveActivityFailure(left: LiveActivityFailure, right: LiveActivityFailure): boolean {
  return left.serverId === right.serverId && left.agentId === right.agentId && left.turnId === right.turnId;
}

function isFailure(value: unknown): value is LiveActivityFailure {
  return (
    isDynamicRecord(value) &&
    typeof value.serverId === "string" &&
    typeof value.agentId === "string" &&
    typeof value.turnId === "string"
  );
}
