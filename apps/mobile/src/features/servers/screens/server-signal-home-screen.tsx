import type { HostSignalHome } from "@openbot/contracts/ipc";
import { useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import Check from "lucide-react-native/icons/check";
import { useState } from "react";
import { useCSSVariable } from "uniwind";
import {
  SIGNAL_LATENCY_TEXT_CLASS,
  signalHomePlaceKey,
  signalLatencyTone,
  useServerSignalHome,
} from "@/features/servers/model/use-server-signal-home";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

export function ServerSignalHomeScreen() {
  const { t, errorMessage, format } = useText();
  const accent = String(useCSSVariable("--openbot-accent"));
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const { available, query, save } = useServerSignalHome(serverId);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const settings = query.data;
  if (!available || !settings)
    return (
      <SettingsContent>
        <SettingsNote>
          {!available
            ? t("mobile.server.settings.signalHomeUnavailable")
            : query.isError
              ? errorMessage(query.error, t("mobile.server.settings.signalHomeLoadFailed"))
              : t("mobile.server.settings.signalHomeLoading")}
        </SettingsNote>
      </SettingsContent>
    );

  const placeName = (id: string) => {
    const key = signalHomePlaceKey(id);
    return key ? t(key) : id.toUpperCase();
  };
  const latencyText = (home: HostSignalHome) =>
    home.latencyMs === null
      ? t("mobile.server.settings.signalHomeNoAnswer")
      : t("mobile.server.settings.signalHomeLatency", { latency: format.number(home.latencyMs) });
  const moved = settings.preferred !== null && settings.current !== null && settings.preferred !== settings.current;
  const footer = !moved
    ? t("mobile.server.settings.signalHomeDescription")
    : changed
      ? t("mobile.server.settings.signalHomeMoving", { name: placeName(settings.preferred ?? "") })
      : t("mobile.server.settings.signalHomeFallback", {
          chosen: placeName(settings.preferred ?? ""),
          name: placeName(settings.current ?? ""),
        });

  function choose(home: string | null) {
    if (pending !== null || home === settings?.preferred) return;
    void haptics.selection();
    setPending(home ?? "");
    setError(null);
    save(home)
      .then(() => {
        setChanged(true);
        void haptics.notification("success");
      })
      .catch((cause: unknown) => {
        void haptics.notification("error");
        setError(errorMessage(cause, t("mobile.server.settings.signalHomeSaveFailed")));
      })
      .finally(() => setPending(null));
  }

  const row = (home: string | null, label: string, detail: string, detailClass: string) => {
    const selected = home === settings.preferred;
    return (
      <SettingsRow
        key={home ?? ""}
        checked={selected}
        disabled={pending !== null}
        disclosure={false}
        trailing={selected ? <Check size={18} color={accent} strokeWidth={2} /> : null}
        onPress={() => choose(home)}
      >
        <Typography.Paragraph numberOfLines={1}>{label}</Typography.Paragraph>
        <Typography.Paragraph type="body-xs" className={detailClass}>
          {detail}
        </Typography.Paragraph>
      </SettingsRow>
    );
  };

  return (
    <SettingsContent>
      {error ? (
        <Typography.Paragraph accessibilityRole="alert" type="body-xs" className="px-4 text-danger-text">
          {error}
        </Typography.Paragraph>
      ) : null}
      <SettingsSection footer={footer}>
        {row(
          null,
          t("mobile.server.settings.signalHomeAutomatic"),
          settings.preferred === null && settings.current !== null
            ? t("mobile.server.settings.signalHomeInUse", { name: placeName(settings.current) })
            : t("mobile.server.settings.signalHomeNearest"),
          "text-grouped-secondary",
        )}
        {settings.homes.map((home) =>
          row(
            home.id,
            placeName(home.id),
            latencyText(home),
            SIGNAL_LATENCY_TEXT_CLASS[signalLatencyTone(home.latencyMs)],
          ),
        )}
      </SettingsSection>
    </SettingsContent>
  );
}
