import { Stack } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import type { LucideIcon } from "lucide-react-native";
import { Pressable } from "react-native";

/**
 * A header button for Android. `Stack.Toolbar.Button` on Android shows only an image icon, so a
 * button with an SF Symbol or a text label does not appear. iOS keeps `Stack.Toolbar`. A button
 * with `text` shows that text instead of an icon.
 */
export function AndroidHeaderButton({
  placement,
  icon: Icon,
  text,
  accessibilityLabel,
  hidden = false,
  disabled = false,
  onPress,
}: {
  placement: "left" | "right";
  accessibilityLabel: string;
  hidden?: boolean;
  disabled?: boolean;
  onPress: () => void;
} & ({ icon: LucideIcon; text?: undefined } | { icon?: undefined; text: string })) {
  const foreground = String(useThemeColor("foreground"));
  const button = hidden
    ? undefined
    : () => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityState={{ disabled }}
          disabled={disabled}
          hitSlop={4}
          className={`${text ? "h-11 px-3" : "size-11"} items-center justify-center rounded-full`}
          style={({ pressed }) => ({ opacity: disabled ? 0.4 : pressed ? 0.6 : 1 })}
          onPress={onPress}
        >
          {Icon ? (
            <Icon color={foreground} size={22} strokeWidth={1.9} />
          ) : (
            <Typography.Paragraph weight="semibold" style={{ color: foreground }}>
              {text}
            </Typography.Paragraph>
          )}
        </Pressable>
      );
  return <Stack.Screen options={placement === "left" ? { headerLeft: button } : { headerRight: button }} />;
}
