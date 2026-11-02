import type { AgentBrowserProfile } from "@openbot/contracts/ipc";
import { useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import Check from "lucide-react-native/icons/check";
import { useMemo, useState } from "react";
import { useCSSVariable } from "uniwind";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import { useServerBrowserProfiles } from "@/features/servers/model/use-server-browser-profiles";
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
 * Browser profiles > one profile > Add agents: every agent of the server, with a check on the agents
 * that use the profile. A tap gives the agent the profile, or moves it back to the shared profile,
 * and saves at once. The row says which profile the agent uses now.
 */
export function ServerBrowserProfileAgentsScreen() {
  const { t, errorMessage } = useText();
  const accent = String(useCSSVariable("--openbot-accent"));
  const { serverId, profileId } = useLocalSearchParams<{ serverId: string; profileId: string }>();
  const profiles = useServerBrowserProfiles(serverId);
  // The selector returns the stored list, so the page does not render again for a new copy.
  const allAgents = useMobileWorkspaceSelector((workspace) => workspace.agents);
  const agents = useMemo(() => allAgents.filter((agent) => agent.serverId === serverId), [allAgents, serverId]);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = profiles.profiles;
  const profile = list?.find((candidate) => candidate.id === profileId);
  if (!profiles.available || !list || !profile)
    return (
      <SettingsContent>
        <SettingsNote>
          {!profiles.available
            ? t("mobile.server.browserProfiles.unavailable")
            : profiles.query.isError
              ? errorMessage(profiles.query.error, t("mobile.server.browserProfiles.loadFailed"))
              : !list
                ? t("mobile.server.browserProfiles.loading")
                : t("mobile.server.browserProfiles.gone")}
        </SettingsNote>
      </SettingsContent>
    );

  /** The profile that an agent uses now: Shared, its own session, or another named profile. */
  const currentName = (agentId: string) => {
    const named = list.find((candidate) => candidate.agentIds.includes(agentId));
    if (named) return named.name;
    return profiles.sharedAgentIds?.includes(agentId)
      ? t("mobile.agent.browserProfile.shared")
      : t("mobile.agent.browserProfile.own");
  };

  function toggle(agentId: string, inProfile: boolean): void {
    if (pendingId || !profile) return;
    const next: AgentBrowserProfile = inProfile ? { kind: "shared" } : { kind: "profile", profileId: profile.id };
    void haptics.selection();
    setPendingId(agentId);
    setError(null);
    profiles
      .assign(agentId, next)
      .then(() => {
        void haptics.notification("success");
      })
      .catch((cause: unknown) => {
        void haptics.notification("error");
        setError(errorMessage(cause, t("mobile.agent.browserProfile.saveFailed")));
      })
      .finally(() => setPendingId(null));
  }

  return (
    <SettingsContent>
      {error ? (
        <Typography.Paragraph accessibilityRole="alert" type="body-xs" className="px-4 text-danger-text">
          {error}
        </Typography.Paragraph>
      ) : null}
      <SettingsSection title={profile.name} footer={t("mobile.server.browserProfiles.agentsHint")}>
        {agents.length === 0 ? (
          <SettingsRow disclosure={false}>
            <Typography.Paragraph className="text-grouped-secondary">
              {t("mobile.server.roles.noAgents")}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {agents.map((agent) => {
          const inProfile = profile.agentIds.includes(agent.id);
          return (
            <SettingsRow
              key={agent.id}
              checked={inProfile}
              disabled={pendingId !== null}
              disclosure={false}
              supportingText={inProfile ? undefined : currentName(agent.id)}
              leading={
                <BloubAvatar
                  agentId={agent.id}
                  serverId={agent.serverId}
                  hue={agent.avatarHue}
                  seed={agent.avatarSeed}
                  size={32}
                  animateIdle={false}
                />
              }
              trailing={inProfile ? <Check size={18} color={accent} strokeWidth={2} /> : null}
              onPress={() => toggle(agent.id, inProfile)}
            >
              <Typography.Paragraph numberOfLines={1}>{agent.name}</Typography.Paragraph>
            </SettingsRow>
          );
        })}
      </SettingsSection>
    </SettingsContent>
  );
}
