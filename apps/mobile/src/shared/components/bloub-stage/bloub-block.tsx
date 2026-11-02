import { useEffect, useState } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useReducedMotion } from "@/shared/lib/motion";
import { BloubEyes, EYES_HEIGHT, EYES_WIDTH } from "./bloub-eyes";
import { BLOUB_MOVE, BLOUB_RADIUS, bloubEyesFrame, bloubGradient, useBloubColors } from "./bloub-look";

/** Where the lower edge of the block is: over the whole screen, at a point, or above the screen. */
export type BloubEdge = "cover" | "gone" | number;

/**
 * The lilac block with the eyes, for a window that draws above the stage, such as the app lock.
 * It starts covered, as the stage does, and moves its edge to `edge` on the UI thread.
 */
export function BloubBlock({ edge, dimmed }: { edge: BloubEdge; dimmed: boolean }) {
  const window = useWindowDimensions();
  const [height, setHeight] = useState(window.height);
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const colors = useBloubColors();
  const span = height + BLOUB_RADIUS;
  const target = edge === "cover" ? span : edge === "gone" ? 0 : edge;
  const position = useSharedValue(span);
  const gazeX = useSharedValue(0);
  const gazeY = useSharedValue(0);
  useEffect(() => {
    position.set(reduced ? target : withTiming(target, BLOUB_MOVE));
  }, [position, reduced, target]);

  const top = insets.top;
  const blockStyle = useAnimatedStyle(() => ({ transform: [{ translateY: position.get() - span }] }));
  // The gradient stays still on the screen while the block's edge moves over it.
  const lightStyle = useAnimatedStyle(() => ({ transform: [{ translateY: span - position.get() }] }));
  const eyesStyle = useAnimatedStyle(() => {
    const frame = bloubEyesFrame(position.get(), height, top);
    return {
      opacity: frame.opacity,
      transform: [{ translateY: frame.center - EYES_HEIGHT / 2 }, { scale: frame.scale }],
    };
  });
  const body = dimmed ? colors.dimBody : colors.body;
  const light = dimmed ? colors.dimLight : colors.light;

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={StyleSheet.absoluteFill}
      onLayout={({ nativeEvent: { layout } }) => setHeight(layout.height)}
    >
      <Animated.View style={[styles.block, { height: span }, blockStyle]}>
        <View style={[styles.clip, { backgroundColor: body }]}>
          <Animated.View
            style={[styles.light, { height, experimental_backgroundImage: bloubGradient(light, body) }, lightStyle]}
          />
        </View>
      </Animated.View>
      <Animated.View style={[styles.eyes, { left: (window.width - EYES_WIDTH) / 2 }, eyesStyle]}>
        <BloubEyes
          mood="idle"
          active={edge !== "gone"}
          reduced={reduced}
          gazeX={gazeX}
          gazeY={gazeY}
          eyeColor={colors.eye}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { position: "absolute", left: 0, right: 0, top: 0 },
  clip: {
    flex: 1,
    overflow: "hidden",
    borderBottomLeftRadius: BLOUB_RADIUS,
    borderBottomRightRadius: BLOUB_RADIUS,
    borderCurve: "continuous",
  },
  light: { position: "absolute", left: 0, right: 0, top: 0 },
  eyes: { position: "absolute", top: 0, width: EYES_WIDTH, height: EYES_HEIGHT },
});
