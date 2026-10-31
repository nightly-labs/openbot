import {
  type AgentBrowserProfile,
  BROWSER_PROFILE_LIMIT,
  type BrowserProfileSummary,
  sameAgentBrowserProfile,
} from "@openbot/contracts/ipc";
import { router, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import Check from "lucide-react-native/icons/check";
import Plus from "lucide-react-native/icons/plus";
import { useState } from "react";
import { View } from "react-native";
import { useCSSVariable } from "uniwind";
import { BrowserProfileDot } from "@/features/servers/components/browser-profile-dot";
import { TrailingValue } from "@/features/servers/components/trailing-value";
import { openBrowserProfilePage, openBrowserProfilesPage } from "@/features/servers/model/browser-profile-pages";
import { useAgentBrowserProfile, useServerBrowserProfiles } from "@/features/servers/model/use-server-browser-profiles";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import type { MobileAgent } from "@/features/workspace/context/mobile-workspace-context";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

/** The name of a choice. A profile that the list does not hold any more is "Deleted profile". */
function useChoiceLabel() {
  const { t } = useText();
  return (choice: AgentBrowserProfile, profiles: readonly BrowserProfileSummary[] | undefined) => {
    if (choice.kind === "shared") return t("mobile.agent.browserProfile.shared");
    if (choice.kind === "agent") return t("mobile.agent.browserProfile.own");
    return (
      profiles?.find((profile) => profile.id === choice.profileId)?.name ?? t("mobile.agent.browserProfile.missing")
    );
  };
}

/**
 * Agent info > Advanced > Browser profile: the profile of the agent's browser tabs, for an owner or
 * admin of a host that serves `browser-profiles-v1`. The value follows a change made on any device.
 */
export function AgentBrowserProfileRow({ agent }: { agent: MobileAgent }) {
  const { t } = useText();
  const label = useChoiceLabel();
  const { available, query } = useAgentBrowserProfile(agent.serverId, agent.id);
  const { profiles } = useServerBrowserProfiles(agent.serverId);
  if (!available) return null;
  const choice = query.data;
  return (
    <SettingsSection footer={t("mobile.agent.browserProfile.footer")}>
      <SettingsRow
        trailing={choice ? <TrailingValue value={label(choice, profiles)} /> : undefined}
        onPress={() =>
          router.push({
            pathname: "/agent-info/[agentId]/browser-profile",
            params: { agentId: agent.id, serverId: agent.serverId },
          })
        }
      >
        <Typography.Paragraph>{t("mobile.agent.browserProfile.label")}</Typography.Paragraph>
      </SettingsRow>
    </SettingsSection>
  );
}

/**
 * Agent info > Advanced > Browser profile: Shared, each named profile with its color, and the
 * agent's own session while the agent still uses it (desktop no longer offers it). A choice saves at
 * once; the host closes the agent's open tabs. "New profile" makes a profile and gives it to the
 * agent, and "Manage profiles" opens the list of the host.
 */
export function AgentBrowserProfileScreen() {
  const { t, errorMessage } = useText();
  const accent = String(useCSSVariable("--openbot-accent"));
  const label = useChoiceLabel();
  const { agentId, serverId } = useLocalSearchParams<{ agentId: string; serverId: string }>();
  const agentProfile = useAgentBrowserProfile(serverId, agentId);
  const list = useServerBrowserProfiles(serverId);
  const [pending, setPending] = useState<AgentBrowserProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = agentProfile.query.data;
  const profiles = list.profiles;
  if (!agentProfile.available || !current || !profiles)
    return (
      <SettingsContent>
        <SettingsNote>
          {!agentProfile.available
            ? t("mobile.server.browserProfiles.unavailable")
            : agentProfile.query.isError || list.query.isError
              ? errorMessage(
                  agentProfile.query.error ?? list.query.error,
                  t("mobile.server.browserProfiles.loadFailed"),
                )
              : t("mobile.server.browserProfiles.loading")}
        </SettingsNote>
      </SettingsContent>
    );

  function choose(next: AgentBrowserProfile): void {
    if (pending || !current || sameAgentBrowserProfile(next, current)) return;
    void haptics.selection();
    setPending(next);
    setError(null);
    agentProfile
      .choose(next)
      .then(() => {
        void haptics.notification("success");
      })
      .catch((cause: unknown) => {
        void haptics.notification("error");
        setError(errorMessage(cause, t("mobile.agent.browserProfile.saveFailed")));
      })
      .finally(() => setPending(null));
  }

  const choices: AgentBrowserProfile[] = [
    { kind: "shared" },
    ...(current.kind === "agent" ? [current] : []),
    ...profiles.map((profile): AgentBrowserProfile => ({ kind: "profile", profileId: profile.id })),
    // A profile that another device deleted stays until the host moves the agent.
    ...(current.kind === "profile" && !profiles.some((profile) => profile.id === current.profileId) ? [current] : []),
  ];
  const hue = (choice: AgentBrowserProfile) =>
    choice.kind === "shared"
      ? "shared"
      : choice.kind === "agent"
        ? null
        : (profiles.find((profile) => profile.id === choice.profileId)?.hue ?? null);

  return (
    <SettingsContent>
      {error ? (
        <Typography.Paragraph accessibilityRole="alert" type="body-xs" className="px-4 text-danger-text">
          {error}
        </Typography.Paragraph>
      ) : null}
      <SettingsSection footer={t("mobile.agent.browserProfile.footer")}>
        {choices.map((choice) => {
          const selected = sameAgentBrowserProfile(choice, current);
          return (
            <SettingsRow
              key={choice.kind === "profile" ? choice.profileId : choice.kind}
              checked={selected}
              disabled={pending !== null}
              disclosure={false}
              leading={<BrowserProfileDot hue={hue(choice)} />}
              trailing={selected ? <Check size={18} color={accent} strokeWidth={2} /> : null}
              onPress={() => choose(choice)}
            >
              <Typography.Paragraph numberOfLines={1}>{label(choice, profiles)}</Typography.Paragraph>
            </SettingsRow>
          );
        })}
      </SettingsSection>
      <SettingsSection>
        {profiles.length < BROWSER_PROFILE_LIMIT ? (
          <SettingsRow
            disclosure={false}
            disabled={pending !== null}
            leading={
              <View className="size-3 items-center justify-center">
                <Plus size={16} color={accent} strokeWidth={2} />
              </View>
            }
            onPress={() => openBrowserProfilePage({ kind: "agent", agentId }, serverId, { assignTo: agentId })}
          >
            <Typography.Paragraph className="text-accent">{t("mobile.agent.browserProfile.new")}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
        <SettingsRow onPress={() => openBrowserProfilesPage({ kind: "agent", agentId }, serverId)}>
          <Typography.Paragraph>{t("mobile.agent.browserProfile.manage")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
    </SettingsContent>
  );
}
