import { useEffect, useMemo, useRef, useState } from "react";
import { useCSSVariable } from "uniwind";
import { useAppLock } from "@/features/app-lock/model/app-lock";
import type { MobileAgent, MobileServer } from "@/features/workspace/model/workspace-types";
import { useText } from "@/shared/lib/text";
import { loadLastShareTarget, type ShareTarget } from "./model/last-share-target";
import {
  forgetShareTargets,
  lockShareExtension,
  readShareExtensionAgents,
  type ShareExtensionAgent,
  type ShareExtensionDirectory,
  setShareExtensionSession,
  shareAvatarName,
  shareConversationId,
  writeShareExtensionDirectory,
} from "./model/share-extension";

interface ShareExtensionSyncProps {
  apiUrl: string;
  userId: string;
  sessionToken: string;
  /** In the order of the app's server list, with the default server first. */
  servers: readonly MobileServer[];
  /** False while the account directory loads, when the servers can be out of date. */
  serversReady: boolean;
  agents: readonly MobileAgent[];
}

/**
 * Keeps the data of the iOS share extension current, so it can send a share without the app: the
 * session, the servers and their agents, the app lock, and the extension's text in the app's language.
 * An online server has loaded all its agents. A server that did not load keeps the agents that the
 * app saw last, so the extension still offers them. As in the app's share sheet, a hidden agent is
 * offered too: hiding takes an agent out of the chat list, not out of reach.
 */
export function ShareExtensionSync({
  apiUrl,
  userId,
  sessionToken,
  servers,
  serversReady,
  agents,
}: ShareExtensionSyncProps): null {
  const { t } = useText();
  const accent = String(useCSSVariable("--openbot-accent"));
  const lockReady = useAppLock((state) => state.status === "ready");
  const lockOn = useAppLock((state) => state.config.pin || state.config.deviceUnlock);
  const locked = !lockReady || lockOn;
  const [saved] = useState(() => readShareExtensionAgents(apiUrl, userId) ?? []);
  const offered = useRef(new Set(saved.map((agent) => shareConversationId(agent.serverId, agent.id))));
  const [lastTarget, setLastTarget] = useState<ShareTarget | null>(null);

  useEffect(() => {
    setShareExtensionSession({ apiUrl, userId, sessionToken });
  }, [apiUrl, userId, sessionToken]);

  useEffect(() => {
    let mounted = true;
    void loadLastShareTarget(apiUrl, userId).then((target) => {
      if (mounted) setLastTarget(target);
    });
    return () => {
      mounted = false;
    };
  }, [apiUrl, userId]);

  const text = useMemo(
    () => ({
      "mobile.app.route.share": t("mobile.app.route.share"),
      "mobile.share.content": t("mobile.share.content"),
      "mobile.share.lastUsed": t("mobile.share.lastUsed"),
      "mobile.share.noAgents": t("mobile.share.noAgents"),
      "mobile.share.extension.send": t("mobile.share.extension.send"),
      "mobile.share.extension.footer": t("mobile.share.extension.footer"),
      // The extension puts the agent's name in place of `{name}`.
      "mobile.share.extension.sending": t("mobile.share.extension.sending", { name: "{name}" }),
      "mobile.share.extension.sent": t("mobile.share.extension.sent", { name: "{name}" }),
      "mobile.share.extension.failed": t("mobile.share.extension.failed"),
      "mobile.share.extension.unconfirmed": t("mobile.share.extension.unconfirmed"),
      "mobile.share.extension.openApp": t("mobile.share.extension.openApp"),
      "common.cancel": t("common.cancel"),
      "common.done": t("common.done"),
    }),
    [t],
  );

  const directory = useMemo((): ShareExtensionDirectory | null => {
    if (!serversReady) return null;
    // The paired desktop (`kind: "local"`) connects as every other server does. Only a server
    // without a key, such as the placeholder before the directory loads, cannot be reached.
    const reachable = servers.filter((server) => server.publicKey);
    const offeredAgents: ShareExtensionAgent[] = [];
    for (const server of reachable) {
      const loaded = agents.filter((agent) => agent.serverId === server.id);
      const current =
        server.state === "online" || loaded.length > 0
          ? loaded.map((agent) => ({
              serverId: agent.serverId,
              id: agent.id,
              name: agent.name,
              avatar: shareAvatarName(agent),
            }))
          : saved.filter((agent) => agent.serverId === server.id);
      offeredAgents.push(...current);
    }
    return {
      version: 1,
      apiUrl,
      userId,
      locked,
      servers: reachable.map((server) => ({
        id: server.id,
        name: server.name,
        publicKey: server.publicKey,
        hosted: server.hosted === true,
      })),
      agents: offeredAgents,
      lastTarget,
      text,
      accent,
    };
  }, [serversReady, servers, agents, saved, apiUrl, userId, locked, lastTarget, text, accent]);

  useEffect(() => {
    if (!directory) {
      // The lock must reach the extension also while the servers load.
      if (locked) lockShareExtension();
      return;
    }
    writeShareExtensionDirectory(directory, agents);
    // The share sheet must not offer an agent that is gone or on a server the account left.
    const next = new Set(directory.agents.map((agent) => shareConversationId(agent.serverId, agent.id)));
    forgetShareTargets([...offered.current].filter((id) => !next.has(id)));
    offered.current = next;
  }, [directory, agents, locked]);

  return null;
}
