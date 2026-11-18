import { canAdministerServer } from "@openbot/contracts/ipc";
import { Stack, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import Check from "lucide-react-native/icons/check";
import { useMemo } from "react";
import { useCSSVariable } from "uniwind";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import { mcpAccessAllows, useMcpAccess } from "@/features/servers/model/use-mcp-access";
import { useServerMcp } from "@/features/servers/model/use-server-mcp";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { showsOnline } from "@/features/workspace/model/server-status";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

/**
 * MCP server page > Access > Agents: the agents that get the MCP server. All agents also gives it to
 * each agent that is added later. A tap saves at once; the agents get a new provider session.
 */
export function ServerMcpServerAgentsScreen() {
  const { t, errorMessage } = useText();
  const accent = String(useCSSVariable("--openbot-accent"));
  const { serverId, mcpServerId } = useLocalSearchParams<{ serverId: string; mcpServerId: string }>();
  const mcp = useServerMcp(serverId);
  const saved = mcp.list.data?.find((config) => config.id === mcpServerId);
  const access = useMcpAccess(serverId, mcpServerId);
  const allAgents = useMobileWorkspaceSelector((workspace) => workspace.agents);
  const agents = useMemo(() => allAgents.filter((agent) => agent.serverId === serverId), [allAgents, serverId]);
  const { entry, action, snapshot } = access;
  if (!access.available || !saved || !entry)
    return (
      <SettingsContent>
        <SettingsNote>
          {!access.available
            ? // An owner or admin of an online host that is too old for `mcp-access-v1`.
              showsOnline(mcp.server) && canAdministerServer(mcp.server?.role)
              ? t("mobile.server.mcp.accessUnsupported")
              : t("mobile.server.mcp.access.unavailable")
            : snapshot.isError
              ? errorMessage(snapshot.error, t("mobile.server.mcp.access.loadFailed"))
              : mcp.list.isError
                ? errorMessage(mcp.list.error, t("mobile.server.mcp.access.loadFailed"))
                : mcp.list.isPending || snapshot.isPending
                  ? t("mobile.server.mcp.loading")
                  : t("mobile.server.mcp.gone")}
        </SettingsNote>
      </SettingsContent>
    );

  const shown = new Set(agents.map((agent) => agent.id));
  function toggle(agentId: string): void {
    void haptics.selection();
    void access.save((held) => {
      const on = agents
        .filter((agent) => (agent.id === agentId ? !mcpAccessAllows(held, agent.id) : mcpAccessAllows(held, agent.id)))
        .map((agent) => agent.id);
      // An agent that this list does not show keeps its place. Each agent on: also each agent added later.
      const kept = (held.agents ?? []).filter((id) => !shown.has(id));
      return { ...held, agents: on.length === agents.length ? null : [...kept, ...on] };
    });
  }
  function chooseAll(): void {
    if (entry?.agents === null) return;
    void haptics.selection();
    void access.save((held) => ({ ...held, agents: null }));
  }

  return (
    <SettingsContent>
      <Stack.Screen options={{ title: saved.name }} />
      <SettingsSection
        footer={
          action.error
            ? errorMessage(action.error, t("mobile.server.mcp.saveFailed"))
            : t("mobile.server.mcp.access.allAgentsHint")
        }
      >
        <SettingsRow
          checked={entry.agents === null}
          multiple
          disabled={action.isPending}
          disclosure={false}
          trailing={entry.agents === null ? <Check size={18} color={accent} strokeWidth={2} /> : null}
          onPress={chooseAll}
        >
          <Typography.Paragraph>{t("mobile.server.mcp.access.allAgents")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title={t("mobile.server.mcp.access.agentsOf", { name: saved.name })}>
        {agents.length === 0 ? (
          <SettingsRow disclosure={false}>
            <Typography.Paragraph className="text-grouped-secondary">
              {t("mobile.server.roles.noAgents")}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {agents.map((agent) => {
          const on = mcpAccessAllows(entry, agent.id);
          return (
            <SettingsRow
              key={agent.id}
              checked={on}
              multiple
              disabled={action.isPending}
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
