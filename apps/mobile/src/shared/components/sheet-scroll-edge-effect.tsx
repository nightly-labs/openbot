import MaskedView from "@react-native-masked-view/masked-view";
import { BlurView } from "expo-blur";
import { type StyleProp, useColorScheme, View, type ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { ProgressiveSheetBlur } from "@/shared/components/progressive-sheet-blur";
import { isIOS } from "@/shared/lib/platform";

interface SheetScrollEdgeEffectProps {
  style: StyleProp<ViewStyle>;
  edge?: "top" | "bottom";
  surface?: "canvas" | "sheet";
}

export function SheetScrollEdgeEffect({ style, edge = "top", surface = "canvas" }: SheetScrollEdgeEffectProps) {
  const colorScheme = useColorScheme();
  const blurTint = colorScheme === "dark" ? "dark" : "light";

  if (surface === "sheet" && isIOS) return <ProgressiveSheetBlur style={style} edge={edge} />;

  return (
    <View pointerEvents="none" style={style}>
      <MaskedView
        style={{ flex: 1 }}
        maskElement={
          <Svg height="100%" width="100%">
            <Defs>
              <LinearGradient
                id="sheet-scroll-edge-mask"
                x1="0"
                x2="0"
                y1={edge === "top" ? "0" : "1"}
                y2={edge === "top" ? "1" : "0"}
              >
                <Stop offset="0" stopColor="#000000" stopOpacity="1" />
                <Stop offset="0.24" stopColor="#000000" stopOpacity={surface === "sheet" ? 0.85 : 0.96} />
                <Stop offset="0.5" stopColor="#000000" stopOpacity={surface === "sheet" ? 0.5 : 0.76} />
                <Stop offset="0.72" stopColor="#000000" stopOpacity={surface === "sheet" ? 0.19 : 0.42} />
                <Stop offset="0.9" stopColor="#000000" stopOpacity={surface === "sheet" ? 0.028 : 0.1} />
                <Stop offset="1" stopColor="#000000" stopOpacity="0" />
              </LinearGradient>
            </Defs>
            <Rect fill="url(#sheet-scroll-edge-mask)" height="100%" width="100%" />
          </Svg>
        }
      >
        <View className="flex-1">
          <BlurView intensity={surface === "sheet" ? 60 : 100} style={{ flex: 1 }} tint={blurTint} />
          {surface === "canvas" ? (
            <BlurView
              intensity={60}
              style={{ bottom: 0, left: 0, position: "absolute", right: 0, top: 0 }}
              tint={blurTint}
            />
          ) : null}
          <View
            className={surface === "sheet" ? "absolute inset-0 bg-sheet/60" : "absolute inset-0 bg-scroll-edge-overlay"}
          />
        </View>
      </MaskedView>
    </View>
  );
}
