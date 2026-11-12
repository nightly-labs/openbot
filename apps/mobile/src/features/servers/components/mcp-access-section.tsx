import { MCP_ACCESS_LEVELS, type McpAccessLevel, mcpAccessRank } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { router } from "expo-router";
import { Typography } from "heroui-native";
import { useMemo } from "react";
import { useUniwind } from "uniwind";
import {
  mcpAccessAllows,
  mcpRoleLevel,
  useMcpAccess,
  withEveryoneLevel,
  withRoleLevel,
} from "@/features/servers/model/use-mcp-access";
import { useServerRoles } from "@/features/servers/model/use-server-roles";
import { SettingsNote, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsPicker } from "@/features/settings/components/settings-controls";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

const LEVEL_KEYS = {
  none: "mobile.server.roles.level.none",
  use: "mobile.server.mcp.access.use",
  manage: "mobile.server.roles.level.manage",
} as const satisfies Record<McpAccessLevel, MobileTextKey>;

/**
 * MCP server page > Access, for an owner or admin of a host with `mcp-access-v1`: the agents that get
 * the server, and the level of Everyone and of each role. A level saves at once. A member gets the
 * highest level of Everyone and of their roles; the host applies it on each request.
 */
export function McpAccessSection({
  serverId,
  mcpServerId,
  name,
}: {
  serverId: string;
  mcpServerId: string;
  name: string;
}) {
  const { t, errorMessage } = useText();
  const { theme } = useUniwind();
  const access = useMcpAccess(serverId, mcpServerId);
  // The names of the roles come from `agent-access-v1`. A host without roles still gives Everyone.
  const roles = useServerRoles(serverId).list ?? [];
  const allAgents = useMobileWorkspaceSelector((workspace) => workspace.agents);
  const agents = useMemo(() => allAgents.filter((agent) => agent.serverId === serverId), [allAgents, serverId]);
  const { entry, action, snapshot } = access;
  if (!access.available) return null;
  if (!entry)
    return snapshot.isError ? (
      <SettingsNote>{errorMessage(snapshot.error, t("mobile.server.mcp.access.loadFailed"))}</SettingsNote>
    ) : null;

  const have = agents.filter((agent) => mcpAccessAllows(entry, agent.id)).length;
  const agentsSummary =
    entry.agents === null
      ? t("mobile.server.mcp.access.allAgents")
      : have === 0
        ? t("mobile.server.mcp.access.noAgents")
        : t("mobile.server.mcp.access.someAgents", { count: have, total: agents.length });
  const options = (floor: McpAccessLevel) =>
    MCP_ACCESS_LEVELS.filter((level) => mcpAccessRank(level) >= mcpAccessRank(floor)).map((value) => ({
      value,
      label: t(LEVEL_KEYS[value]),
    }));
  const setLevel = (current: McpAccessLevel, next: McpAccessLevel, roleId?: string) => {
    if (next === current) return;
    void haptics.selection();
    void access.save((held) => (roleId ? withRoleLevel(held, roleId, next) : withEveryoneLevel(held, next)));
  };

  return (
    <SettingsSection
      title={t("mobile.server.mcp.access.title")}
      footer={
        action.error
          ? errorMessage(action.error, t("mobile.server.mcp.saveFailed"))
          : t("mobile.server.mcp.access.hint")
      }
    >
      <SettingsRow
        value={agentsSummary}
        disabled={action.isPending}
        onPress={() =>
          router.push({ pathname: "/server-settings/mcp-server-agents", params: { serverId, mcpServerId } })
        }
      >
        <Typography.Paragraph>{t("mobile.server.mcp.access.agents")}</Typography.Paragraph>
      </SettingsRow>
      <SettingsRow
        disclosure={false}
        trailing={
          <SettingsPicker
            value={entry.everyone}
            options={options("none")}
            enabled={!action.isPending}
            dark={theme === "dark"}
            label={t("mobile.server.mcp.access.level", { role: t("mobile.server.roles.everyone"), name })}
            onChange={(next) => setLevel(entry.everyone, next)}
          />
        }
      >
        <Typography.Paragraph numberOfLines={1}>{t("mobile.server.roles.everyone")}</Typography.Paragraph>
      </SettingsRow>
      {roles.map((role) => {
        const level = mcpRoleLevel(entry, role.id);
        return (
          <SettingsRow
            key={role.id}
            disclosure={false}
            // The role has no level of its own: a change of Everyone also changes it.
            supportingText={
              level === entry.everyone && level !== "none" ? t("mobile.server.mcp.access.fromEveryone") : undefined
            }
            trailing={
              <SettingsPicker
                value={level}
                // A role cannot go below the level that Everyone gives.
                options={options(entry.everyone)}
                enabled={!action.isPending}
                dark={theme === "dark"}
                label={t("mobile.server.mcp.access.level", { role: role.name, name })}
                onChange={(next) => setLevel(level, next, role.id)}
              />
            }
          >
            <Typography.Paragraph numberOfLines={1}>{role.name}</Typography.Paragraph>
          </SettingsRow>
        );
      })}
    </SettingsSection>
  );
}
