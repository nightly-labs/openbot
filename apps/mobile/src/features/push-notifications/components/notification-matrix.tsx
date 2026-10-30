import {
  type AgentNotificationLevelsSnapshot,
  agentNotificationLevelMap,
  type ServerNotificationLevel,
} from "@openbot/contracts/ipc";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { type ReactNode, useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { useLiveActivitiesPreference } from "@/features/settings/model/live-activities";
import {
  effectiveServerLevel,
  loadSyncedNotificationLevels,
  setSyncedNotificationLevels,
  useSyncedNotificationLevels,
} from "@/features/settings/model/notification-levels";
import {
  saveServerNotificationSetting,
  serverNotificationSetting,
  usePushNotificationPreference,
} from "@/features/settings/model/push-notifications";
import { useMobileWorkspace, useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { showsOnline } from "@/features/workspace/model/server-status";
import type { MobileServer } from "@/features/workspace/model/workspace-types";
import { haptics } from "@/shared/lib/haptics";
import { isIOS } from "@/shared/lib/platform";
import { currentText, useText } from "@/shared/lib/text";
import { NotificationLevelSegments, SELECTION_RADIUS } from "./notification-level-segments";
import { ServerMuteRow } from "./server-notification-settings";

/** The row of the whole server. An agent ID cannot be empty, so it cannot be the same. */
const SERVER_ROW = "";

/**
 * What the user hears about: one server at a time, the whole server and each of its agents, and the
 * mute of this phone. On a host that serves `agent-notification-levels-v1`, the host keeps the levels
 * for the user and applies them on all of their devices. An older host has only the level of this
 * phone for the whole server.
 */
export function NotificationMatrix({
  initialServerId,
  highlightAgentId,
}: {
  initialServerId: string | undefined;
  highlightAgentId: string | undefined;
}) {
  const { t } = useText();
  const { servers, activeServer } = useMobileWorkspace();
  const accent = String(useThemeColor("accent"));
  const [chosenId, setChosenId] = useState(initialServerId);
  const server =
    servers.find((candidate) => candidate.id === chosenId) ??
    servers.find((candidate) => candidate.id === activeServer.id) ??
    servers[0];
  if (!server) return null;
  const header = (
    <>
      <Typography type="body-xs" className="px-4 text-grouped-secondary">
        {t("mobile.settings.notifications.whatYouHear")}
      </Typography>
      {servers.length > 1 ? (
        <ScrollView
          horizontal
          accessibilityRole="tablist"
          showsHorizontalScrollIndicator={false}
          className="-mx-4"
          contentContainerClassName="gap-2 px-4 pb-1"
        >
          {servers.map((candidate) => {
            const selected = candidate.id === server.id;
            return (
              <Pressable
                key={candidate.id}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => {
                  if (selected) return;
                  void haptics.selection();
                  setChosenId(candidate.id);
                }}
                className={`min-h-9 justify-center px-3.5 ${selected ? "bg-control-active" : "bg-grouped"}`}
                style={({ pressed }) => ({
                  borderRadius: SELECTION_RADIUS,
                  borderWidth: 1,
                  borderColor: selected ? accent : "transparent",
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Typography.Paragraph type="body-sm" weight={selected ? "semibold" : "normal"} numberOfLines={1}>
                  {candidate.name}
                </Typography.Paragraph>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
    </>
  );
  // A new server starts with no request in progress and no error.
  return (
    <ServerLevels
      key={server.id}
      server={server}
      header={header}
      highlightAgentId={server.id === initialServerId ? highlightAgentId : undefined}
    />
  );
}

function ServerLevels({
  server,
  header,
  highlightAgentId,
}: {
  server: MobileServer;
  /** The title and the server choice, above the rows of the server. */
  header: ReactNode;
  highlightAgentId: string | undefined;
}) {
  const { t } = useText();
  const { agents, canSendNotifications, canSetAgentNotificationLevel } = useMobileWorkspace();
  const { loadAgentNotificationLevels, setAgentNotificationLevel, setOwnServerNotificationLevel, updateAgent } =
    useMobileWorkspaceActions();
  /** The agent whose switch for every member turns on now. */
  const [turningOn, setTurningOn] = useState<string | null>(null);
  const preference = usePushNotificationPreference();
  const liveActivities = useLiveActivitiesPreference();
  const synced = useSyncedNotificationLevels((state) => state.servers[server.id]);
  /** The row that waits for the host, and the level it asked for. A failure shows the saved level again. */
  const [pending, setPending] = useState<{ row: string; level: ServerNotificationLevel | null } | null>(null);
  const [levelError, setLevelError] = useState<string | null>(null);
  const [muteError, setMuteError] = useState<string | null>(null);
  const online = showsOnline(server);
  const keepsLevels = canSetAgentNotificationLevel(server.id);

  // The screen reads the levels again when it opens; the host also sends each change of another device.
  useEffect(() => {
    if (!keepsLevels || !online) return;
    void loadSyncedNotificationLevels(server.id, () => loadAgentNotificationLevels(server.id)).catch(() => undefined);
  }, [keepsLevels, online, server.id, loadAgentNotificationLevels]);

  const serverLevel = effectiveServerLevel(synced, serverNotificationSetting(preference, server.id));
  const agentLevels = synced ? agentNotificationLevelMap(synced) : null;
  // The level and the mute of this phone apply while notifications or the Live Activity are on, as
  // before. Android has no Live Activity.
  const phoneEnabled =
    preference.ready && !preference.saving && (preference.enabled || (isIOS && liveActivities.enabled));
  // The levels that the host keeps apply on the other devices too, so they do not depend on this phone.
  const hostEnabled = keepsLevels && online && synced !== undefined && pending === null;
  const serverAgents = agents.filter((agent) => agent.serverId === server.id);

  async function saveOnHost(
    row: string,
    level: ServerNotificationLevel | null,
    request: () => Promise<AgentNotificationLevelsSnapshot>,
  ): Promise<void> {
    setPending({ row, level });
    try {
      setSyncedNotificationLevels(server.id, await request());
    } catch (cause) {
      void haptics.notification("error");
      const text = currentText();
      showFailureAlert(
        cause,
        "settings",
        text.t("mobile.agent.notifications.failed"),
        text.errorMessage(cause, text.t("mobile.agent.notifications.failedBody")),
      );
    } finally {
      setPending(null);
    }
  }

  /**
   * Turns on an agent that a member turned off for every member, with the agent switch of earlier
   * versions. The host keeps that switch, so this screen is the one place that turns it on again.
   */
  async function turnOn(agentId: string): Promise<void> {
    setTurningOn(agentId);
    try {
      await updateAgent({ agentId, notifications: true }, server.id);
      void haptics.notification("success");
    } catch (cause) {
      void haptics.notification("error");
      const text = currentText();
      showFailureAlert(
        cause,
        "settings",
        text.t("mobile.agent.notifications.failed"),
        text.errorMessage(cause, text.t("mobile.agent.notifications.failedBody")),
      );
    } finally {
      setTurningOn(null);
    }
  }

  function selectServerLevel(level: ServerNotificationLevel): void {
    if (!keepsLevels) {
      setLevelError(null);
      void saveServerNotificationSetting(server.id, { level }).catch(() => {
        setLevelError(t("mobile.settings.saveFailed"));
        void haptics.notification("error");
      });
      return;
    }
    // The level of this phone shows until the user chooses one for all of their devices.
    if (synced?.server === level) return;
    void saveOnHost(SERVER_ROW, level, () => setOwnServerNotificationLevel(level, server.id));
  }

  const wholeServer = t("mobile.settings.notifications.wholeServer");
  const levelsFooter =
    levelError ??
    (keepsLevels
      ? t("mobile.settings.notifications.levelsFooter")
      : online
        ? t("mobile.settings.notifications.agentsUnsupported")
        : t("mobile.settings.notifications.agentsOffline"));
  const muteFooter =
    muteError ??
    (server.state === "online" && !canSendNotifications(server.id)
      ? t("mobile.settings.notifications.serverUnsupported")
      : keepsLevels
        ? t("mobile.settings.notifications.scopeFooter")
        : t("mobile.settings.notifications.serverFooter"));

  return (
    <>
      <View className="gap-2">
        {header}
        <SettingsSection footer={levelsFooter}>
          <SettingsRow
            supportingText={keepsLevels ? undefined : t("mobile.settings.notifications.thisPhoneOnly")}
            trailing={
              <NotificationLevelSegments
                label={wholeServer}
                value={pending?.row === SERVER_ROW ? pending.level : serverLevel}
                disabled={keepsLevels ? !hostEnabled : !phoneEnabled}
                onSelect={selectServerLevel}
              />
            }
          >
            <Typography.Paragraph numberOfLines={1}>{wholeServer}</Typography.Paragraph>
          </SettingsRow>
          {keepsLevels
            ? serverAgents.map((agent) => {
                // The switch of the agent is off for every member, so no level of the user applies.
                const sharedOff = agent.notifications === false;
                const own = pending?.row === agent.id ? pending.level : (agentLevels?.get(agent.id) ?? null);
                return (
                  <View key={agent.id} className={agent.id === highlightAgentId ? "bg-control" : undefined}>
                    <SettingsRow
                      // Only the short title: a note that comes and goes would change the height of the row.
                      supportingText={agent.title || undefined}
                      trailing={
                        sharedOff ? (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={t("mobile.settings.notifications.turnOnFor", { name: agent.name })}
                            accessibilityHint={t("mobile.settings.notifications.offForEveryone")}
                            disabled={!online || turningOn !== null}
                            hitSlop={8}
                            onPress={() => void turnOn(agent.id)}
                            style={({ pressed }) => ({
                              opacity: !online || turningOn !== null ? 0.45 : pressed ? 0.6 : 1,
                            })}
                          >
                            <Typography.Paragraph type="body-sm" className="text-accent">
                              {t("mobile.settings.notifications.turnOn")}
                            </Typography.Paragraph>
                          </Pressable>
                        ) : (
                          <NotificationLevelSegments
                            label={agent.name}
                            value={own}
                            inherited={serverLevel}
                            // "Nothing" for the server silences each agent, whatever its own level.
                            disabled={!hostEnabled || serverLevel === "nothing"}
                            onSelect={(level) => {
                              // A tap on the agent's own level gives the agent back to the server level.
                              const next = own === level ? null : level;
                              void saveOnHost(agent.id, next, () =>
                                setAgentNotificationLevel({ agentId: agent.id, level: next }, server.id),
                              );
                            }}
                          />
                        )
                      }
                    >
                      <Typography.Paragraph numberOfLines={1}>{agent.name}</Typography.Paragraph>
                    </SettingsRow>
                  </View>
                );
              })
            : null}
        </SettingsSection>
      </View>
      <SettingsSection footer={muteFooter}>
        <ServerMuteRow serverId={server.id} enabled={phoneEnabled} onError={setMuteError} />
      </SettingsSection>
    </>
  );
}
