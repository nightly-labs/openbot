import { StatusBar } from "expo-status-bar";
import { Typography } from "heroui-native";
import { useEffect, useState, useSyncExternalStore } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { type EdgeInsets, useSafeAreaInsets } from "react-native-safe-area-context";

import { useReducedMotion } from "@/shared/lib/motion";
import { isAndroid } from "@/shared/lib/platform";
import { SPLASH_EASE_OUT } from "@/shared/lib/splash-motion";
import { BloubEyes, EYES_HEIGHT, EYES_WIDTH } from "./bloub-eyes";
import { BLOUB_MOVE, BLOUB_MOVE_MS, BLOUB_RADIUS, bloubEyesFrame, bloubGradient, useBloubColors } from "./bloub-look";
import { useBloubStage } from "./bloub-stage-context";
import type { BloubMood, BloubStageRequest } from "./bloub-stage-store";
import { StageBackButton } from "./stage-back-button";

// Over a camera, the block fades once it has mostly covered the screen; it comes back at once.
const CLEAR_DELAY_MS = 300;
const VEIL = { duration: 360, easing: SPLASH_EASE_OUT };
const STATUS_GAP = 32;
// Android 12 and later show the splash icon only inside a 192 dp circle in a 288 dp square. At full
// size the tip of the left eye is 117.5 pt from the middle, so the Android splash draws the eyes at
// this scale. Keep the Android `imageWidth` in app.json equal to 240 times this value.
const ANDROID_SPLASH_EYES_SCALE = 0.78;

/** The text on a covering block: a title under the eyes, or a status line at the bottom. */
function StageCaption({
  request,
  height,
  insets,
  textColor,
  textOpacity,
  reduced,
}: {
  request: BloubStageRequest;
  height: number;
  insets: EdgeInsets;
  textColor: string;
  /** The text under a title is a little lighter. The status line keeps full strength. */
  textOpacity: number;
  reduced: boolean;
}) {
  const caption = request.shape.kind === "cover" ? request.caption : undefined;
  if (!caption) return null;
  const enter = reduced
    ? FadeIn.duration(160)
    : FadeIn.duration(300)
        .delay(caption.title ? 420 : 160)
        .easing(SPLASH_EASE_OUT);
  const exit = FadeOut.duration(160);
  if (caption.title) {
    return (
      <Animated.View
        key={`title-${caption.title}-${caption.text}`}
        entering={enter}
        exiting={exit}
        pointerEvents="none"
        className="absolute items-center gap-2"
        style={{ top: height * 0.585, left: insets.left + 24, right: insets.right + 24 }}
      >
        <Typography.Heading
          type="h2"
          align="center"
          accessibilityRole="header"
          className="tracking-openbot-tight"
          style={{ color: textColor }}
        >
          {caption.title}
        </Typography.Heading>
        <Typography.Paragraph align="center" style={{ color: textColor, opacity: textOpacity }}>
          {caption.text}
        </Typography.Paragraph>
      </Animated.View>
    );
  }
  return (
    <Animated.View
      key={`status-${caption.text}`}
      entering={enter}
      exiting={exit}
      pointerEvents="none"
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={caption.text}
      accessibilityState={{ busy: true }}
      accessibilityLiveRegion="polite"
      className="absolute items-center"
      style={{ bottom: insets.bottom + STATUS_GAP, left: insets.left + 24, right: insets.right + 24 }}
    >
      <Typography.Paragraph type="body-sm" align="center" numberOfLines={2} style={{ color: textColor }}>
        {caption.text}
      </Typography.Paragraph>
    </Animated.View>
  );
}

function StageBack({
  request,
  top,
  left,
  eyeColor,
}: {
  request: BloubStageRequest;
  top: number;
  left: number;
  eyeColor: string;
}) {
  const back = request.back;
  if (!back) return null;
  const overCamera = request.shape.kind === "clear";
  return (
    <Animated.View
      key={`${back.icon}-${overCamera}`}
      entering={FadeIn.duration(200).delay(300).easing(SPLASH_EASE_OUT)}
      exiting={FadeOut.duration(120)}
      className="absolute"
      style={{ top, left }}
    >
      <StageBackButton
        icon={back.icon}
        label={back.label}
        color={overCamera ? "#ffffff" : eyeColor}
        disabled={back.disabled}
        // The store keeps the newest callback on the shown request.
        onPress={() => request.back?.onPress()}
      />
    </Animated.View>
  );
}

