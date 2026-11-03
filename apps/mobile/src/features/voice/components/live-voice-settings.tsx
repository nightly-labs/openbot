import { type RealtimeVoiceSettings, realtimeVoiceChoices } from "@openbot/contracts/ipc";
import { useFocusEffect } from "expo-router";
import { Typography } from "heroui-native";
import { useCallback, useRef, useState } from "react";
import { useUniwind } from "uniwind";
import { SettingsNote, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsPicker, SettingsSwitch } from "@/features/settings/components/settings-controls";
import { useMobileWorkspaceActions, useMobileWorkspaceSelector } from "@/features/workspace/context/workspace-store";
import { showsOnline } from "@/features/workspace/model/server-status";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { useText } from "@/shared/lib/text";
import { nativeRealtimeVoiceAvailable } from "../model/realtime-voice";

/** Live calls belong to the selected host; dictation and reply playback belong to this phone. */
export function LiveVoiceSettings({ agent }: { agent?: MobileAgent }) {
  const { t } = useText();
  const { theme } = useUniwind();
  const server = useMobileWorkspaceSelector((workspace) =>
    agent ? workspace.servers.find((server) => server.id === agent.serverId) : workspace.activeServer,
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
  if (!server || !status?.configured) return null;
  const selection = actions.supportsRealtimeVoiceSelection(server.id);
  const disabled =
    !online ||
    !status ||
    saving ||
    !status.canManage ||
    !actions.supportsRealtimeVoice(server.id) ||
    !nativeRealtimeVoiceAvailable();
  return (
    <SettingsSection
      title={t("mobile.settings.voice.live.title")}
      footer={
        agent
          ? t("mobile.settings.voice.live.agentFooter")
          : t("mobile.settings.voice.live.footer", { server: server.name })
      }
    >
      {!agent ? (
        <SettingsRow>
          <SettingsSwitch
            label={t("mobile.settings.voice.live.enabled")}
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
      {!status.canManage && !agent ? <SettingsNote>{t("mobile.settings.voice.live.admin")}</SettingsNote> : null}
      {status && !selection ? <SettingsNote>{t("mobile.settings.voice.live.update")}</SettingsNote> : null}
      {!nativeRealtimeVoiceAvailable() ? (
        <SettingsNote>{t("mobile.settings.voice.live.nativeRequired")}</SettingsNote>
      ) : null}
      {!online ? <SettingsNote>{t("mobile.settings.voice.live.offline")}</SettingsNote> : null}
      {error ? (
        <Typography.Paragraph accessibilityRole="alert" className="px-4 text-danger-text">
          {t("mobile.settings.saveFailed")}
        </Typography.Paragraph>
      ) : null}
    </SettingsSection>
  );
}
