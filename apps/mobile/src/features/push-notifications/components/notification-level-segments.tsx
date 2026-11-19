import type { ServerNotificationLevel } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { Pressable, View } from "react-native";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { NOTIFICATION_LEVEL_KEYS } from "./server-notification-settings";

const LEVELS = ["all", "needs-me", "nothing"] as const satisfies readonly ServerNotificationLevel[];

export const SELECTION_RADIUS = 12;

const SHORT_KEYS = {
  all: "mobile.settings.notifications.levelShort.all",
  "needs-me": "mobile.settings.notifications.levelShort.needsMe",
  nothing: "mobile.settings.notifications.levelShort.nothing",
} as const satisfies Record<ServerNotificationLevel, MobileTextKey>;

export function NotificationLevelSegments({
  label,
  value,
  inherited = null,
  disabled,
  onSelect,
}: {
  label: string;
  value: ServerNotificationLevel | null;
  inherited?: ServerNotificationLevel | null;
  disabled: boolean;
  onSelect: (level: ServerNotificationLevel) => void;
}) {
  const { t } = useText();
  const accent = String(useThemeColor("accent"));
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      className="flex-row items-center gap-0.5"
      style={{ opacity: disabled ? 0.45 : 1 }}
    >
      {LEVELS.map((level) => {
        const selected = value === level;
        const fromServer = value === null && inherited === level;
        return (
          <Pressable
            key={level}
            accessibilityRole="radio"
            accessibilityLabel={t(NOTIFICATION_LEVEL_KEYS[level])}
            accessibilityHint={fromServer ? t("mobile.agent.notificationLevel.server") : undefined}
            accessibilityState={{ checked: selected, disabled }}
            disabled={disabled}
            hitSlop={{ top: 8, bottom: 8 }}
            onPress={() => {
              void haptics.selection();
              onSelect(level);
            }}
            className={`min-h-8 justify-center px-2.5 ${selected ? "bg-control-active" : ""}`}
            style={({ pressed }) => ({
              borderRadius: SELECTION_RADIUS,
              borderWidth: 1,
              borderStyle: fromServer ? "dashed" : "solid",
              borderColor: fromServer ? accent : "transparent",
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Typography.Paragraph
              type="body-xs"
              weight={selected ? "semibold" : "normal"}
              numberOfLines={1}
              className={selected || fromServer ? undefined : "text-grouped-secondary"}
            >
              {t(SHORT_KEYS[level])}
            </Typography.Paragraph>
          </Pressable>
        );
      })}
    </View>
  );
}
