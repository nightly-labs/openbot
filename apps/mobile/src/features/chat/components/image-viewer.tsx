import type { AttachmentSummary } from "@openbot/contracts/ipc";
import { BlurView } from "expo-blur";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Image } from "expo-image";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Check from "lucide-react-native/icons/check";
import Download from "lucide-react-native/icons/download";
import Share from "lucide-react-native/icons/share";
import X from "lucide-react-native/icons/x";
import { useCallback, useEffect, useState } from "react";
import { AccessibilityInfo, Modal, Platform, StyleSheet, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  type AnimatedRef,
  cancelAnimation,
  measure,
  type SharedValue,
  useAnimatedProps,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDecay,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN, scheduleOnUI } from "react-native-worklets";
import { useUniwind } from "uniwind";
import { haptics } from "@/shared/lib/haptics";
import { useReducedMotion } from "@/shared/lib/motion";
import { useText } from "@/shared/lib/text";
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
  pageTurn,
  panBound,
  type Rect,
  rubberBandClamp,
  shouldDismiss,
} from "../model/image-viewer-geometry";
import { knownImageDimensions, useAttachmentFile } from "./attachment-preview";
import { ChatGlassIconButton, ChatGlassLabel } from "./chat-glass-icon-button";

// Out of the chat: just short of critically damped, so the picture arrives rather than stops.
const OPEN_SPRING = { damping: 30, stiffness: 260, mass: 1 } as const;
// Back into the chat: clamped, because a frame that overshoots its thumbnail shrinks past it
// and grows back at the one moment it should be settling.
const CLOSE_SPRING = { damping: 32, stiffness: 300, mass: 1, overshootClamping: true } as const;
// Zoom settling and a drag that snaps back: firm, so it lands without drifting.
const SETTLE_SPRING = { damping: 34, stiffness: 320, mass: 1 } as const;
// The next picture slides in and stops: a page that bounces past its place reads as loose.
const PAGE_SPRING = { damping: 36, stiffness: 300, mass: 1, overshootClamping: true } as const;
// The open picture keeps this margin to the screen and the safe area, so the blur shows on every
// side and the photo reads as held up over the chat, not as a new screen.
const INSET = 16;
// The space between two pictures of the carousel while a swipe moves them.
const PAGE_GAP = 24;
// The pictures either side of the one on screen stay mounted, so a quick second swipe finds its
// picture drawn even when the JS thread is late to hear about the first.
const PAGE_WINDOW = 2;
const CORNER_RADIUS = 16;
const BLUR_INTENSITY = 50;
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
// The shape a picture takes until its size is known: a portrait phone photo.
const UNKNOWN_SIZE = { width: 3, height: 4 } as const;

const PHASE_OPENING = 0;
const PHASE_OPEN = 1;
const PHASE_CLOSING = 2;
const MODE_NONE = 0;
const MODE_PAN = 1;
const MODE_DISMISS = 2;
const MODE_PAGE = 3;
// A one-finger drag on an unzoomed photo whose direction is not known yet.
const MODE_UNDECIDED = 4;

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

export interface ImageViewerPage {
  /** The attachment id. `hiddenSource` holds it while the viewer shows this picture. */
  key: string;
  attachment: AttachmentSummary;
  /**
   * The chat's copy of the picture, measured on the UI thread where each flight starts and ends.
   * Null for a row the list has not drawn: that picture fades away instead.
   */
  origin: AnimatedRef | null;
  /** The corner radius of the chat's copy. */
  originRadius: number;
}

/** The shared values every page reads to place its frame. */
interface ViewerMotion {
  t: SharedValue<number>;
  origin: SharedValue<Rect | null>;
  index: SharedValue<number>;
  pageOffset: SharedValue<number>;
  scale: SharedValue<number>;
  shrink: SharedValue<number>;
  tx: SharedValue<number>;
  ty: SharedValue<number>;
  dragX: SharedValue<number>;
  dragY: SharedValue<number>;
}

