import type { RemoteWorkspacePreferences } from "@openbot/team-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { supportLog, supportLogValue } from "@/features/support/model/support-log";
import type { MobileAgent, MobileServer } from "@/features/workspace/model/workspace-types";
import * as LockedKeychain from "@/shared/lib/locked-keychain";
import { useText } from "@/shared/lib/text";
import { loadQuickActionChoice, useQuickActionChoice } from "./model/quick-action-choice";
import { currentRecentAgents, quickActionItems, type RecentAgent, withOpenedAgent } from "./model/quick-action-items";
import { decodeRecentAgents, recentAgentsKey, useOpenedChat } from "./model/recent-agents";
import { publishQuickActions } from "./quick-actions-native";

const NO_IDS: readonly string[] = [];

interface QuickActionsSyncProps {
  apiUrl: string;
  userId: string;
  servers: readonly MobileServer[];
  /** False while the account directory loads, when the servers can be out of date. */
  serversReady: boolean;
  activeServerId: string | null;
  agents: readonly MobileAgent[];
  preferences: Readonly<Record<string, RemoteWorkspacePreferences>>;
}

/**
 * Keeps the quick actions of the app icon current: the items that the user chose in Settings > App
 * Icon Menu, with the chats that this phone opened last. The phone keeps the items while the app is closed. A hidden chat does not show,
 * and it is not saved. A separate component, so an opened chat renders only this and not the workspace.
 */
export function QuickActionsSync({
  apiUrl,
  userId,
  servers,
  serversReady,
  activeServerId,
  agents,
  preferences,
}: QuickActionsSyncProps): null {
  const { t } = useText();
  const key = recentAgentsKey(apiUrl, userId);
  // `null` when the phone cannot read the saved chats. Then nothing changes, so nothing is lost.
  const [recents, setRecents] = useState(() => readRecentAgents(key));
  const saved = useRef(recents === null ? null : JSON.stringify(recents));
  const openedAgentId = useOpenedChat((state) => state.agentId);
  const kinds = useQuickActionChoice((state) => state.kinds);
  const hiddenIds = useCallback((serverId: string) => preferences[serverId]?.hidden ?? NO_IDS, [preferences]);

  useEffect(() => {
    // A chat that opens before its agent loads goes first when the agent loads.
    const opened = openedAgentId === null ? undefined : agents.find((agent) => agent.id === openedAgentId);
    if (!opened) return;
    useOpenedChat.setState({ agentId: null });
    if (hiddenIds(opened.serverId).includes(opened.id)) return;
    setRecents((current) => current && withOpenedAgent(current, opened));
  }, [openedAgentId, agents, hiddenIds]);

  useEffect(() => {
    // A phone that started the app while locked could not read the choice. It reads it after the unlock.
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") loadQuickActionChoice();
    });
    return () => subscription.remove();
  }, []);

  const current = useMemo(
    () => (recents && serversReady ? currentRecentAgents(recents, { servers, agents, hiddenIds }) : null),
    [recents, serversReady, servers, agents, hiddenIds],
  );

  useEffect(() => {
    if (!current) return;
    const value = JSON.stringify(current);
    if (value !== saved.current) {
      saved.current = value;
      LockedKeychain.setItemAsync(key, value).catch((error: unknown) => {
        supportLog.add("warn", "app", `Recent agents not saved: ${supportLogValue(error)}`);
      });
    }
    // Until the phone reads the choice, the icon keeps the items it has. A locked phone reads it at a later change.
    if (!kinds) loadQuickActionChoice();
    else void publishQuickActions(quickActionItems({ kinds, recents: current, servers, activeServerId, t }));
  }, [current, key, kinds, servers, activeServerId, t]);

  return null;
}

function readRecentAgents(key: string): RecentAgent[] | null {
  try {
    // A notification button starts the app while the phone is locked, and these items open after the first unlock.
    return decodeRecentAgents(LockedKeychain.getItem(key));
  } catch {
    return null;
  }
}
