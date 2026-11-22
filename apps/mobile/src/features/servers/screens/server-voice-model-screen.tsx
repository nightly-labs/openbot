import type { HostVoiceModelChange, LocalVoiceModelInfo } from "@openbot/contracts/ipc";
import { useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import Check from "lucide-react-native/icons/check";
import { useState } from "react";
import { useCSSVariable } from "uniwind";
import { serverVoiceModels, useServerVoiceModel } from "@/features/servers/model/use-server-voice-model";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

export function ServerVoiceModelScreen() {
  const { t, format, errorMessage } = useText();
  const accent = String(useCSSVariable("--openbot-accent"));
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const { available, query, change } = useServerVoiceModel(serverId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const snapshot = query.data;
  if (!available || !snapshot)
    return (
      <SettingsContent>
        <SettingsNote>
          {!available
            ? t("mobile.server.settings.voiceModelUnsupported")
            : query.isError
              ? errorMessage(query.error, t("mobile.server.settings.voiceModelLoadFailed"))
              : t("mobile.server.settings.voiceModelLoading")}
        </SettingsNote>
      </SettingsContent>
    );
  const models = serverVoiceModels(snapshot);
  const selected = models.find((model) => model.id === snapshot.modelId);
  const status = (model: LocalVoiceModelInfo) => snapshot.models.find((entry) => entry.modelId === model.id);

  function run(next: HostVoiceModelChange) {
    if (pending) return;
    void haptics.selection();
    setPending(true);
    setError(null);
    change(next)
      .catch((cause: unknown) => {
        void haptics.notification("error");
        setError(errorMessage(cause, t("mobile.server.settings.voiceModelSaveFailed")));
      })
      .finally(() => setPending(false));
  }

  const detail = (model: LocalVoiceModelInfo) => {
    const current = status(model);
    if (current?.phase === "ready") return t("mobile.server.settings.voiceModelReady");
    if (current?.phase === "downloading")
      return t("mobile.server.settings.voiceModelDownloading", {
        percent: format.percent((current.progress ?? 0) / 100, { maximumFractionDigits: 0 }),
      });
    if (current?.phase === "error")
      return errorMessage(current.message, t("mobile.server.settings.voiceModelSaveFailed"));
    return t("mobile.server.settings.voiceModelSize", { size: format.fileSize(model.bytes) });
  };

  const action = (model: LocalVoiceModelInfo) => {
    const phase = status(model)?.phase ?? "missing";
    if (phase === "ready") return { action: "remove", label: t("mobile.server.settings.voiceModelRemove") } as const;
    if (phase === "downloading")
      return { action: "cancel", label: t("mobile.server.settings.voiceModelCancel") } as const;
    return { action: "download", label: t("mobile.server.settings.voiceModelDownload") } as const;
  };
  const next = selected ? action(selected) : null;

  return (
    <SettingsContent>
      {error ? (
        <Typography.Paragraph accessibilityRole="alert" type="body-xs" className="px-4 text-danger-text">
          {error}
        </Typography.Paragraph>
      ) : null}
      <SettingsSection footer={t("mobile.server.settings.voiceModelDescription")}>
        {models.map((model) => {
          const chosen = model.id === selected?.id;
          return (
            <SettingsRow
              key={model.id}
              checked={chosen}
              disabled={pending}
              disclosure={false}
              supportingText={detail(model)}
              trailing={chosen ? <Check size={18} color={accent} strokeWidth={2} /> : null}
              onPress={() => {
                if (!chosen) run({ action: "select", modelId: model.id });
              }}
            >
              <Typography.Paragraph numberOfLines={1}>{model.name}</Typography.Paragraph>
            </SettingsRow>
          );
        })}
      </SettingsSection>
      {selected && next ? (
        <SettingsSection>
          <SettingsRow
            disabled={pending}
            disclosure={false}
            onPress={() => run({ action: next.action, modelId: selected.id })}
          >
            <Typography.Paragraph className={next.action === "remove" ? "text-danger-text" : "text-accent"}>
              {next.label}
            </Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : null}
    </SettingsContent>
  );
}
