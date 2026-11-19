import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import * as SecureStore from "expo-secure-store";
import { create } from "zustand";
import { accountScope } from "@/shared/lib/account-scope";
import type { ShortcutTarget } from "./shortcut-target";

export const useShortcutAgent = create<{
  account: string | null;
  target: ShortcutTarget | null;
  saving: boolean;
}>(() => ({ account: null, target: null, saving: false }));

function accountKey(apiUrl: string, userId: string): string {
  return `openbot.shortcut-agent.v1.${accountScope(apiUrl, userId)}`;
}

export async function loadShortcutAgent(apiUrl: string, userId: string): Promise<void> {
  const account = accountKey(apiUrl, userId);
  if (useShortcutAgent.getState().account === account) return;
  let target: ShortcutTarget | null = null;
  try {
    const value = JSON.parse((await SecureStore.getItemAsync(account)) ?? "null");
    if (isDynamicRecord(value) && isString(value.serverId) && isString(value.agentId))
      target = { serverId: value.serverId, agentId: value.agentId };
  } catch {}
  if (useShortcutAgent.getState().account !== account) useShortcutAgent.setState({ account, target });
}

export async function saveShortcutAgent(apiUrl: string, userId: string, target: ShortcutTarget | null): Promise<void> {
  const account = accountKey(apiUrl, userId);
  useShortcutAgent.setState({ account, target, saving: true });
  try {
    if (target) await SecureStore.setItemAsync(account, JSON.stringify(target));
    else await SecureStore.deleteItemAsync(account);
  } finally {
    useShortcutAgent.setState({ saving: false });
  }
}
