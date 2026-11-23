import {
  type AgentNotificationLevelsSnapshot,
  agentNotificationLevelMap,
  type ServerNotificationLevel,
} from "@openbot/contracts/ipc";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Plus from "lucide-react-native/icons/plus";
import { type PropsWithChildren, type ReactNode, useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
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
import type { MobileAgent, MobileServer } from "@/features/workspace/model/workspace-types";
import { MenuView } from "@/shared/components/menu-view";
import { haptics } from "@/shared/lib/haptics";
import { useReducedMotion } from "@/shared/lib/motion";
import { isIOS } from "@/shared/lib/platform";
import { currentText, useText } from "@/shared/lib/text";
import { NotificationLevelSegments, SELECTION_RADIUS } from "./notification-level-segments";
import { ServerMuteRow } from "./server-notification-settings";

const SERVER_ROW = "";

const AVATAR_SIZE = 32;

const OPEN_MS = 260;
const CLOSE_MS = 200;
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const EASE_CLOSE = Easing.bezier(0.32, 0.08, 0.24, 1);

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
  header: ReactNode;
  highlightAgentId: string | undefined;
}) {
  const { t } = useText();
  const { agents, canSendNotifications, canSetAgentNotificationLevel } = useMobileWorkspace();
  const { loadAgentNotificationLevels, setAgentNotificationLevel, setOwnServerNotificationLevel, updateAgent } =
    useMobileWorkspaceActions();
  const [turningOn, setTurningOn] = useState<string | null>(null);
  const preference = usePushNotificationPreference();
  const liveActivities = useLiveActivitiesPreference();
  const synced = useSyncedNotificationLevels((state) => state.servers[server.id]);
  const [pending, setPending] = useState<{ row: string; level: ServerNotificationLevel | null } | null>(null);
  const [levelError, setLevelError] = useState<string | null>(null);
  const [muteError, setMuteError] = useState<string | null>(null);
  const online = showsOnline(server);
  const keepsLevels = canSetAgentNotificationLevel(server.id);

  useEffect(() => {
    if (!keepsLevels || !online) return;
    void loadSyncedNotificationLevels(server.id, () => loadAgentNotificationLevels(server.id)).catch(() => undefined);
  }, [keepsLevels, online, server.id, loadAgentNotificationLevels]);

  const serverLevel = effectiveServerLevel(synced, serverNotificationSetting(preference, server.id));
  const agentLevels = synced ? agentNotificationLevelMap(synced) : null;
  const phoneEnabled =
    preference.ready && !preference.saving && (preference.enabled || (isIOS && liveActivities.enabled));
  const hostEnabled = keepsLevels && online && synced !== undefined && pending === null;
  const serverAgents = agents.filter((agent) => agent.serverId === server.id);
  const [highlightShown, setHighlightShown] = useState(highlightAgentId);
  const isShown = (agent: MobileAgent) => {
    if (agent.notifications === false) return true;
    if (pending?.row === agent.id) return pending.level !== null;
    return agent.id === highlightShown || agentLevels?.has(agent.id) === true;
  };
  const shownAgents = serverAgents.filter(isShown);
  const hiddenAgents = serverAgents.filter((agent) => !isShown(agent));

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
          <View>
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
                  const sharedOff = agent.notifications === false;
                  const own = pending?.row === agent.id ? pending.level : (agentLevels?.get(agent.id) ?? null);
                  return (
                    <CollapsingRow key={agent.id} open={isShown(agent)}>
                      <View className={agent.id === highlightShown ? "bg-control" : undefined}>
                        <SettingsRow
                          leading={
                            <BloubAvatar
                              agentId={agent.id}
                              serverId={agent.serverId}
                              hue={agent.avatarHue}
                              color={agent.avatarColor}
                              seed={agent.avatarSeed}
                              size={AVATAR_SIZE}
                              animateIdle={false}
                            />
                          }
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
                                disabled={!hostEnabled || serverLevel === "nothing"}
                                onSelect={(level) => {
                                  const next = own === level ? null : level;
                                  if (next === null && agent.id === highlightShown) setHighlightShown(undefined);
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
                    </CollapsingRow>
                  );
                })
              : null}
            {keepsLevels ? (
              <CollapsingRow
                open={online && synced !== undefined && serverLevel !== "nothing" && hiddenAgents.length > 0}
              >
                <ChooseAgentMenu
                  agents={hiddenAgents}
                  another={shownAgents.length > 0}
                  disabled={!hostEnabled}
                  onChoose={(agentId) => {
                    if (!hostEnabled) return;
                    void haptics.selection();
                    const level = firstOtherLevel(serverLevel);
                    void saveOnHost(agentId, level, () => setAgentNotificationLevel({ agentId, level }, server.id));
                  }}
                />
              </CollapsingRow>
            ) : null}
          </View>
        </SettingsSection>
      </View>
      <SettingsSection footer={muteFooter}>
        <ServerMuteRow serverId={server.id} enabled={phoneEnabled} onError={setMuteError} />
      </SettingsSection>
    </>
  );
}

