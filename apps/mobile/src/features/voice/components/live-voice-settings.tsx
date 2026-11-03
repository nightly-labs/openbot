import { canAdministerServer, type RealtimeVoiceStatus, realtimeVoiceChoices } from "@openbot/contracts/ipc";
import { useFocusEffect } from "expo-router";
import { Typography } from "heroui-native";
import { useCallback, useRef, useState } from "react";
import { useUniwind } from "uniwind";
import { SettingsNote, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsPicker, SettingsSwitch } from "@/features/settings/components/settings-controls";
import { useMobileWorkspaceActions, useMobileWorkspaceSelector } from "@/features/workspace/context/workspace-store";
import { showsOnline } from "@/features/workspace/model/server-status";
import { useText } from "@/shared/lib/text";
import { nativeRealtimeVoiceAvailable } from "../model/realtime-voice";

/** Live calls belong to the selected host; dictation and reply playback belong to this phone. */
export function LiveVoiceSettings() {
  const { t } = useText();
  const { theme } = useUniwind();
  const server = useMobileWorkspaceSelector((workspace) => workspace.activeServer);
  const actions = useMobileWorkspaceActions();
  const [status, setStatus] = useState<RealtimeVoiceStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const generation = useRef(0);
  const online = showsOnline(server);
  useFocusEffect(
    useCallback(() => {
      const own = ++generation.current;
      setStatus(null);
      setSaving(false);
      setError(false);
      if (online)
        void actions
          .realtimeVoiceStatus(server.id)
          .then((next) => {
            if (own === generation.current) setStatus(next);
          })
          .catch(() => {
            if (own === generation.current) setError(true);
          });
      return () => {
        generation.current += 1;
      };
    }, [actions, online, server.id]),
  );

  const change = async (save: () => Promise<RealtimeVoiceStatus>) => {
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
  const admin = canAdministerServer(server.role);
  const selection = actions.supportsRealtimeVoiceSelection(server.id);
  const disabled =
    !online ||
    !status ||
    saving ||
    !admin ||
    !actions.supportsRealtimeVoice(server.id) ||
    !nativeRealtimeVoiceAvailable();
  return (
    <SettingsSection
      title={t("mobile.settings.voice.live.title")}
      footer={t("mobile.settings.voice.live.footer", { server: server.name })}
    >
      <SettingsRow>
        <SettingsSwitch
          label={t("mobile.settings.voice.live.enabled")}
          value={status?.enabled ?? false}
          disabled={disabled}
          dark={theme === "dark"}
          onValueChange={(enabled) => void change(() => actions.setRealtimeVoiceEnabled(server.id, enabled))}
        />
      </SettingsRow>
      {status ? (
        <SettingsRow
          trailing={
            <SettingsPicker
              label={t("mobile.settings.voice.voice")}
              value={status.voice}
              options={[...new Set([status.voice, ...realtimeVoiceChoices(status.model)])].map((voice) => ({
                value: voice,
                label: voice.charAt(0).toUpperCase() + voice.slice(1),
              }))}
              enabled={!disabled && selection}
              dark={theme === "dark"}
              onChange={(voice) => void change(() => actions.selectRealtimeVoice(server.id, voice))}
            />
          }
        >
          <Typography.Paragraph>{t("mobile.settings.voice.voice")}</Typography.Paragraph>
        </SettingsRow>
      ) : null}
      {!admin ? <SettingsNote>{t("mobile.settings.voice.live.admin")}</SettingsNote> : null}
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
