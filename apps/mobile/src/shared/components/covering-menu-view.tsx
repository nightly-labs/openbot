import type { MenuComponentProps } from "@expo/ui/community/menu";
import { type ReactNode, useState } from "react";
import { StyleSheet, View } from "react-native";
import { MenuView } from "@/shared/components/menu-view";

export function CoveringMenuView({
  children,
  accessibilityLabel,
  ...menu
}: Omit<MenuComponentProps, "children" | "style" | "shouldOpenOnLongPress"> & {
  children: ReactNode;
  accessibilityLabel: string;
}) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  return (
    <View>
      <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {children}
      </View>
      <View
        style={StyleSheet.absoluteFill}
        onLayout={({ nativeEvent }) => setSize({ width: nativeEvent.layout.width, height: nativeEvent.layout.height })}
      >
        {size ? (
          <MenuView {...menu}>
            <View accessible accessibilityRole="button" accessibilityLabel={accessibilityLabel} style={size} />
          </MenuView>
        ) : null}
      </View>
    </View>
  );
}
