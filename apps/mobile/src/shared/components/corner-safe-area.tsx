import type { ReactNode } from "react";
import { type StyleProp, View, type ViewStyle } from "react-native";
import {
  type CornerAdaptation,
  type EdgeInsets,
  SafeAreaProvider,
  useSafeAreaFrame,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { isIOS } from "@/shared/lib/platform";

interface CornerSafeAreaProps {
  cornerAdaptation: CornerAdaptation;
  style?: StyleProp<ViewStyle>;
  children: (insets: EdgeInsets) => ReactNode;
}

export function CornerSafeArea({ cornerAdaptation, style, children }: CornerSafeAreaProps) {
  const columnInsets = useSafeAreaInsets();
  const frame = useSafeAreaFrame();
  const rowInsets = { top: 0, right: columnInsets.right, bottom: 0, left: columnInsets.left };
  if (!isIOS) {
    return (
      <View pointerEvents="box-none" style={style}>
        {children(rowInsets)}
      </View>
    );
  }
  return (
    <SafeAreaProvider initialMetrics={{ insets: rowInsets, frame }} pointerEvents="box-none" style={style}>
      <CornerInsets cornerAdaptation={cornerAdaptation}>{children}</CornerInsets>
    </SafeAreaProvider>
  );
}

function CornerInsets({ cornerAdaptation, children }: Omit<CornerSafeAreaProps, "style">) {
  return children(useSafeAreaInsets({ cornerAdaptation }));
}
