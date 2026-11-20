import type { RemoteWorkspacePreferences } from "@openbot/team-client";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useCSSVariable } from "uniwind";
import { useAppLock } from "@/features/app-lock/model/app-lock";
import { appLockEnabled } from "@/features/app-lock/model/app-lock-storage";
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
  servers: readonly MobileServer[];
  serversReady: boolean;
  agents: readonly MobileAgent[];
  preferences: Readonly<Record<string, RemoteWorkspacePreferences>>;
}

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
  const locked = useAppLock((state) => state.status !== "ready" || appLockEnabled(state.config));
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
      "mobile.settings.shortcuts.card.message": t("mobile.settings.shortcuts.card.message", { name: "{name}" }),
      "mobile.settings.shortcuts.card.messagePrompt": t("mobile.settings.shortcuts.card.messagePrompt", {
        name: "{name}",
      }),
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
    for (const server of servers.filter((item) => item.publicKey)) {
      const loaded = agents.filter((agent) => agent.serverId === server.id);
      if (server.state !== "online" && loaded.length === 0) {
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
          avatar: shareAvatarName(agent),
        };
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
      if (locked) lockShortcutDirectory();
      return;
    }
    writeShortcutDirectory(directory);
  }, [directory, locked]);

  return null;
}
