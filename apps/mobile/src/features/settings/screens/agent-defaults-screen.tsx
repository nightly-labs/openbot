import { router, Stack, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useUniwind } from "uniwind";
import { ServerAvatar } from "@/features/servers/components/server-avatar";
import {
  AgentDefaultsError,
  AgentDefaultsStatus,
  agentDefaultValueLabel,
} from "@/features/settings/components/agent-defaults-parts";
import { BackgroundProcessesSection } from "@/features/settings/components/background-processes-section";
import { SettingsContent, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsSwitch } from "@/features/settings/components/settings-controls";
import {
  AGENT_DEFAULT_SETTINGS,
  agentDefaultApplies,
  agentDefaultOn,
  agentDefaultsServers,
  useAgentDefaults,
} from "@/features/settings/model/agent-defaults";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { serverStatusLabel } from "@/features/workspace/model/server-status";
import { useText } from "@/shared/lib/text";

const SERVER_AVATAR_SIZE = 32;

/**
 * Settings > Agents: the agent defaults of the servers where this member is an owner or admin, as
 * the Agents tab of the desktop Settings. With one such server the page shows it at once; with more,
 * it lists them first. A server that is not connected shows its state, and its page disables the
 * controls.
 */
export function AgentDefaultsScreen() {
  const { t } = useText();
  const { serverId } = useLocalSearchParams<{ serverId?: string }>();
  const workspace = useMobileWorkspace();
  if (serverId) return <AgentDefaultsServerPage serverId={serverId} titled />;
  const servers = agentDefaultsServers(workspace);
  const [only] = servers;
  if (servers.length === 1 && only) return <AgentDefaultsServerPage serverId={only.serverId} titled={false} />;
  return (
    <SettingsContent>
      <SettingsSection footer={t("mobile.settings.agents.serversFooter")}>
        {servers.map(({ serverId: id, state }) => {
          const server = workspace.servers.find((candidate) => candidate.id === id);
          if (!server) return null;
          return (
            <SettingsRow
              key={id}
              leading={<ServerAvatar server={server} size={SERVER_AVATAR_SIZE} />}
              supportingText={state === "disabled" ? serverStatusLabel(server, t) : undefined}
              onPress={() => router.push({ pathname: "/settings/agents", params: { serverId: id } })}
            >
              <Typography.Paragraph numberOfLines={1}>{server.name}</Typography.Paragraph>
            </SettingsRow>
          );
        })}
      </SettingsSection>
    </SettingsContent>
  );
}

/**
 * The agent defaults of one server: a row for each setting with its default and the agents that
 * have it on, the commit co-author switch, which applies to all agents, and the programs that the
 * agents left running.
 */
function AgentDefaultsServerPage({ serverId, titled }: { serverId: string; titled: boolean }) {
  const { t, format } = useText();
  const { theme } = useUniwind();
  const state = useAgentDefaults(serverId);
  const { overview, agents, server } = state;
  return (
    <SettingsContent>
      {titled && server ? <Stack.Screen options={{ title: server.name }} /> : null}
      <AgentDefaultsStatus state={state} />
      <AgentDefaultsError error={state.error} />
      {overview ? (
        <>
          <SettingsSection
            title={t("mobile.settings.agents.defaults")}
            footer={t("mobile.settings.agents.defaultsFooter")}
          >
            {AGENT_DEFAULT_SETTINGS.map((setting) => {
              const on = agents.filter((row) => agentDefaultApplies(overview, row.values, setting.key)).length;
              return (
                <SettingsRow
                  key={setting.key}
                  supportingText={t("mobile.settings.agents.value", {
                    value: agentDefaultValueLabel(t, setting.key, agentDefaultOn(overview, setting.key)),
                  })}
                  value={
                    agents.length > 0
                      ? t("mobile.settings.agents.count", {
                          on: format.number(on),
                          total: format.number(agents.length),
                        })
                      : undefined
                  }
                  onPress={() =>
                    router.push({ pathname: "/settings/agent-defaults", params: { serverId, setting: setting.key } })
                  }
                >
                  <Typography.Paragraph>{t(setting.title)}</Typography.Paragraph>
                </SettingsRow>
              );
            })}
          </SettingsSection>
          <SettingsSection
            title={t("mobile.settings.agents.commitSection")}
            footer={t("mobile.settings.agents.commitCoAuthorFooter")}
          >
            <SettingsRow>
              <SettingsSwitch
                value={overview.defaults.commitCoAuthor}
                disabled={!state.enabled}
                label={t("mobile.settings.agents.commitCoAuthor")}
                dark={theme === "dark"}
                onValueChange={(commitCoAuthor) => void state.updateDefaults({ commitCoAuthor })}
              />
            </SettingsRow>
          </SettingsSection>
          <BackgroundProcessesSection serverId={serverId} online={state.online} />
        </>
      ) : null}
    </SettingsContent>
  );
}