function CollapsingRow({ open, children }: PropsWithChildren<{ open: boolean }>) {
  const [closed, setClosed] = useState(!open);
  const onClosed = useCallback(() => setClosed(true), []);
  if (open && closed) setClosed(false);
  if (!open && closed) return null;
  return (
    <CollapsingBody open={open} onClosed={onClosed}>
      {children}
    </CollapsingBody>
  );
}

function CollapsingBody({ open, onClosed, children }: PropsWithChildren<{ open: boolean; onClosed: () => void }>) {
  const reducedMotion = useReducedMotion();
  const openness = useSharedValue(1);
  const contentHeight = useSharedValue(-1);
  useEffect(() => {
    openness.set(
      withTiming(
        open ? 1 : 0,
        { duration: reducedMotion ? 0 : open ? OPEN_MS : CLOSE_MS, easing: open ? EASE_OUT : EASE_CLOSE },
        (finished) => {
          if (finished && !open) scheduleOnRN(onClosed);
        },
      ),
    );
  }, [open, openness, reducedMotion, onClosed]);
  const style = useAnimatedStyle(() => {
    const height = contentHeight.get();
    const progress = openness.get();
    return height < 0 ? {} : { height: height * progress, opacity: progress };
  });
  return (
    <Animated.View
      style={[{ overflow: "hidden" }, style]}
      pointerEvents={open ? "auto" : "none"}
      accessibilityElementsHidden={!open}
      importantForAccessibility={open ? "auto" : "no-hide-descendants"}
    >
      <View onLayout={(event) => contentHeight.set(event.nativeEvent.layout.height)}>
        <View className="ml-4 h-px bg-grouped-border" />
        {children}
      </View>
    </Animated.View>
  );
}

function firstOtherLevel(level: ServerNotificationLevel): ServerNotificationLevel {
  return level === "all" ? "needs-me" : "all";
}

function ChooseAgentMenu({
  agents,
  another,
  disabled,
  onChoose,
}: {
  agents: readonly MobileAgent[];
  another: boolean;
  disabled: boolean;
  onChoose: (agentId: string) => void;
}) {
  const { t } = useText();
  const accent = String(useThemeColor("accent"));
  const label = another
    ? t("mobile.settings.notifications.chooseAnotherAgent")
    : t("mobile.settings.notifications.chooseAgent");
  return (
    <MenuView
      actions={agents.map((agent) => ({ id: agent.id, title: agent.name, attributes: { disabled } }))}
      onPressAction={({ nativeEvent }) => {
        const agentId = nativeEvent.event;
        if (agents.some((agent) => agent.id === agentId)) onChoose(agentId);
      }}
      style={{ alignSelf: "flex-start", maxWidth: "100%" }}
    >
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        className="min-h-12 min-w-0 shrink flex-row items-center gap-3 px-4 py-3"
        style={{ opacity: disabled ? 0.45 : 1 }}
      >
        <View className="items-center justify-center" style={{ width: AVATAR_SIZE, height: AVATAR_SIZE }}>
          <Plus size={20} color={accent} />
        </View>
        <Typography.Paragraph numberOfLines={1} className="min-w-0 shrink text-accent">
          {label}
        </Typography.Paragraph>
      </View>
    </MenuView>
  );
}
