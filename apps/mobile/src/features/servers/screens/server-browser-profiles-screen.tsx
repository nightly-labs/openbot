import { BROWSER_PROFILE_LIMIT } from "@openbot/contracts/ipc";
import { useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { BrowserProfileDot } from "@/features/servers/components/browser-profile-dot";
import { HeaderAddAction } from "@/features/servers/components/header-add-action";
import { type BrowserProfileStack, openBrowserProfilePage } from "@/features/servers/model/browser-profile-pages";
import { useServerBrowserProfiles } from "@/features/servers/model/use-server-browser-profiles";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { useText } from "@/shared/lib/text";

/** "2 agents · 1 open tab": who uses a profile and what is open in it. */
export function useBrowserProfileUsage() {
  const { t } = useText();
  return (agentCount: number, tabCount?: number) => {
    const agents = t("mobile.server.browserProfiles.agents", { count: agentCount });
    return tabCount
      ? t("mobile.server.browserProfiles.usage", {
          agents,
          tabs: t("mobile.server.browserProfiles.tabs", { count: tabCount }),
        })
      : agents;
  };
}

/**
 * Server settings > Browser profiles of a joined server (`browser-profiles-v1`): the shared profile,
 * then each named profile with its color, agents and open tabs. The header "+" adds a profile, and a
 * profile opens its page. A change made on the desktop or another device shows at once.
 */
export function ServerBrowserProfilesScreen() {
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  return <BrowserProfilesList serverId={serverId} stack={{ kind: "server" }} />;
}

/** The same list, opened from the profile choice of one agent. */
export function AgentBrowserProfilesScreen() {
  const { serverId, agentId } = useLocalSearchParams<{ serverId: string; agentId: string }>();
  return <BrowserProfilesList serverId={serverId} stack={{ kind: "agent", agentId }} />;
}

function BrowserProfilesList({ serverId, stack }: { serverId: string; stack: BrowserProfileStack }) {
  const { t, errorMessage } = useText();
  const usage = useBrowserProfileUsage();
  const { available, query, profiles, sharedAgentIds } = useServerBrowserProfiles(serverId);
  if (!available || !profiles || !sharedAgentIds)
    return (
      <SettingsContent>
        <SettingsNote>
          {!available
            ? t("mobile.server.browserProfiles.unavailable")
            : query.isError
              ? errorMessage(query.error, t("mobile.server.browserProfiles.loadFailed"))
              : t("mobile.server.browserProfiles.loading")}
        </SettingsNote>
        {available && query.isError ? (
          <SettingsSection>
            <SettingsRow disclosure={false} disabled={query.isFetching} onPress={() => void query.refetch()}>
              <Typography.Paragraph className="text-accent">{t("mobile.server.members.retry")}</Typography.Paragraph>
            </SettingsRow>
          </SettingsSection>
        ) : null}
      </SettingsContent>
    );
  const full = profiles.length >= BROWSER_PROFILE_LIMIT;
  return (
    <SettingsContent>
      {full ? null : (
        <HeaderAddAction
          label={t("mobile.server.browserProfiles.add")}
          onPress={() => openBrowserProfilePage(stack, serverId)}
        />
      )}
      <SettingsNote>{t("mobile.server.browserProfiles.description")}</SettingsNote>
      <SettingsSection footer={t("mobile.server.browserProfiles.sharedHint")}>
        <SettingsRow
          disclosure={false}
          leading={<BrowserProfileDot hue="shared" />}
          supportingText={usage(sharedAgentIds.length)}
        >
          <Typography.Paragraph>{t("mobile.server.browserProfiles.shared")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection
        title={t("mobile.server.browserProfiles.title")}
        footer={full ? t("mobile.server.browserProfiles.limit", { limit: BROWSER_PROFILE_LIMIT }) : undefined}
      >
        {profiles.length === 0 ? (
          <SettingsRow disclosure={false} onPress={() => openBrowserProfilePage(stack, serverId)}>
            <Typography.Paragraph className="text-accent">
              {t("mobile.server.browserProfiles.add")}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {profiles.map((profile) => (
          <SettingsRow
            key={profile.id}
            leading={<BrowserProfileDot hue={profile.hue} />}
            supportingText={usage(profile.agentIds.length, profile.tabCount)}
            onPress={() => openBrowserProfilePage(stack, serverId, { profileId: profile.id })}
          >
            <Typography.Paragraph numberOfLines={1}>{profile.name}</Typography.Paragraph>
          </SettingsRow>
        ))}
      </SettingsSection>
    </SettingsContent>
  );
}
