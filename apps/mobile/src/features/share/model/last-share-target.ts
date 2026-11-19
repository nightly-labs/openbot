import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { remoteHostFingerprint } from "@openbot/team-client";
import * as SecureStore from "expo-secure-store";

export interface ShareTarget {
  serverId: string;
  agentId: string;
}

function lastShareTargetKey(apiUrl: string, userId: string): string {
  return `openbot.share-target.v1.${remoteHostFingerprint(JSON.stringify([new URL(apiUrl).origin, userId]))}`;
}

export async function loadLastShareTarget(apiUrl: string, userId: string): Promise<ShareTarget | null> {
  try {
    const value = JSON.parse((await SecureStore.getItemAsync(lastShareTargetKey(apiUrl, userId))) ?? "null");
    if (!isDynamicRecord(value)) return null;
    const { serverId, agentId } = value;
    return isString(serverId) && isString(agentId) ? { serverId, agentId } : null;
  } catch {
    return null;
  }
}

export async function saveLastShareTarget(apiUrl: string, userId: string, target: ShareTarget): Promise<void> {
  try {
    await SecureStore.setItemAsync(lastShareTargetKey(apiUrl, userId), JSON.stringify(target));
  } catch {}
}
