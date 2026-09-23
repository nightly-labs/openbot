import { BlurView } from "expo-blur";
import { Image } from "expo-image";
import { useThemeColor } from "heroui-native/hooks";
import { Check, Download, Share, X } from "lucide-react-native";
import { type ReactNode, useEffect, useState } from "react";
import { AccessibilityInfo, Modal, Platform, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  cubicBezier,
  useAnimatedProps,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withDecay,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { useUniwind } from "uniwind";
import { haptics } from "@/shared/lib/haptics";
import type { ImageDimensions } from "../model/image-dimensions";
import {
  clamp,
  coverSize,
  dragFade,
  dragScale,
  fitWithin,
  focalTranslation,
  hitsRect,
  lerp,
  lerpRect,
  panBound,
  type Rect,
  rubberBandClamp,
  shouldDismiss,
} from "../model/image-viewer-geometry";

// Out of the chat: just short of critically damped, so the picture arrives rather than stops.
const OPEN_SPRING = { damping: 30, stiffness: 260, mass: 1 } as const;
// Back into the chat: clamped, because a frame that overshoots its thumbnail shrinks past it
// and grows back at the one moment it should be settling.
const CLOSE_SPRING = { damping: 32, stiffness: 300, mass: 1, overshootClamping: true } as const;
// Zoom settling and a drag that snaps back: firm, so it lands without drifting.
const SETTLE_SPRING = { damping: 34, stiffness: 320, mass: 1 } as const;
// The open picture keeps this margin to the screen and the safe area, so the blur shows on every
// side and the photo reads as held up over the chat, not as a new screen.
const INSET = 16;
const CORNER_RADIUS = 16;
const BLUR_INTENSITY = 50;
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const PRESS_EASING = cubicBezier(0.23, 1, 0.32, 1);

const PHASE_OPENING = 0;
const PHASE_OPEN = 1;
const PHASE_CLOSING = 2;
const MODE_NONE = 0;
const MODE_PAN = 1;
const MODE_DISMISS = 2;

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

// The device's answer outlives one viewer, so only the first viewer of a launch waits for it.
let knownReduceTransparency: boolean | null = null;
function useReduceTransparency() {
  const [enabled, setEnabled] = useState(knownReduceTransparency);
  useEffect(() => {
    let active = true;
    const update = (value: boolean) => {
      knownReduceTransparency = value;
      if (active) setEnabled(value);
    };
    void AccessibilityInfo.isReduceTransparencyEnabled().then(update, () => update(false));
    const subscription = AccessibilityInfo.addEventListener("reduceTransparencyChanged", update);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return enabled;
}

/**
 * A photo from the chat, opened over a blur of the chat. The picture on screen is the one that
 * was tapped: its frame grows from the thumbnail's rectangle and corners to the fitted photo,
 * and the crop opens out to the whole image. Pinch or double-tap to zoom; drag it up or down, or
 * tap beside it, to put it back where it came from.
 */
export function ImageViewer({
  uri,
  name,
  dimensions,
  measureOrigin,
  originRadius,
  busy,
  onShare,
  onSave,
  onShown,
  onDismissed,
}: {
  uri: string;
  name: string;
  dimensions: ImageDimensions;
  /** Reports where the thumbnail is now, in window coordinates, or null when it cannot. */
  measureOrigin: (report: (rect: Rect | null) => void) => void;
  originRadius: number;
  busy: boolean;
  onShare: () => void;
  onSave: () => Promise<boolean>;
  /**
   * Called once the viewer is on screen. The chat hides its own copy only then: hiding it on the
   * tap would leave an empty frame for the frame or two the modal takes to present.
   */
  onShown: () => void;
  /** Called once the picture is back in its place, so the chat can show its own copy again. */
  onDismissed: () => void;
}) {
  const { width: W, height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const reduceTransparency = useReduceTransparency();
  const { theme } = useUniwind();
  const foreground = String(useThemeColor("foreground"));
  const vertical = Math.max(insets.top, insets.bottom) + INSET;
  const box = { x: INSET, y: vertical, width: Math.max(W - INSET * 2, 1), height: Math.max(H - vertical * 2, 1) };
  const fit = fitWithin(dimensions, box);

  // The flight: 0 in the chat, 1 on the screen.
  const t = useSharedValue(0);
  const phase = useSharedValue(PHASE_OPENING);
  const origin = useSharedValue<Rect | null>(null);
  // Zoom, measured from the screen's centre.
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const startScale = useSharedValue(1);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const focalOffsetX = useSharedValue(0);
  const focalOffsetY = useSharedValue(0);
  const lastFocalX = useSharedValue(0);
  const lastFocalY = useSharedValue(0);
  const pinching = useSharedValue(false);
  // Dragging the picture away.
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const shrink = useSharedValue(1);
  const fade = useSharedValue(1);
  const gestureMode = useSharedValue(MODE_NONE);
  const chrome = useSharedValue(0);
  const chromeOn = useSharedValue(true);
  const [saved, setSaved] = useState(false);
  const backdrop = useDerivedValue(() => clamp(t.get(), 0, 1) * fade.get());

  function setOrigin(rect: Rect | null) {
    // A thumbnail that has scrolled away gives nothing to fly to, so the picture fades instead.
    const onScreen = rect && rect.y + rect.height > 0 && rect.y < H && rect.x + rect.width > 0 && rect.x < W;
    origin.set(onScreen ? rect : null);
  }

  /** Starts once the modal is on screen, from wherever the thumbnail is at that moment. */
  function open() {
    measureOrigin((rect) => {
      setOrigin(rect);
      onShown();
      const settled = (finished?: boolean) => {
        "worklet";
        if (finished) phase.set(PHASE_OPEN);
      };
      t.set(reduced ? withTiming(1, { duration: 200 }, settled) : withSpring(1, OPEN_SPRING, settled));
      chrome.set(withDelay(120, withTiming(1, { duration: 200 })));
    });
  }

  function startClose(velocityX: number, velocityY: number) {
    "worklet";
    if (phase.get() === PHASE_CLOSING) return;
    phase.set(PHASE_CLOSING);
    gestureMode.set(MODE_NONE);
    chrome.set(withTiming(0, { duration: 120 }));
    const done = (finished?: boolean) => {
      "worklet";
      if (finished) scheduleOnRN(onDismissed);
    };
    if (reduced) {
      t.set(withTiming(0, { duration: 180 }, done));
      return;
    }
    t.set(withSpring(0, CLOSE_SPRING, done));
    dragX.set(withSpring(0, { ...CLOSE_SPRING, velocity: velocityX }));
    dragY.set(withSpring(0, { ...CLOSE_SPRING, velocity: velocityY }));
    shrink.set(withSpring(1, CLOSE_SPRING));
    scale.set(withSpring(1, CLOSE_SPRING));
    tx.set(withSpring(0, CLOSE_SPRING));
    ty.set(withSpring(0, CLOSE_SPRING));
  }

  /** A close from a button or the back action. The chat may have moved, so measure again. */
  function requestClose() {
    measureOrigin((rect) => {
      setOrigin(rect);
      startClose(0, 0);
    });
  }

  function settleZoom() {
    "worklet";
    const target = clamp(scale.get(), 1, MAX_SCALE);
    if (target <= 1.01) {
      scale.set(withSpring(1, SETTLE_SPRING));
      tx.set(withSpring(0, SETTLE_SPRING));
      ty.set(withSpring(0, SETTLE_SPRING));
      chrome.set(withTiming(chromeOn.get() ? 1 : 0, { duration: 180 }));
      return;
    }
    const nextX =
      target === scale.get()
        ? tx.get()
        : focalTranslation(lastFocalX.get(), focalOffsetX.get(), startScale.get(), target);
    const nextY =
      target === scale.get()
        ? ty.get()
        : focalTranslation(lastFocalY.get(), focalOffsetY.get(), startScale.get(), target);
    const boundX = panBound(fit.width, target, W);
    const boundY = panBound(fit.height, target, H);
    scale.set(withSpring(target, SETTLE_SPRING));
    tx.set(withSpring(clamp(nextX, -boundX, boundX), SETTLE_SPRING));
    ty.set(withSpring(clamp(nextY, -boundY, boundY), SETTLE_SPRING));
  }

  function tick() {
    void haptics.selection();
  }

  // Which gesture a touch is gets decided when it starts: two fingers zoom, one finger on a
  // zoomed photo pans it, and any other drag takes the photo away. Deciding once keeps a drag
  // from changing its mind halfway, which is what makes a viewer feel loose.
  const pinch = Gesture.Pinch()
    .onStart((event) => {
      if (phase.get() !== PHASE_OPEN) return;
      pinching.set(true);
      cancelAnimation(scale);
      cancelAnimation(tx);
      cancelAnimation(ty);
      startScale.set(scale.get());
      lastFocalX.set(event.focalX - W / 2);
      lastFocalY.set(event.focalY - H / 2);
      focalOffsetX.set(lastFocalX.get() - tx.get());
      focalOffsetY.set(lastFocalY.get() - ty.get());
      chrome.set(withTiming(0, { duration: 120 }));
    })
    .onUpdate((event) => {
      if (!pinching.get()) return;
      const next = rubberBandClamp(startScale.get() * event.scale, 1, MAX_SCALE, MAX_SCALE);
      lastFocalX.set(event.focalX - W / 2);
      lastFocalY.set(event.focalY - H / 2);
      scale.set(next);
      tx.set(focalTranslation(lastFocalX.get(), focalOffsetX.get(), startScale.get(), next));
      ty.set(focalTranslation(lastFocalY.get(), focalOffsetY.get(), startScale.get(), next));
    })
    .onEnd(() => {
      if (!pinching.get()) return;
      pinching.set(false);
      settleZoom();
    });

  const pan = Gesture.Pan()
    .maxPointers(1)
    .minDistance(8)
    .onStart(() => {
      if (phase.get() !== PHASE_OPEN || pinching.get()) {
        gestureMode.set(MODE_NONE);
        return;
      }
      if (scale.get() > 1.01) {
        gestureMode.set(MODE_PAN);
        cancelAnimation(tx);
        cancelAnimation(ty);
        startX.set(tx.get());
        startY.set(ty.get());
        return;
      }
      gestureMode.set(MODE_DISMISS);
      chrome.set(withTiming(0, { duration: 120 }));
      scheduleOnRN(tick);
    })
    .onUpdate((event) => {
      const mode = gestureMode.get();
      if (mode === MODE_PAN) {
        const boundX = panBound(fit.width, scale.get(), W);
        const boundY = panBound(fit.height, scale.get(), H);
        tx.set(rubberBandClamp(startX.get() + event.translationX, -boundX, boundX, W));
        ty.set(rubberBandClamp(startY.get() + event.translationY, -boundY, boundY, H));
      } else if (mode === MODE_DISMISS) {
        dragX.set(event.translationX);
        dragY.set(event.translationY);
        shrink.set(dragScale(event.translationY, H));
        fade.set(dragFade(event.translationY, H));
      }
    })
    .onEnd((event, success) => {
      const mode = gestureMode.get();
      gestureMode.set(MODE_NONE);
      if (mode === MODE_PAN) {
        const boundX = panBound(fit.width, scale.get(), W);
        const boundY = panBound(fit.height, scale.get(), H);
        if (boundX === 0 || Math.abs(tx.get()) > boundX)
          tx.set(withSpring(clamp(tx.get(), -boundX, boundX), SETTLE_SPRING));
        else tx.set(withDecay({ velocity: event.velocityX, clamp: [-boundX, boundX] }));
        if (boundY === 0 || Math.abs(ty.get()) > boundY)
          ty.set(withSpring(clamp(ty.get(), -boundY, boundY), SETTLE_SPRING));
        else ty.set(withDecay({ velocity: event.velocityY, clamp: [-boundY, boundY] }));
      } else if (mode === MODE_DISMISS) {
        if (success && shouldDismiss(event.translationY, event.velocityY)) {
          startClose(event.velocityX, event.velocityY);
          return;
        }
        dragX.set(withSpring(0, SETTLE_SPRING));
        dragY.set(withSpring(0, SETTLE_SPRING));
        shrink.set(withSpring(1, SETTLE_SPRING));
        fade.set(withTiming(1, { duration: 180 }));
        chrome.set(withTiming(chromeOn.get() ? 1 : 0, { duration: 180 }));
      }
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDelay(250)
    .maxDistance(24)
    .onEnd((event, success) => {
      if (!success || phase.get() !== PHASE_OPEN) return;
      if (scale.get() > 1.01) {
        scale.set(withSpring(1, SETTLE_SPRING));
        tx.set(withSpring(0, SETTLE_SPRING));
        ty.set(withSpring(0, SETTLE_SPRING));
        chrome.set(withTiming(chromeOn.get() ? 1 : 0, { duration: 180 }));
        return;
      }
      const focalX = event.x - W / 2;
      const focalY = event.y - H / 2;
      const boundX = panBound(fit.width, DOUBLE_TAP_SCALE, W);
      const boundY = panBound(fit.height, DOUBLE_TAP_SCALE, H);
      scale.set(withSpring(DOUBLE_TAP_SCALE, SETTLE_SPRING));
      tx.set(withSpring(clamp(focalTranslation(focalX, focalX, 1, DOUBLE_TAP_SCALE), -boundX, boundX), SETTLE_SPRING));
      ty.set(withSpring(clamp(focalTranslation(focalY, focalY, 1, DOUBLE_TAP_SCALE), -boundY, boundY), SETTLE_SPRING));
      chrome.set(withTiming(0, { duration: 120 }));
    });

  const singleTap = Gesture.Tap()
    .maxDistance(10)
    .onEnd((event, success) => {
      if (!success || phase.get() !== PHASE_OPEN) return;
      // Beside the photo puts it back; on it, the controls come and go.
      if (!hitsRect(event.x, event.y, fit, scale.get(), tx.get(), ty.get())) {
        startClose(0, 0);
        return;
      }
      chromeOn.set(!chromeOn.get());
      chrome.set(withTiming(chromeOn.get() ? 1 : 0, { duration: 180 }));
    });

  const gesture = Gesture.Race(Gesture.Simultaneous(pinch, pan), Gesture.Exclusive(doubleTap, singleTap));

  const frameStyle = useAnimatedStyle(() => {
    const progress = t.get();
    const from = origin.get();
    const flies = from !== null && !reduced;
    const rect = flies ? lerpRect(from, fit, progress) : fit;
    const settled = clamp(progress, 0, 1);
    const visualScale = scale.get() * shrink.get() * (flies ? 1 : lerp(0.92, 1, settled));
    // The corners are drawn inside the scale, so a zoomed photo keeps corners of the same size.
    const corner = flies ? lerp(originRadius, CORNER_RADIUS, progress) : CORNER_RADIUS;
    return {
      left: rect.x,
      top: rect.y,
      width: Math.max(rect.width, 1),
      height: Math.max(rect.height, 1),
      borderRadius: Math.max(0, corner) / Math.max(visualScale, 0.01),
      opacity: flies ? 1 : settled,
      transform: [
        { translateX: tx.get() + dragX.get() },
        { translateY: ty.get() + dragY.get() },
        { scale: visualScale },
      ],
    };
  });
  // The picture covers its frame at every step, so the chat's crop opens out to the whole photo.
  const pictureStyle = useAnimatedStyle(() => {
    const from = origin.get();
    const rect = from !== null && !reduced ? lerpRect(from, fit, t.get()) : fit;
    const cover = coverSize(dimensions, rect);
    return {
      left: (rect.width - cover.width) / 2,
      top: (rect.height - cover.height) / 2,
      width: cover.width,
      height: cover.height,
    };
  });
  const chromeStyle = useAnimatedStyle(() => ({ opacity: chrome.get() * clamp(t.get(), 0, 1) * fade.get() }));
  const chromeProps = useAnimatedProps(() => ({
    pointerEvents: chrome.get() > 0.5 ? ("box-none" as const) : ("none" as const),
  }));
  const blurProps = useAnimatedProps(() => ({ intensity: backdrop.get() * BLUR_INTENSITY }));
  const fadeStyle = useAnimatedStyle(() => ({ opacity: backdrop.get() }));

  // Android draws no live blur here and Reduce Transparency asks for none, so both dim instead.
  const blur = Platform.OS === "ios" && reduceTransparency === false;

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onShow={open}
      onRequestClose={requestClose}
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        {blur ? (
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <AnimatedBlurView
              tint={theme === "dark" ? "dark" : "light"}
              animatedProps={blurProps}
              style={StyleSheet.absoluteFill}
            />
            {/* A faint dim under the frost, which alone is nearly invisible over a dark chat. */}
            <Animated.View style={[StyleSheet.absoluteFill, fadeStyle]} className="bg-black/10" />
          </View>
        ) : (
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, fadeStyle]}>
            {reduceTransparency !== false ? <View style={StyleSheet.absoluteFill} className="bg-background" /> : null}
            <View style={StyleSheet.absoluteFill} className="bg-black/60" />
          </Animated.View>
        )}
        <GestureDetector gesture={gesture}>
          <View
            style={StyleSheet.absoluteFill}
            collapsable={false}
            accessible
            accessibilityViewIsModal
            accessibilityRole="image"
            accessibilityLabel={name}
            accessibilityActions={[{ name: "escape" }, { name: "magicTap" }]}
            onAccessibilityAction={requestClose}
            onAccessibilityEscape={requestClose}
          >
            <Animated.View pointerEvents="none" style={[{ position: "absolute", overflow: "hidden" }, frameStyle]}>
              <Animated.View style={[{ position: "absolute" }, pictureStyle]}>
                <Image
                  source={uri}
                  contentFit="cover"
                  transition={0}
                  accessible={false}
                  style={StyleSheet.absoluteFill}
                />
              </Animated.View>
            </Animated.View>
          </View>
        </GestureDetector>
        <Animated.View style={[StyleSheet.absoluteFill, chromeStyle]} animatedProps={chromeProps}>
          <View
            pointerEvents="box-none"
            className="absolute inset-x-4 flex-row items-center justify-between"
            style={{ top: insets.top + 8 }}
          >
            {/* Close at the leading edge, where the platform puts the way out of a full-screen view. */}
            <ViewerControl label="Close" onPress={requestClose}>
              <X size={18} color={foreground} />
            </ViewerControl>
            <View className="flex-row gap-2">
              <ViewerControl label={`Share ${name}`} disabled={busy} onPress={onShare}>
                <Share size={17} color={foreground} />
              </ViewerControl>
              <ViewerControl
                label={saved ? "Saved to Photos" : `Save ${name} to Photos`}
                disabled={busy || saved}
                onPress={() =>
                  void onSave().then((done) => {
                    if (!done) return;
                    void haptics.notification("success");
                    setSaved(true);
                  })
                }
              >
                {saved ? <Check size={18} color={foreground} /> : <Download size={17} color={foreground} />}
              </ViewerControl>
            </View>
          </View>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

/** A round control over the photo, in the app's own surface and text colours. */
function ViewerControl({
  label,
  disabled = false,
  onPress,
  children,
}: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={8}
      pressRetentionOffset={16}
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
    >
      <Animated.View
        className="size-10 items-center justify-center rounded-full bg-background/80"
        style={{
          opacity: disabled ? 0.5 : 1,
          transform: [{ scale: pressed ? 0.94 : 1 }],
          transitionProperty: ["transform", "opacity"],
          transitionDuration: 120,
          transitionTimingFunction: PRESS_EASING,
        }}
      >
        {children}
      </Animated.View>
    </Pressable>
  );
}
