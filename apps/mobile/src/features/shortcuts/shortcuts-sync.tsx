import type { RemoteWorkspacePreferences } from "@openbot/team-client";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useCSSVariable } from "uniwind";
import { useAppLock } from "@/features/app-lock/model/app-lock";
import { shareAvatarName } from "@/features/share/model/share-extension";
import type { MobileAgent, MobileServer } from "@/features/workspace/model/workspace-types";
import { useText } from "@/shared/lib/text";
import { loadShortcutAgent, useShortcutAgent } from "./model/shortcut-agent";
import {
  lockShortcutDirectory,
  readShortcutDirectory,
  type ShortcutDirectory,
  type ShortcutDirectoryAgent,
  writeShortcutDirectory,
} from "./model/shortcut-directory";
import { shortcutsSupported } from "./shortcuts-native";

interface ShortcutsSyncProps {
  apiUrl: string;
  userId: string;
  /** In the order of the app's server list. */
  servers: readonly MobileServer[];
  /** False while the account directory loads, when the servers can be out of date. */
  serversReady: boolean;
  agents: readonly MobileAgent[];
  preferences: Readonly<Record<string, RemoteWorkspacePreferences>>;
}

/**
 * Keeps the data of the iOS shortcuts current. The App Intents run in native code with no
 * JavaScript, so they read from this: the agents, the agent of Settings > Shortcuts, the app lock,
 * and the text of the cards in the app's language. The servers and the agent pictures are the ones
 * that `ShareExtensionSync` writes. A server that did not load keeps the agents that the app saw last. A hidden chat is not listed, as on the app icon: the
 * list shows outside the app.
 */
export function ShortcutsSync(props: ShortcutsSyncProps): ReactNode {
  return shortcutsSupported ? <ShortcutsDirectorySync {...props} /> : null;
}

function ShortcutsDirectorySync({
  apiUrl,
  userId,
  servers,
  serversReady,
  agents,
  preferences,
}: ShortcutsSyncProps): null {
  const { t } = useText();
  const accent = String(useCSSVariable("--openbot-accent"));
  const lockReady = useAppLock((state) => state.status === "ready");
  const lockOn = useAppLock((state) => state.config.pin || state.config.deviceUnlock);
  const locked = !lockReady || lockOn;
  const [saved] = useState(() => readShortcutDirectory(apiUrl, userId));
  const target = useShortcutAgent((state) => state.target);
  const targetReady = useShortcutAgent((state) => state.account !== null);

  useEffect(() => {
    void loadShortcutAgent(apiUrl, userId);
  }, [apiUrl, userId]);

  const text = useMemo(
    () => ({
      "mobile.settings.shortcuts.card.agents": t("mobile.settings.shortcuts.card.agents"),
      "mobile.settings.shortcuts.card.noAgents": t("mobile.settings.shortcuts.card.noAgents"),
      "mobile.settings.shortcuts.card.setUp.title": t("mobile.settings.shortcuts.card.setUp.title"),
      "mobile.settings.shortcuts.card.setUp.action": t("mobile.settings.shortcuts.card.setUp.action"),
      "mobile.settings.shortcuts.card.noAgent.title": t("mobile.settings.shortcuts.card.noAgent.title"),
      "mobile.settings.shortcuts.card.noAgent.detail": t("mobile.settings.shortcuts.card.noAgent.detail"),
      "mobile.settings.shortcuts.card.noAgent.action": t("mobile.settings.shortcuts.card.noAgent.action"),
      "mobile.settings.shortcuts.card.locked.title": t("mobile.settings.shortcuts.card.locked.title"),
      "mobile.settings.shortcuts.card.locked.action": t("mobile.settings.shortcuts.card.locked.action"),
      "mobile.settings.shortcuts.send.sent": t("mobile.settings.shortcuts.send.sent"),
      "mobile.settings.shortcuts.send.failed": t("mobile.settings.shortcuts.send.failed"),
      "mobile.settings.shortcuts.send.unconfirmed": t("mobile.settings.shortcuts.send.unconfirmed"),
      "mobile.settings.shortcuts.send.inApp": t("mobile.settings.shortcuts.send.inApp"),
      "mobile.settings.shortcuts.send.openChat": t("mobile.settings.shortcuts.send.openChat"),
    }),
    [t],
  );

  const directory = useMemo((): ShortcutDirectory | null => {
    if (!serversReady || !targetReady) return null;
    const listed: ShortcutDirectoryAgent[] = [];
    let chosen: ShortcutDirectoryAgent | null = null;
    const isTarget = (agent: Pick<ShortcutDirectoryAgent, "serverId" | "id">) =>
      target !== null && agent.serverId === target.serverId && agent.id === target.agentId;
    // Only a server with a key can be reached. The data of the share extension has the same servers.
    for (const server of servers.filter((item) => item.publicKey)) {
      const loaded = agents.filter((agent) => agent.serverId === server.id);
      if (server.state !== "online" && loaded.length === 0) {
        // The server did not load, so the phone does not know its hidden chats: the saved list has none.
        listed.push(...(saved?.agents.filter((agent) => agent.serverId === server.id) ?? []));
        if (saved?.agent && saved.agent.serverId === server.id && isTarget(saved.agent)) chosen = saved.agent;
        continue;
      }
      const hidden = preferences[server.id]?.hidden ?? [];
      for (const agent of loaded) {
        const entry = {
          serverId: agent.serverId,
          id: agent.id,
          name: agent.name,
          server: server.name,
          // The share extension offers each agent, also a hidden one, so it has the picture.
          avatar: shareAvatarName(agent),
        };
        // The agent of the setting stays reachable when its chat is hidden: the user chose it.
        if (isTarget(entry)) chosen = entry;
        if (!hidden.includes(agent.id)) listed.push(entry);
      }
    }
    return {
      version: 2,
      apiUrl,
      userId,
      locked,
      agent: chosen,
      agents: listed,
      text,
      accent,
    };
  }, [serversReady, targetReady, servers, agents, preferences, saved, target, apiUrl, userId, locked, text, accent]);

  useEffect(() => {
    if (!directory) {
      // The lock must reach the shortcuts also while the servers load.
      if (locked) lockShortcutDirectory();
      return;
    }
    writeShortcutDirectory(directory);
  }, [directory, locked]);

  return null;
}
