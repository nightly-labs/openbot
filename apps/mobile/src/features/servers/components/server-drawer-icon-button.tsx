import { Pressable } from "react-native";

import type { ServerDrawerIconButtonProps } from "./server-drawer-icon-button.types";

export function ServerDrawerIconButton({ accessibilityLabel, children, onPress }: ServerDrawerIconButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      className="size-9 items-center justify-center rounded-full bg-control"
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.58 : 1 })}
    >
      {children}
    </Pressable>
  );
}
