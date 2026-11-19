import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import * as SecureStore from "expo-secure-store";
import { useEffect, useState } from "react";
import { accountScope } from "@/shared/lib/account-scope";

/** The agent that got the last share, which the next share selects first. */
export interface ShareTarget {
  serverId: string;
  agentId: string;
}

function lastShareTargetKey(apiUrl: string, userId: string): string {
  return `openbot.share-target.v1.${accountScope(apiUrl, userId)}`;
}

/** Null when nothing is saved, or the value cannot be read. */
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

/** A failed save keeps the earlier choice; the share itself goes on. */
export async function saveLastShareTarget(apiUrl: string, userId: string, target: ShareTarget): Promise<void> {
  try {
    await SecureStore.setItemAsync(lastShareTargetKey(apiUrl, userId), JSON.stringify(target));
  } catch {
    // Only the next preselection is lost.
  }
}

export function useLastShareTarget(apiUrl: string | undefined, userId: string | undefined): ShareTarget | null {
  const [target, setTarget] = useState<ShareTarget | null>(null);
  useEffect(() => {
    if (!apiUrl || !userId) return;
    let mounted = true;
    void loadLastShareTarget(apiUrl, userId).then((loaded) => {
      if (mounted) setTarget(loaded);
    });
    return () => {
      mounted = false;
    };
  }, [apiUrl, userId]);
  return target;
}
