import type { RealtimeVoiceStatus } from "@openbot/contracts/ipc";
import { createSignal } from "solid-js";
import { speechPort } from "./speech-port";

const [statuses, setStatuses] = createSignal<Record<string, RealtimeVoiceStatus>>({});
const revisions = new Map<string, number>();
export function realtimeVoiceStatus(serverId: string) {
  return statuses()[serverId];
}
export function noteRealtimeVoiceStatus(serverId: string, status: RealtimeVoiceStatus): void {
  revisions.set(serverId, (revisions.get(serverId) ?? 0) + 1);
  setStatuses((current) => ({ ...current, [serverId]: status }));
}
export async function refreshRealtimeVoiceStatus(serverId: string): Promise<RealtimeVoiceStatus> {
  const revision = (revisions.get(serverId) ?? 0) + 1;
  revisions.set(serverId, revision);
  const status = await speechPort().voice.getRealtimeStatus(serverId);
  if (revisions.get(serverId) === revision) noteRealtimeVoiceStatus(serverId, status);
  return status;
}