/**
 * Photos from the chat, opened over a blur of the chat. The picture on screen is the one that
 * was tapped: its frame grows from the thumbnail's rectangle and corners to the fitted photo,
 * and the crop opens out to the whole image. Swipe sideways for the other photos of the message,
 * pinch or double-tap to zoom; drag it up or down, or tap beside it, to put it back where it came
 * from. Every step of that runs on the UI thread, from the first measurement to the landing.
 */
export function ImageViewer({
  serverId,
  pages,
  initialIndex,
  hiddenSource,
  busy,
  onShare,
  onSave,
  onIndexChange,
  onDismissed,
}: {
  serverId: string;
  pages: readonly ImageViewerPage[];
  initialIndex: number;
  /**
   * The key of the page whose chat copy hides. The viewer sets it in the frame its flight leaves
   * the thumbnail and clears it in the frame the flight lands, so the chat never shows an empty
   * frame or a second copy, however busy the JS thread is.
   */
  hiddenSource: SharedValue<string | null>;
  /** The actions of the page on screen. */
  busy: boolean;
  onShare: () => void;
  onSave: () => Promise<boolean>;
  onIndexChange?: (index: number) => void;
  /** Called once the picture is back in its place. */
  onDismissed: () => void;
}) {
  const { width: W, height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const reduceTransparency = useReduceTransparency();
  const { theme } = useUniwind();
  const [foreground, fallbackBackground] = useThemeColor(["foreground", "default"]);
  const text = useText();
  // The same glass as the chat header's buttons. Without Liquid Glass, or with Reduce
  // Transparency on, they fall back to the theme's solid control colour.
  const liquidGlassAvailable = isLiquidGlassAvailable() && reduceTransparency === false;
  const vertical = Math.max(insets.top, insets.bottom) + INSET;
  const box = { x: INSET, y: vertical, width: Math.max(W - INSET * 2, 1), height: Math.max(H - vertical * 2, 1) };
  const count = pages.length;
  const step = W + PAGE_GAP;
  // A page learns its size when its image loads. Until then the chat's record of it, or a guess.
  const [sizes, setSizes] = useState<Readonly<Record<string, ImageDimensions>>>({});
  const sizeOf = (page: ImageViewerPage) => sizes[page.key] ?? knownImageDimensions(page.key) ?? UNKNOWN_SIZE;
  const fits = pages.map((page) => fitWithin(sizeOf(page), box));
  const keys = pages.map((page) => page.key);
  const origins = pages.map((page) => page.origin);

  // The flight: 0 in the chat, 1 on the screen.
  const t = useSharedValue(0);
  const phase = useSharedValue(PHASE_OPENING);
  const origin = useSharedValue<Rect | null>(null);
  // The carousel: the page on screen, and how far a swipe has moved the strip from it.
  const index = useSharedValue(initialIndex);
  const pageOffset = useSharedValue(0);
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
  // React hears which page is on screen only to mount its neighbours and label the controls.
  const [shown, setShown] = useState(initialIndex);
  const [savedKeys, setSavedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const backdrop = useDerivedValue(() => clamp(t.get(), 0, 1) * fade.get());
  const motion: ViewerMotion = { t, origin, index, pageOffset, scale, shrink, tx, ty, dragX, dragY };
  const current = pages[shown] ?? pages[0];
  const saved = current ? savedKeys.has(current.key) : false;
  const name = current?.attachment.name ?? "";
  const position = text.t("mobile.chat.imageViewer.position", { current: shown + 1, total: count });

  const reportSize = useCallback((key: string, size: ImageDimensions) => {
    setSizes((known) => {
      const previous = known[key];
      return previous?.width === size.width && previous.height === size.height ? known : { ...known, [key]: size };
    });
  }, []);

  // The viewer owns the hidden copy only while it is open. A viewer that leaves early gives it back.
  useEffect(() => () => hiddenSource.set(null), [hiddenSource]);

  function currentFit() {
    "worklet";
    return fits[index.get()] ?? box;
  }

  /** Reads where the current page's thumbnail is now. One scrolled out of view gives nothing to fly to. */
  function measureOrigin() {
    "worklet";
    const ref = origins[index.get()];
    const measured = ref ? measure(ref) : null;
    if (
      !measured ||
      measured.pageY + measured.height <= 0 ||
      measured.pageY >= H ||
      measured.pageX + measured.width <= 0 ||
      measured.pageX >= W
    ) {
      origin.set(null);
      return;
    }
    origin.set({ x: measured.pageX, y: measured.pageY, width: measured.width, height: measured.height });
  }

  /** Starts once the modal is on screen, from wherever the thumbnail is at that moment. */
  function open() {
    "worklet";
    measureOrigin();
    hiddenSource.set(keys[index.get()] ?? null);
    const settled = (finished?: boolean) => {
      "worklet";
      if (finished) phase.set(PHASE_OPEN);
    };
    t.set(reduced ? withTiming(1, { duration: 200 }, settled) : withSpring(1, OPEN_SPRING, settled));
    chrome.set(withDelay(120, withTiming(1, { duration: 200 })));
  }

  function startClose(velocityX: number, velocityY: number) {
    "worklet";
    if (phase.get() === PHASE_CLOSING) return;
    phase.set(PHASE_CLOSING);
    gestureMode.set(MODE_NONE);
    // The chat may have moved since the viewer opened, so the flight goes to where it is now.
    measureOrigin();
    chrome.set(withTiming(0, { duration: 120 }));
    const done = (finished?: boolean) => {
      "worklet";
      if (!finished) return;
      hiddenSource.set(null);
      scheduleOnRN(onDismissed);
    };
    if (reduced) {
      pageOffset.set(0);
      t.set(withTiming(0, { duration: 180 }, done));
      return;
    }
    t.set(withSpring(0, CLOSE_SPRING, done));
    pageOffset.set(withSpring(0, CLOSE_SPRING));
    dragX.set(withSpring(0, { ...CLOSE_SPRING, velocity: velocityX }));
    dragY.set(withSpring(0, { ...CLOSE_SPRING, velocity: velocityY }));
    shrink.set(withSpring(1, CLOSE_SPRING));
    scale.set(withSpring(1, CLOSE_SPRING));
    tx.set(withSpring(0, CLOSE_SPRING));
    ty.set(withSpring(0, CLOSE_SPRING));
  }

  /** A close from a button or the back action. */
  function requestClose() {
    scheduleOnUI(startClose, 0, 0);
  }

  function pageChanged(next: number) {
    setShown(next);
    onIndexChange?.(next);
  }

  /**
   * Makes `target` the page on screen and slides the strip to it. The index changes at once and
   * the offset takes up the difference, so the pictures do not move in the frame it changes.
   */
  function turnTo(target: number, velocity: number) {
    "worklet";
    const from = index.get();
    const next = clamp(target, 0, count - 1);
    if (next !== from) {
      pageOffset.set(pageOffset.get() + (next - from) * step);
      index.set(next);
      hiddenSource.set(keys[next] ?? null);
      scale.set(1);
      tx.set(0);
      ty.set(0);
      scheduleOnRN(pageChanged, next);
    }
    pageOffset.set(reduced ? withTiming(0, { duration: 160 }) : withSpring(0, { ...PAGE_SPRING, velocity }));
  }

  function turnBy(delta: number) {
    "worklet";
    if (phase.get() !== PHASE_OPEN) return;
    turnTo(index.get() + delta, 0);
  }

  function settleZoom() {
    "worklet";
    const fit = currentFit();
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
  // zoomed photo pans it, a sideways drag turns the page, and any other drag takes the photo
  // away. Deciding once keeps a drag from changing its mind halfway, which is what makes a
  // viewer feel loose.
  const pinch = Gesture.Pinch()
    .onStart((event) => {
      if (phase.get() !== PHASE_OPEN || gestureMode.get() === MODE_PAGE) return;
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

  /**
   * Turns an unzoomed drag into a page swipe or a drag away, from the way it has moved. Android
   * starts the pan before it reports a translation, so a drag that has no direction yet waits for
   * the next update.
   */
  function decideDrag(translationX: number, translationY: number) {
    "worklet";
    if (!(Math.abs(translationX) + Math.abs(translationY) > 0)) {
      gestureMode.set(MODE_UNDECIDED);
      return;
    }
    if (count > 1 && Math.abs(translationX) > Math.abs(translationY)) {
      gestureMode.set(MODE_PAGE);
      cancelAnimation(pageOffset);
      startX.set(pageOffset.get());
      return;
    }
    gestureMode.set(MODE_DISMISS);
    chrome.set(withTiming(0, { duration: 120 }));
    scheduleOnRN(tick);
  }

  const pan = Gesture.Pan()
    .maxPointers(1)
    .minDistance(8)
    .onStart((event) => {
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
      decideDrag(event.translationX, event.translationY);
    })
    .onUpdate((event) => {
      if (gestureMode.get() === MODE_UNDECIDED) decideDrag(event.translationX, event.translationY);
      const mode = gestureMode.get();
      if (mode === MODE_PAN) {
        const fit = currentFit();
        const boundX = panBound(fit.width, scale.get(), W);
        const boundY = panBound(fit.height, scale.get(), H);
        tx.set(rubberBandClamp(startX.get() + event.translationX, -boundX, boundX, W));
        ty.set(rubberBandClamp(startY.get() + event.translationY, -boundY, boundY, H));
      } else if (mode === MODE_PAGE) {
        // The first and last pictures resist a swipe toward nothing.
        const lower = index.get() < count - 1 ? -step : 0;
        const upper = index.get() > 0 ? step : 0;
        pageOffset.set(rubberBandClamp(startX.get() + event.translationX, lower, upper, W));
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
        const fit = currentFit();
        const boundX = panBound(fit.width, scale.get(), W);
        const boundY = panBound(fit.height, scale.get(), H);
        if (boundX === 0 || Math.abs(tx.get()) > boundX)
          tx.set(withSpring(clamp(tx.get(), -boundX, boundX), SETTLE_SPRING));
        else tx.set(withDecay({ velocity: event.velocityX, clamp: [-boundX, boundX] }));
        if (boundY === 0 || Math.abs(ty.get()) > boundY)
          ty.set(withSpring(clamp(ty.get(), -boundY, boundY), SETTLE_SPRING));
        else ty.set(withDecay({ velocity: event.velocityY, clamp: [-boundY, boundY] }));
      } else if (mode === MODE_PAGE) {
        const direction = success ? pageTurn(pageOffset.get(), event.velocityX, step) : 0;
        turnTo(index.get() + direction, event.velocityX);
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
      const fit = currentFit();
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
      if (!hitsRect(event.x, event.y, currentFit(), scale.get(), tx.get(), ty.get())) {
        startClose(0, 0);
        return;
      }
      chromeOn.set(!chromeOn.get());
      chrome.set(withTiming(chromeOn.get() ? 1 : 0, { duration: 180 }));
    });

  const gesture = Gesture.Race(Gesture.Simultaneous(pinch, pan), Gesture.Exclusive(doubleTap, singleTap));

  // Glass stops rendering under a parent with zero opacity, so the buttons are never faded from
  // here. The worklets still decide when they show; React hears only when that flips.
  const [chromeVisible, setChromeVisible] = useState(false);
  useAnimatedReaction(
    () => chrome.get() > 0.5 && t.get() > 0.5,
    (visible, previous) => {
      if (visible !== previous) scheduleOnRN(setChromeVisible, visible);
    },
  );
  const blurProps = useAnimatedProps(() => ({ intensity: backdrop.get() * BLUR_INTENSITY }));
  const fadeStyle = useAnimatedStyle(() => ({ opacity: backdrop.get() }));

  // Android draws no live blur here and Reduce Transparency asks for none, so both dim instead.
  const blur = Platform.OS === "ios" && reduceTransparency === false;
  const mounted = pages
    .map((page, slot) => ({ page, slot }))
    .filter(({ slot }) => Math.abs(slot - shown) <= PAGE_WINDOW);

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onShow={() => scheduleOnUI(open)}
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
            accessibilityRole={count > 1 ? "adjustable" : "image"}
            accessibilityLabel={name}
            accessibilityValue={count > 1 ? { text: position } : undefined}
            accessibilityActions={
              count > 1
                ? [{ name: "escape" }, { name: "magicTap" }, { name: "increment" }, { name: "decrement" }]
                : [{ name: "escape" }, { name: "magicTap" }]
            }
            onAccessibilityAction={(event) => {
              const action = event.nativeEvent.actionName;
              if (action === "increment") scheduleOnUI(turnBy, 1);
              else if (action === "decrement") scheduleOnUI(turnBy, -1);
              else requestClose();
            }}
            onAccessibilityEscape={requestClose}
          >
            {mounted.map(({ page, slot }) => (
              <ViewerPicture
                key={page.key}
                serverId={serverId}
                attachment={page.attachment}
                dimensions={sizeOf(page)}
                slot={slot}
                fit={fits[slot] ?? box}
                step={step}
                reduced={reduced}
                originRadius={page.originRadius}
                motion={motion}
                onSize={reportSize}
              />
            ))}
          </View>
        </GestureDetector>
        {/* The viewer covers the window, and the chat can be one column of it. This view reads the
            window's insets, so the buttons keep clear of the rail of iPhone Duo on either side. */}
        <SafeAreaView edges={["top", "left", "right"]} style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <View pointerEvents="box-none" className="flex-row items-center justify-between px-4 pt-2">
            {/* Close at the leading edge, where the platform puts the way out of a full-screen view,
                and the position beside it on the same glass. */}
            <View className="flex-row items-center gap-2">
              <ChatGlassIconButton
                accessibilityLabel={text.t("common.close")}
                hidden={!chromeVisible}
                fallbackBackground={fallbackBackground}
                liquidGlassAvailable={liquidGlassAvailable}
                onPress={() => {
                  void haptics.impact("soft");
                  requestClose();
                }}
              >
                <X size={22} color={String(foreground)} />
              </ChatGlassIconButton>
              {count > 1 ? (
                // The container above reads the position to a screen reader, as its value.
                <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                  <ChatGlassLabel
                    hidden={!chromeVisible}
                    fallbackBackground={fallbackBackground}
                    liquidGlassAvailable={liquidGlassAvailable}
                  >
                    <Typography.Paragraph type="body-sm" className="font-semibold text-foreground">
                      {position}
                    </Typography.Paragraph>
                  </ChatGlassLabel>
                </View>
              ) : null}
            </View>
            <View className="flex-row gap-2">
              <ChatGlassIconButton
                accessibilityLabel={text.t("mobile.chat.imageViewer.share", { name })}
                hidden={!chromeVisible}
                disabled={busy}
                fallbackBackground={fallbackBackground}
                liquidGlassAvailable={liquidGlassAvailable}
                onPress={() => {
                  void haptics.impact("soft");
                  onShare();
                }}
              >
                <Share size={20} color={String(foreground)} />
              </ChatGlassIconButton>
              <ChatGlassIconButton
                accessibilityLabel={
                  saved ? text.t("mobile.chat.imageViewer.saved") : text.t("mobile.chat.imageViewer.save", { name })
                }
                hidden={!chromeVisible}
                disabled={busy || saved}
                fallbackBackground={fallbackBackground}
                liquidGlassAvailable={liquidGlassAvailable}
                onPress={() => {
                  const key = current?.key;
                  void onSave().then((done) => {
                    if (!done || key === undefined) return;
                    void haptics.notification("success");
                    setSavedKeys((keys) => new Set(keys).add(key));
                  });
                }}
              >
                {saved ? (
                  <Check size={21} color={String(foreground)} />
                ) : (
                  <Download size={20} color={String(foreground)} />
                )}
              </ChatGlassIconButton>
            </View>
          </View>
        </SafeAreaView>
      </GestureHandlerRootView>
    </Modal>
  );
}

/**
 * One picture of the carousel. The one on screen flies, zooms and drags; the others wait fitted,
 * one step to each side, and move with the swipe.
 */
function ViewerPicture({
  serverId,
  attachment,
  dimensions,
  slot,
  fit,
  step,
  reduced,
  originRadius,
  motion,
  onSize,
}: {
  serverId: string;
  attachment: AttachmentSummary;
  dimensions: ImageDimensions;
  slot: number;
  fit: Rect;
  step: number;
  reduced: boolean;
  originRadius: number;
  motion: ViewerMotion;
  onSize: (key: string, size: ImageDimensions) => void;
}) {
  // The query the chat uses, so a picture the chat has shown is not downloaded again.
  const file = useAttachmentFile(serverId, attachment, true);
  const [loaded, setLoaded] = useState(false);
  const knownWidth = file.dimensions?.width;
  const knownHeight = file.dimensions?.height;
  useEffect(() => {
    if (knownWidth && knownHeight) onSize(attachment.id, { width: knownWidth, height: knownHeight });
  }, [attachment.id, knownWidth, knownHeight, onSize]);
  const frameStyle = useAnimatedStyle(() => {
    const progress = motion.t.get();
    const settled = clamp(progress, 0, 1);
    const offset = (slot - motion.index.get()) * step + motion.pageOffset.get();
    if (slot !== motion.index.get())
      return {
        left: fit.x,
        top: fit.y,
        width: Math.max(fit.width, 1),
        height: Math.max(fit.height, 1),
        borderRadius: CORNER_RADIUS,
        opacity: settled,
        transform: [{ translateX: offset }, { translateY: 0 }, { scale: 1 }],
      };
    const from = motion.origin.get();
    const flies = from !== null && !reduced;
    const rect = flies ? lerpRect(from, fit, progress) : fit;
    const visualScale = motion.scale.get() * motion.shrink.get() * (flies ? 1 : lerp(0.92, 1, settled));
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
        { translateX: motion.tx.get() + motion.dragX.get() + offset },
        { translateY: motion.ty.get() + motion.dragY.get() },
        { scale: visualScale },
      ],
    };
  });
  // The picture covers its frame at every step, so the chat's crop opens out to the whole photo.
  const pictureStyle = useAnimatedStyle(() => {
    const from = motion.origin.get();
    const flies = slot === motion.index.get() && from !== null && !reduced;
    const rect = flies ? lerpRect(from, fit, motion.t.get()) : fit;
    const cover = coverSize(dimensions, rect);
    return {
      left: (rect.width - cover.width) / 2,
      top: (rect.height - cover.height) / 2,
      width: cover.width,
      height: cover.height,
    };
  });
  return (
    <Animated.View pointerEvents="none" style={[{ position: "absolute", overflow: "hidden" }, frameStyle]}>
      <Animated.View style={[{ position: "absolute" }, pictureStyle]}>
        {/* Until the picture is on the phone, its frame holds its place. */}
        {loaded ? null : <View style={StyleSheet.absoluteFill} className="bg-control" />}
        {file.uri ? (
          <Image
            source={file.uri}
            contentFit="cover"
            transition={0}
            accessible={false}
            style={StyleSheet.absoluteFill}
            onLoad={({ source }) => {
              setLoaded(true);
              if (source.width > 0 && source.height > 0)
                onSize(attachment.id, { width: source.width, height: source.height });
            }}
          />
        ) : null}
      </Animated.View>
    </Animated.View>
  );
}
