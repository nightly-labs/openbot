import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { remoteHostFingerprint } from "@openbot/team-client";
import * as SecureStore from "expo-secure-store";
import { create } from "zustand";
import type { ShortcutTarget } from "./shortcut-target";

/**
 * The agent that gets the messages of the Send Message shortcut. The user chooses it in Settings >
 * Shortcuts. It is saved on this phone for one account.
 */
export const useShortcutAgent = create<{
  /** The account that `target` is for. Null before the first read. */
  account: string | null;
  target: ShortcutTarget | null;
  saving: boolean;
}>(() => ({ account: null, target: null, saving: false }));

function accountKey(apiUrl: string, userId: string): string {
  return `openbot.shortcut-agent.v1.${remoteHostFingerprint(JSON.stringify([new URL(apiUrl).origin, userId]))}`;
}

/** A value that cannot be read is no choice. The shortcuts then ask the user to choose an agent. */
export async function loadShortcutAgent(apiUrl: string, userId: string): Promise<void> {
  const account = accountKey(apiUrl, userId);
  if (useShortcutAgent.getState().account === account) return;
  let target: ShortcutTarget | null = null;
  try {
    const value = JSON.parse((await SecureStore.getItemAsync(account)) ?? "null");
    if (isDynamicRecord(value) && isString(value.serverId) && isString(value.agentId))
      target = { serverId: value.serverId, agentId: value.agentId };
  } catch {
    // The setting shows no agent, and the user can choose again.
  }
  // A choice that Settings saved during the read stays.
  if (useShortcutAgent.getState().account !== account) useShortcutAgent.setState({ account, target });
}

/** Applies the choice at once, also when the save fails. Settings then offers a retry. */
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