/**
 * The lilac block with the eyes. It is the splash, the app loader and the sign-in header: one
 * block whose lower edge moves. Only transforms, opacity and colors animate, all on the UI thread.
 * The block is taller than the screen by its corner radius, so a cover hides the round corners.
 */
export function BloubStage({
  nativeSplashHidden,
  onLayout,
}: {
  /** False while the native splash still shows over the stage. */
  nativeSplashHidden: boolean;
  onLayout?: () => void;
}) {
  const { store, lift, gazeX, gazeY, look } = useBloubStage();
  const active = useSyncExternalStore(store.subscribe, store.active);
  const request = active?.request ?? null;
  const window = useWindowDimensions();
  const [size, setSize] = useState({ width: window.width, height: window.height });
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const colors = useBloubColors();
  const { dark, eye: eyeColor } = colors;
  const height = size.height;
  const top = insets.top;
  const shape = request?.shape ?? null;
  // The splash asks for the stage in the first commit. Until a request comes, the stage stays
  // covered as the native splash is, so the first frame never starts to roll up.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (request) setShown(true);
  }, [request]);
  const target = !shape
    ? shown
      ? 0
      : height + BLOUB_RADIUS
    : shape.kind === "header"
      ? shape.bottom
      : height + BLOUB_RADIUS;
  const clear = shape?.kind === "clear";
  const mood: BloubMood = request?.mood ?? "idle";
  const titled = shape?.kind === "cover" && Boolean(request?.caption?.title);
  // The loader tone stays while the block rolls up, so the color does not change as it leaves. The
  // app starts with the splash, which is a loader.
  const [loaderTone, setLoaderTone] = useState(true);
  useEffect(() => {
    if (request) setLoaderTone(Boolean(request.loader));
  }, [request]);
  const dimmed = dark && loaderTone;

  // The app starts covered, as the native splash does.
  const edge = useSharedValue(height + BLOUB_RADIUS);
  const veil = useSharedValue(1);
  const glow = useSharedValue(0);
  const raise = useSharedValue(0);
  const moodScale = useSharedValue(1);
  // The Android splash draws the eyes smaller (see ANDROID_SPLASH_EYES_SCALE). The eyes start at
  // that size and grow to full size once the native splash is gone, so the handover does not jump.
  const splashScale = useSharedValue(isAndroid ? ANDROID_SPLASH_EYES_SCALE : 1);
  const dim = useSharedValue(dimmed ? 1 : 0);

  useEffect(() => {
    edge.set(reduced ? target : withTiming(target, BLOUB_MOVE));
  }, [edge, reduced, target]);
  useEffect(() => {
    veil.set(clear ? withDelay(reduced ? 0 : CLEAR_DELAY_MS, withTiming(0, VEIL)) : withTiming(1, VEIL));
  }, [clear, reduced, veil]);
  useEffect(() => {
    // The bright and the dim block cross-fade when a loader and a screen hand over.
    dim.set(withTiming(dimmed ? 1 : 0, { duration: reduced ? 160 : 300, easing: SPLASH_EASE_OUT }));
  }, [dim, dimmed, reduced]);
  useEffect(() => {
    if (!nativeSplashHidden) return;
    splashScale.set(withTiming(1, { duration: reduced ? 160 : 520, easing: SPLASH_EASE_OUT }));
  }, [nativeSplashHidden, reduced, splashScale]);
  useEffect(() => {
    // The native splash is flat. The light of the gradient comes in after it.
    glow.set(withTiming(1, { duration: 600, easing: SPLASH_EASE_OUT }));
  }, [glow]);
  useEffect(() => {
    // A title sits under the eyes, so they move up; the scanner frame sits a little above the middle.
    const offset = titled ? -0.08 * height : mood === "frame" || mood === "found" ? -0.026 * height : 0;
    raise.set(reduced ? offset : withTiming(offset, BLOUB_MOVE));
    moodScale.set(reduced ? 1 : withTiming(mood === "found" ? 0.9 : 1, { duration: 300, easing: SPLASH_EASE_OUT }));
  }, [height, mood, moodScale, raise, reduced, titled]);
  // Another owner starts with eyes that look ahead.
  const activeId = active?.id;
  useEffect(() => {
    if (activeId !== undefined) look(0, 0);
  }, [activeId, look]);
  // The status bar keeps the dark style until the block that rolls up has left it.
  const [statusStyle, setStatusStyle] = useState<"light" | "dark" | null>(request ? "dark" : null);
  const wantedStatus = request ? (clear || dimmed ? "light" : "dark") : null;
  useEffect(() => {
    if (wantedStatus) {
      setStatusStyle(wantedStatus);
      return;
    }
    const timer = setTimeout(() => setStatusStyle(null), reduced ? 0 : BLOUB_MOVE_MS / 2);
    return () => clearTimeout(timer);
  }, [reduced, wantedStatus]);

  const span = height + BLOUB_RADIUS;
  const blockStyle = useAnimatedStyle(() => ({
    opacity: veil.get(),
    transform: [{ translateY: edge.get() - lift.get() - span }],
  }));
  // The gradient stays still on the screen while the block's edge moves over it.
  const glowStyle = useAnimatedStyle(() => ({
    opacity: glow.get(),
    transform: [{ translateY: span - (edge.get() - lift.get()) }],
  }));
  const dimStyle = useAnimatedStyle(() => ({ opacity: dim.get() }));
  const eyesStyle = useAnimatedStyle(() => {
    const frame = bloubEyesFrame(edge.get() - lift.get(), height, top);
    return {
      opacity: frame.opacity,
      transform: [
        { translateY: frame.center + raise.get() - EYES_HEIGHT / 2 },
        { scale: frame.scale * moodScale.get() * splashScale.get() },
      ],
    };
  });

  return (
    <View
      pointerEvents="box-none"
      style={StyleSheet.absoluteFill}
      onLayout={({ nativeEvent: { layout } }) => {
        setSize((current) =>
          current.width === layout.width && current.height === layout.height
            ? current
            : { width: layout.width, height: layout.height },
        );
        onLayout?.();
      }}
    >
      {statusStyle ? <StatusBar style={statusStyle} /> : null}
      <View
        // A cover keeps touches from the screen below; a header or a camera lets them through.
        pointerEvents={shape?.kind === "cover" ? "auto" : "none"}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={StyleSheet.absoluteFill}
      >
        <Animated.View style={[styles.block, { height: span }, blockStyle]}>
          <View style={[styles.blockClip, { backgroundColor: colors.body }]}>
            <Animated.View
              style={[
                styles.glow,
                {
                  height,
                  experimental_backgroundImage: bloubGradient(colors.light, colors.body),
                },
                glowStyle,
              ]}
            />
            {dark ? (
              <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.dimBody }, dimStyle]}>
                <Animated.View
                  style={[
                    styles.glow,
                    {
                      height,
                      experimental_backgroundImage: bloubGradient(colors.dimLight, colors.dimBody),
                    },
                    glowStyle,
                  ]}
                />
              </Animated.View>
            ) : null}
          </View>
        </Animated.View>
        <Animated.View pointerEvents="none" style={[styles.eyes, { left: (size.width - EYES_WIDTH) / 2 }, eyesStyle]}>
          <BloubEyes
            mood={mood}
            active={request !== null}
            reduced={reduced}
            gazeX={gazeX}
            gazeY={gazeY}
            eyeColor={eyeColor}
          />
        </Animated.View>
      </View>
      {request ? (
        <StageCaption
          request={request}
          height={height}
          insets={insets}
          // The text has the color of the eyes. The dim dark block needs it at more strength.
          textColor={eyeColor}
          textOpacity={dimmed ? 0.85 : 0.62}
          reduced={reduced}
        />
      ) : null}
      {request ? <StageBack request={request} top={top + 6} left={insets.left + 16} eyeColor={eyeColor} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { position: "absolute", left: 0, right: 0, top: 0 },
  blockClip: {
    flex: 1,
    overflow: "hidden",
    borderBottomLeftRadius: BLOUB_RADIUS,
    borderBottomRightRadius: BLOUB_RADIUS,
    borderCurve: "continuous",
  },
  glow: { position: "absolute", left: 0, right: 0, top: 0 },
  eyes: { position: "absolute", top: 0, width: EYES_WIDTH, height: EYES_HEIGHT },
});
