import type { MenuComponentProps } from "@expo/ui/community/menu";
import { type ReactNode, useState } from "react";
import { StyleSheet, View } from "react-native";
import { MenuView } from "@/shared/components/menu-view";

/**
 * A tap menu over content that React Native lays out. The iOS `MenuView` sizes its trigger in SwiftUI
 * from the trigger's own content, so a row of text in it does not take the row width and does not
 * wrap. Here the content keeps its React Native layout, and the menu covers it with an anchor of the
 * same size, so the menu still opens at the content.
 */
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
