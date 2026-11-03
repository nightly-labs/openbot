import type { MobileTextKey } from "@openbot/i18n/mobile";
import { useEffect, useState } from "react";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { hostedServerCalls } from "@/features/servers/api/hosted-servers";
import { useServerUpdate } from "@/features/servers/model/use-server-update";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import type { MobileServer } from "@/features/workspace/model/workspace-types";

export type ServerSettingsCategory = "general" | "people" | "ai" | "data" | "maintenance";

/** The Server settings pages, in the order of the first page. */
export const SERVER_SETTINGS_CATEGORIES = [
  "general",
  "people",
  "ai",
  "data",
  "maintenance",
] as const satisfies readonly ServerSettingsCategory[];

export const SERVER_SETTINGS_CATEGORY_TITLE_KEYS = {
  general: "mobile.server.settings.general",
  people: "mobile.server.settings.peopleSection",
  ai: "mobile.server.settings.aiSection",
  data: "mobile.server.settings.dataSection",
  maintenance: "mobile.server.settings.maintenanceSection",
} as const satisfies Record<ServerSettingsCategory, MobileTextKey>;

/**
 * The server IDs of the owner's hosted servers, or null until the account server lists them.
 * Billing deletes a hosted server, so Remove shows only after the list is known.
 */
export function useOwnerHostedServerIds(server: MobileServer | undefined): ReadonlySet<string> | null {
  const { session } = useMobileSession();
  const owner = server?.role === "owner";
  const [ids, setIds] = useState<ReadonlySet<string> | null>(null);
  useEffect(() => {
    if (!session || !owner) return;
    let current = true;
    hostedServerCalls(session)
      .list()
      .then(
        (list) => {
          if (current) setIds(new Set(list.servers.map((item) => item.serverId)));
        },
        () => undefined,
      );
    return () => {
      current = false;
    };
  }, [session, owner]);
  return ids;
}

/** The same rule as the Restart item of the desktop server menu. */
export function canRestartServer(server: MobileServer, hostedServerIds: ReadonlySet<string> | null): boolean {
  return (
    server.kind === "remote" &&
    (server.role === "owner" || server.role === "admin") &&
    (server.hosted === true || Boolean(hostedServerIds?.has(server.id)))
  );
}

/**
 * The items that each Server settings page shows to this role, as text keys. A page shows only when
 * the host serves one of its items. The first page names the items under each page.
 */
export function useServerSettingsItems(
  server: MobileServer,
  hostedServerIds: ReadonlySet<string> | null,
): Record<ServerSettingsCategory, MobileTextKey[]> {
  const workspace = useMobileWorkspace();
  const serverId = server.id;
  const update = useServerUpdate(serverId, { poll: false });
  const pick = (entries: [boolean, MobileTextKey][]) => entries.filter(([shown]) => shown).map(([, key]) => key);
  return {
    general: pick([
      [true, "mobile.server.settings.status"],
      [workspace.canManageServerTimezone(serverId), "mobile.server.settings.timezone"],
      [workspace.canManageAgentMemoryLimit(serverId), "mobile.server.settings.memoryLimit"],
      [
        workspace.canRotateServerKey(serverId) || server.keyChangedAt !== undefined,
        "mobile.server.settings.keySection",
      ],
    ]),
    people: pick([
      [true, "mobile.server.settings.members"],
      [workspace.canManageServerRoles(serverId), "mobile.server.route.roles"],
      [workspace.canReadServerAudit(serverId), "mobile.server.route.audit"],
    ]),
    ai: pick([
      [workspace.canManageProviders(serverId), "mobile.server.settings.providers"],
      [workspace.canManageMcpServers(serverId), "mobile.server.settings.mcp"],
      [
        workspace.canManageConnectors(serverId) ||
          workspace.canManageOnePasswordConnector(serverId) ||
          workspace.canManageBitwardenConnector(serverId),
        "mobile.server.settings.connectors",
      ],
    ]),
    data: pick([
      [workspace.canManageVault(serverId), "mobile.server.settings.vault"],
      [workspace.canManageBrowserProfiles(serverId), "mobile.server.route.browserProfiles"],
      [workspace.canViewHostedSites(serverId), "mobile.server.settings.sites"],
      [workspace.canReadServerStorage(serverId), "mobile.server.settings.storage"],
      [workspace.canImportAgents(serverId), "mobile.server.settings.importAgents"],
      [workspace.canTransferServer(serverId), "mobile.server.settings.transfer"],
    ]),
    maintenance: pick([
      [Boolean(update.access || update.query.data), "mobile.server.settings.updates"],
      [true, "mobile.server.settings.refresh"],
      [canRestartServer(server, hostedServerIds), "mobile.server.settings.restart"],
    ]),
  };
}
