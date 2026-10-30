import type { ServerNotificationLevel } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { Pressable, View } from "react-native";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { NOTIFICATION_LEVEL_KEYS } from "./server-notification-settings";

const LEVELS = ["all", "needs-me", "nothing"] as const satisfies readonly ServerNotificationLevel[];

const SHORT_KEYS = {
  all: "mobile.settings.notifications.levelShort.all",
  "needs-me": "mobile.settings.notifications.levelShort.needsMe",
  nothing: "mobile.settings.notifications.levelShort.nothing",
} as const satisfies Record<ServerNotificationLevel, MobileTextKey>;

/**
 * The three levels of one row of the notification settings, in a compact segmented control. A filled
 * segment is the row's own level. A dashed outline is the level that the row takes from its server.
 * HeroUI tabs always select one value and do not report a tap on the selected value, so they cannot
 * show a level that the row takes from the server, or clear the row's own level.
 */
export function NotificationLevelSegments({
  label,
  value,
  inherited = null,
  disabled,
  onSelect,
}: {
  /** The name of the row, for screen readers. */
  label: string;
  /** The row's own level, or `null` when it has none. */
  value: ServerNotificationLevel | null;
  /** The level that the row takes from its server when it has no level of its own. */
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
            className={`min-h-8 justify-center rounded-lg px-2 ${selected ? "bg-control-active" : ""}`}
            style={({ pressed }) => ({
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
