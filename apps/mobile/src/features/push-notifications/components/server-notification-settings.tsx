import { SERVER_MUTE_DURATIONS_MS, type ServerNotificationLevel } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { Typography } from "heroui-native";
import { useUniwind } from "uniwind";
import { SettingsRow } from "@/features/settings/components/settings-content";
import { SettingsPicker } from "@/features/settings/components/settings-controls";
import {
  mutedUntil,
  saveServerNotificationSetting,
  serverNotificationSetting,
  usePushNotificationPreference,
} from "@/features/settings/model/push-notifications";
import { haptics } from "@/shared/lib/haptics";
import { currentText, type MobileText, useText } from "@/shared/lib/text";

export const NOTIFICATION_LEVEL_KEYS = {
  all: "mobile.settings.notifications.level.all",
  "needs-me": "mobile.settings.notifications.level.needsMe",
  nothing: "mobile.settings.notifications.level.nothing",
} as const satisfies Record<ServerNotificationLevel, MobileTextKey>;

/** In the order of `SERVER_MUTE_DURATIONS_MS`, which the desktop server menu offers too. */
const MUTE_KEYS = [
  "mobile.settings.notifications.mute.for15Minutes",
  "mobile.settings.notifications.mute.for1Hour",
  "mobile.settings.notifications.mute.for3Hours",
  "mobile.settings.notifications.mute.for8Hours",
  "mobile.settings.notifications.mute.for24Hours",
] as const satisfies readonly MobileTextKey[];

type MuteChoice = "current" | "off" | "forever" | `${number}`;

/** The end of a timed mute: the time today, or the day and the time. */
function muteEnd(until: number, format: MobileText["format"]): string {
  const end = new Date(until);
  return format.date(end, {
    ...(end.toDateString() === new Date().toDateString() ? {} : { weekday: "short" }),
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * The mute of one server on this phone, as the desktop server menu has it. The mute applies to this
 * phone only: the other devices of the user keep their notifications.
 */
export function ServerMuteRow({
  serverId,
  enabled,
  onError,
}: {
  serverId: string;
  enabled: boolean;
  /** The text of a failed save, or `null` when a save starts. */
  onError: (message: string | null) => void;
}) {
  const { t, format } = useText();
  const { theme } = useUniwind();
  const preference = usePushNotificationPreference();
  const until = mutedUntil(serverNotificationSetting(preference, serverId), Date.now());
  const mute: MuteChoice = until === null ? "off" : until === Number.POSITIVE_INFINITY ? "forever" : "current";

  function save(choice: MuteChoice) {
    if (choice === "current") return;
    onError(null);
    void haptics.selection();
    void saveServerNotificationSetting(serverId, {
      mute: choice === "off" ? null : { until: choice === "forever" ? null : Date.now() + Number(choice) },
    }).catch(() => {
      onError(currentText().t("mobile.settings.saveFailed"));
      void haptics.notification("error");
    });
  }

  return (
    <SettingsRow
      trailing={
        <SettingsPicker<MuteChoice>
          value={mute}
          options={[
            // A timed mute shows its end, as no choice below names it.
            ...(until !== null && until !== Number.POSITIVE_INFINITY
              ? [
                  {
                    value: "current" as const,
                    label: t("mobile.settings.notifications.mute.until", { time: muteEnd(until, format) }),
                  },
                ]
              : []),
            { value: "off", label: t("mobile.settings.notifications.mute.off") },
            ...SERVER_MUTE_DURATIONS_MS.flatMap((duration, index) => {
              const key = MUTE_KEYS[index];
              return key ? [{ value: `${duration}` as const, label: t(key) }] : [];
            }),
            { value: "forever", label: t("mobile.settings.notifications.mute.untilTurnedOn") },
          ]}
          enabled={enabled}
          dark={theme === "dark"}
          label={t("mobile.settings.notifications.mute")}
          onChange={save}
        />
      }
    >
      <Typography.Paragraph>{t("mobile.settings.notifications.mute")}</Typography.Paragraph>
    </SettingsRow>
  );
}
