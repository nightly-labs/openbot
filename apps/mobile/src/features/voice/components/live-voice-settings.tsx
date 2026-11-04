import { type RealtimeVoiceSettings, realtimeVoiceChoices } from "@openbot/contracts/ipc";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useCallback, useRef, useState } from "react";
import { useUniwind } from "uniwind";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { SettingsNote, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsPicker, SettingsSwitch } from "@/features/settings/components/settings-controls";
import { useMobileWorkspaceActions, useMobileWorkspaceSelector } from "@/features/workspace/context/workspace-store";
import { showsOnline } from "@/features/workspace/model/server-status";
import type { MobileAgent, MobileServer } from "@/features/workspace/model/workspace-types";
import { useText } from "@/shared/lib/text";
import { nativeRealtimeVoiceAvailable } from "../model/realtime-voice";
import { saveVoiceSettings, useVoiceSettings } from "../model/voice-settings";

/** Personal consent stays on this phone. Host defaults are edited only in Server settings. */
export function LiveVoiceSettings({
  agent,
  host,
  providerNotice = false,
}: {
  agent?: MobileAgent;
  host?: MobileServer;
  providerNotice?: boolean;
}) {
  const params = useLocalSearchParams<{ serverId?: string }>();
  const { session } = useMobileSession();
  const preferences = useVoiceSettings();
  const owner = session ? `${session.apiUrl}\n${session.user.id}` : null;
  const { t } = useText();
  const { theme } = useUniwind();
  const server = useMobileWorkspaceSelector(
    (workspace) =>
      host ??
      (agent || params.serverId
        ? workspace.servers.find((server) => server.id === (agent?.serverId ?? params.serverId))
        : workspace.activeServer),
  );
  const actions = useMobileWorkspaceActions();
  const [status, setStatus] = useState<RealtimeVoiceSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const generation = useRef(0);
  const online = showsOnline(server);
  const serverId = agent?.serverId ?? server?.id;
  useFocusEffect(
    useCallback(() => {
      const own = ++generation.current;
      setStatus(null);
      setSaving(false);
      setError(false);
      if (online && serverId)
        void actions
          .realtimeVoiceSettings({ agentId: agent?.id ?? null }, serverId)
          .then((next) => {
            if (own === generation.current) setStatus(next);
          })
          .catch(() => {
            if (own === generation.current) setError(true);
          });
      return () => {
        generation.current += 1;
      };
    }, [actions, online, serverId, agent?.id]),
  );

  const change = async (save: () => Promise<RealtimeVoiceSettings>) => {
    const own = generation.current;
    setSaving(true);
    setError(false);
    try {
      const next = await save();
      if (own === generation.current) setStatus(next);
    } catch {
      if (own === generation.current) setError(true);
    } finally {
      if (own === generation.current) setSaving(false);
    }
  };
  const optedIn = Boolean(owner && preferences.liveVoiceAccounts[owner]);

  const readiness = !server
    ? "mobile.settings.voice.live.noServer"
    : !online
      ? "mobile.settings.voice.live.offline"
      : !actions.supportsRealtimeVoice(server.id)
        ? "mobile.settings.voice.live.unsupported"
        : error && !status
          ? "mobile.settings.voice.live.loadFailed"
          : !status
            ? "mobile.settings.voice.live.checking"
            : !status.configured
              ? "mobile.settings.voice.live.requirements"
              : !status.enabled
                ? "mobile.settings.voice.live.hostOff"
                : "mobile.settings.voice.live.ready";
  if (providerNotice)
    return (
      <SettingsSection
        title={t("mobile.settings.voice.live.title")}
        footer={t("mobile.settings.voice.live.subscription")}
      >
        <SettingsNote>{t(readiness, { server: server?.name ?? "" })}</SettingsNote>
        <SettingsRow onPress={() => router.push({ pathname: "/settings/voice", params: { serverId } })}>
          <Typography.Paragraph>{t("mobile.settings.voice.live.setupLink")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
    );

  if ((agent || host) && (!server || (host && server.role !== "owner" && server.role !== "admin"))) return null;
  if (!agent && !host)
    return (
      <SettingsSection
        title={t("mobile.settings.voice.live.title")}
        footer={t("mobile.settings.voice.live.deviceDescription")}
      >
        <SettingsRow>
          <SettingsSwitch
            label={t("mobile.settings.voice.live.deviceEnabled")}
            value={optedIn}
            disabled={
              !owner ||
              !preferences.ready ||
              (!optedIn && (!online || !status?.configured || !status.enabled || !nativeRealtimeVoiceAvailable()))
            }
            dark={theme === "dark"}
            onValueChange={(enabled) => {
              if (owner)
                void saveVoiceSettings({
                  liveVoiceAccounts: { ...preferences.liveVoiceAccounts, [owner]: enabled },
                }).catch(() => setError(true));
            }}
          />
        </SettingsRow>
        <SettingsNote>
          {t(!nativeRealtimeVoiceAvailable() ? "mobile.settings.voice.live.nativeMissing" : readiness, {
            server: server?.name ?? "",
          })}
        </SettingsNote>
        {server && (server.role === "owner" || server.role === "admin") ? (
          <>
            <SettingsRow
              onPress={() =>
                router.push({
                  pathname: "/server-settings/provider",
                  params: { serverId: server.id, provider: "codex" },
                })
              }
            >
              <Typography.Paragraph>{t("mobile.settings.voice.live.providersLink")}</Typography.Paragraph>
            </SettingsRow>
            <SettingsRow
              onPress={() => router.push({ pathname: "/server-settings/general", params: { serverId: server.id } })}
            >
              <Typography.Paragraph>{t("mobile.settings.voice.live.serverLink")}</Typography.Paragraph>
            </SettingsRow>
          </>
        ) : (
          <SettingsNote>{t("mobile.settings.voice.live.adminHelp")}</SettingsNote>
        )}
        <SettingsNote>{t("mobile.settings.voice.live.agentHelp")}</SettingsNote>
        {error ? <SettingsNote>{t("mobile.settings.saveFailed")}</SettingsNote> : null}
      </SettingsSection>
    );
  if (!server) return null;
  const selection = actions.supportsRealtimeVoiceSelection(server.id);
  const disabled =
    !online ||
    !status ||
    saving ||
    !status?.canManage ||
    !status.configured ||
    !actions.supportsRealtimeVoice(server.id);
  return (
    <SettingsSection
      title={t("mobile.settings.voice.live.title")}
      footer={
        agent
          ? t("mobile.settings.voice.live.agentFooter")
          : t(
              status?.configured
                ? "mobile.settings.voice.live.serverDescription"
                : "mobile.settings.voice.live.requirements",
              { server: server.name },
            )
      }
    >
      {!agent ? (
        <SettingsRow>
          <SettingsSwitch
            label={t("mobile.settings.voice.live.serverEnabled")}
            value={status?.enabled ?? false}
            disabled={disabled}
            dark={theme === "dark"}
            onValueChange={(enabled) =>
              void change(async () => {
                await actions.setRealtimeVoiceEnabled(server.id, enabled);
                return actions.realtimeVoiceSettings({ agentId: null }, server.id);
              })
            }
          />
        </SettingsRow>
      ) : null}
      {status ? (
        <SettingsRow
          trailing={
            <SettingsPicker
              label={t("mobile.settings.voice.voice")}
              value={agent ? (status.voice ?? "default") : status.defaultVoice}
              options={[
                ...(agent
                  ? [
                      {
                        value: "default",
                        label: t("mobile.settings.voice.live.useDefault", {
                          voice: status.defaultVoice.charAt(0).toUpperCase() + status.defaultVoice.slice(1),
                        }),
                      },
                    ]
                  : []),
                ...[...new Set([status.defaultVoice, ...realtimeVoiceChoices(status.model)])].map((voice) => ({
                  value: voice,
                  label: voice.charAt(0).toUpperCase() + voice.slice(1),
                })),
              ]}
              enabled={!disabled && selection}
              dark={theme === "dark"}
              onChange={(voice) =>
                void change(() =>
                  actions.setRealtimeVoiceSelection(
                    { agentId: agent?.id ?? null, voice: voice === "default" ? null : voice },
                    server.id,
                  ),
                )
              }
            />
          }
        >
          <Typography.Paragraph>
            {t(agent ? "mobile.settings.voice.voice" : "mobile.settings.voice.live.defaultVoice")}
          </Typography.Paragraph>
        </SettingsRow>
      ) : null}
      {status && !selection ? <SettingsNote>{t("mobile.settings.voice.live.update")}</SettingsNote> : null}
      <SettingsRow onPress={() => router.push({ pathname: "/settings/voice", params: { serverId } })}>
        <Typography.Paragraph>{t("mobile.settings.voice.live.setupLink")}</Typography.Paragraph>
      </SettingsRow>
      {!online ? <SettingsNote>{t("mobile.settings.voice.live.offline")}</SettingsNote> : null}
      {error ? (
        <Typography.Paragraph accessibilityRole="alert" className="px-4 text-danger-text">
          {t("mobile.settings.saveFailed")}
        </Typography.Paragraph>
      ) : null}
    </SettingsSection>
  );
}
