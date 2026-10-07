import { Stack } from "expo-router";
import { useThemeColor } from "heroui-native/hooks";
import type { LucideIcon } from "lucide-react-native";
import { Pressable } from "react-native";

/**
 * A header button for Android. `Stack.Toolbar.Button` on Android shows only an image icon, so a
 * button with an SF Symbol or a text label does not appear. iOS keeps `Stack.Toolbar`.
 */
export function AndroidHeaderButton({
  placement,
  icon: Icon,
  accessibilityLabel,
  hidden = false,
  disabled = false,
  onPress,
}: {
  placement: "left" | "right";
  icon: LucideIcon;
  accessibilityLabel: string;
  hidden?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
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
          className="size-11 items-center justify-center rounded-full"
          style={({ pressed }) => ({ opacity: disabled ? 0.4 : pressed ? 0.6 : 1 })}
          onPress={onPress}
        >
          <Icon color={foreground} size={22} strokeWidth={1.9} />
        </Pressable>
      );
  return <Stack.Screen options={placement === "left" ? { headerLeft: button } : { headerRight: button }} />;
}
