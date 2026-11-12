import { useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import Check from "lucide-react-native/icons/check";
import { useMemo } from "react";
import { useCSSVariable } from "uniwind";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import { useMcpAccess, useServerMcp } from "@/features/servers/model/use-server-mcp";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

/**
 * MCP servers > one server > Agents: each agent of the server, with a check on the agents that get the
 * MCP server. A tap saves at once. With all agents on, the host stores "all agents", so an agent that
 * is added later also gets the server. An owner or admin of a host with `mcp-access-v1` only.
 */
export function ServerMcpServerAgentsScreen() {
  const { t, errorMessage } = useText();
  const accent = String(useCSSVariable("--openbot-accent"));
  const { serverId, mcpServerId } = useLocalSearchParams<{ serverId: string; mcpServerId: string }>();
  const mcp = useServerMcp(serverId);
  const access = useMcpAccess(serverId);
  // The selector returns the stored list, so the page does not render again for a new copy.
  const allAgents = useMobileWorkspaceSelector((workspace) => workspace.agents);
  const agents = useMemo(() => allAgents.filter((agent) => agent.serverId === serverId), [allAgents, serverId]);
  const saved = mcp.list.data?.find((config) => config.id === mcpServerId);
  if (!access.admin || !saved)
    return (
      <SettingsContent>
        <SettingsNote>
          {access.access.isError
            ? errorMessage(access.access.error, t("mobile.server.mcp.access.loadFailed"))
            : access.access.isPending || mcp.list.isPending
              ? t("mobile.server.mcp.loading")
              : !saved
                ? t("mobile.server.mcp.gone")
                : t("mobile.server.mcp.access.unavailable")}
        </SettingsNote>
      </SettingsContent>
    );
  const savedId = saved.id;
  const entry = access.entry(savedId);
  const allows = (agentId: string) => entry.agents === null || entry.agents.includes(agentId);

  function toggle(agentId: string): void {
    if (access.action.isPending) return;
    void haptics.selection();
    const shown = new Set(agents.map((agent) => agent.id));
    const on = agents.filter((agent) => (agent.id === agentId ? !allows(agentId) : allows(agent.id)));
    // An agent that this list does not show keeps its place. All agents: also each agent added later.
    const kept = (entry.agents ?? []).filter((id) => !shown.has(id));
    const next = on.length === agents.length ? null : [...kept, ...on.map((agent) => agent.id)];
    void access.set(savedId, { ...entry, agents: next });
  }

  return (
    <SettingsContent>
      <SettingsSection
        title={saved.name}
        footer={
          access.action.error
            ? errorMessage(access.action.error, t("mobile.server.mcp.access.saveFailed"))
            : t("mobile.server.mcp.access.agentsHint")
        }
      >
        {agents.length === 0 ? (
          <SettingsRow disclosure={false}>
            <Typography.Paragraph className="text-grouped-secondary">
              {t("mobile.server.roles.noAgents")}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {agents.map((agent) => {
          const on = allows(agent.id);
          return (
            <SettingsRow
              key={agent.id}
              checked={on}
              multiple
              disabled={access.action.isPending}
              disclosure={false}
              leading={
                <BloubAvatar
                  agentId={agent.id}
                  serverId={agent.serverId}
                  hue={agent.avatarHue}
                  color={agent.avatarColor}
                  seed={agent.avatarSeed}
                  size={32}
                  animateIdle={false}
                />
              }
              trailing={on ? <Check size={18} color={accent} strokeWidth={2} /> : null}
              onPress={() => toggle(agent.id)}
            >
              <Typography.Paragraph numberOfLines={1}>{agent.name}</Typography.Paragraph>
            </SettingsRow>
          );
        })}
      </SettingsSection>
    </SettingsContent>
  );
}
