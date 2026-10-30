import { isRunningInExpoGo } from "expo";
import { createContext, type ReactNode, use, useEffect, useMemo, useRef } from "react";
import { type AccessibilityActionEvent, StyleSheet, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  ReduceMotion,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { ReservedRegionsProvider, useReservedRegions } from "react-native-reserved-regions";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { type SplitPaneMode, setSplitPanePreference, useSplitPanePreference } from "@/shared/lib/split-pane-preference";

/**
 * The narrowest window that shows the pane beside the detail. iPad in portrait and landscape and the
 * open iPhone Duo are wider. A phone, the folded iPhone Duo, and each half of Split View (469 pt on
 * iPhone Duo, up to about 680 pt on iPad) keep one column.
 */
const SPLIT_MIN_WIDTH = 700;
const PANE_MIN_WIDTH = 320;
const PANE_MAX_WIDTH = 400;
const PANE_WIDTH_FRACTION = 0.36;
/** The widest list that a drag gives, and the width that the detail always keeps. */
const PANE_DRAG_MAX_WIDTH = 520;
const DETAIL_MIN_WIDTH = 380;
/** The pane with avatars only, without the side inset of the window. */
const PANE_RAIL_WIDTH = 76;
/** The touch area of the divider, which a drag resizes or collapses the pane with. */
const HANDLE_WIDTH = 24;
const RESIZE_STEP = 40;
const PANE_EASE = Easing.bezier(0.23, 1, 0.32, 1);

/** Where the pane ends and the detail starts, in window points. */
export interface SplitLayout {
  mode: SplitPaneMode;
  /** The width of the pane now: the list, or the rail of avatars. */
  paneWidth: number;
  /** The width of the list when it shows. */
  listWidth: number;
  /** The width of the fold between the two columns, or 0 when no fold divides the window. */
  foldWidth: number;
  /** The width that the window gives the detail column. */
  detailWidth: number;
}

const SplitLayoutContext = createContext<SplitLayout | null>(null);
/** The width of the pane as it shows on the UI thread, which follows a drag and the animations. */
const SplitPaneMotionContext = createContext<{ shownWidth: SharedValue<number>; railWidth: number } | null>(null);
/** The width of the column that holds a view: the pane, the detail, or the whole window. */
const ColumnWidthContext = createContext<number | null>(null);

/** The split that shows now, or null when the window has one column. */
export function useSplitLayout(): SplitLayout | null {
  return use(SplitLayoutContext);
}

/**
 * The width of the column that holds the caller. Use it in place of the window width for a view that
 * sizes itself, as the pane is narrower than the window.
 */
export function useColumnWidth(): number {
  const { width } = useWindowDimensions();
  return use(ColumnWidthContext) ?? width;
}

interface Fold {
  x: number;
  width: number;
}

function listWidthLimit(width: number): number {
  return Math.max(PANE_MIN_WIDTH, Math.min(PANE_DRAG_MAX_WIDTH, width - DETAIL_MIN_WIDTH));
}

/**
 * The split for a window. A vertical fold, as on the open iPhone Duo or an Android foldable, ends the
 * list, so neither column lies across it. Without a fold, the list takes a part of the window, or the
 * width that the user dragged it to. The rail leaves the detail across the fold.
 */
function splitFor(
  width: number,
  fold: Fold | null,
  mode: SplitPaneMode,
  draggedWidth: number | null,
  railInset: number,
): SplitLayout | null {
  if (width < SPLIT_MIN_WIDTH) return null;
  const foldSplits = fold !== null && fold.x >= PANE_MIN_WIDTH && width - fold.x - fold.width >= PANE_MIN_WIDTH;
  const listWidth = foldSplits
    ? fold.x
    : Math.round(
        Math.min(
          listWidthLimit(width),
          Math.max(PANE_MIN_WIDTH, draggedWidth ?? Math.min(PANE_MAX_WIDTH, width * PANE_WIDTH_FRACTION)),
        ),
      );
  const paneWidth = mode === "list" ? listWidth : PANE_RAIL_WIDTH + railInset;
  const foldWidth = mode === "list" && foldSplits ? fold.width : 0;
  return { mode, paneWidth, listWidth, foldWidth, detailWidth: width - paneWidth - foldWidth };
}

/** The pane after a drag ends at a width: the rail of avatars, or the list. */
function modeAt(paneWidth: number, railWidth: number): SplitPaneMode {
  "worklet";
  return paneWidth < (railWidth + PANE_MIN_WIDTH) / 2 ? "rail" : "list";
}

interface SplitColumnsProps {
  enabled: boolean;
  pane: ReactNode;
  resizeLabel: string;
  children: ReactNode;
}

/** The columns beside the vertical fold that `ReservedRegionsProvider` reports. */
function FoldSplitColumns(props: SplitColumnsProps) {
  const division = useReservedRegions().find(
    (region) => region.kind === "division" && region.frame.height > region.frame.width,
  );
  const fold = division ? { x: division.frame.x, width: division.frame.width } : null;
  return <SplitColumns {...props} fold={fold} />;
}

function SplitColumns({ enabled, pane, resizeLabel, children, fold }: SplitColumnsProps & { fold: Fold | null }) {
  const { width } = useWindowDimensions();
  const windowInsets = useSafeAreaInsets();
  const preference = useSplitPanePreference();
  const railWidth = PANE_RAIL_WIDTH + windowInsets.left;
  const split = enabled ? splitFor(width, fold, preference.mode, preference.width, windowInsets.left) : null;
  const splitShown = split !== null;
  const paneWidth = split?.paneWidth ?? 0;
  const listWidth = split?.listWidth ?? 0;
  const foldWidth = split?.foldWidth ?? 0;
  const mode = split?.mode ?? "list";
  const limit = listWidthLimit(width);

  // The pane follows a drag on the UI thread. A change of mode or a drag that ends moves it to its
  // place; a turn of the device or a fold puts it there at once.
  const shownWidth = useSharedValue(paneWidth);
  const dragStart = useSharedValue(0);
  const dragging = useSharedValue(false);
  const lastPreference = useRef(preference);
  // The width that a drag already animates to on the UI thread. Its commit must not start the
  // animation again from React.
  const settledOnUI = useRef<number | null>(null);
  useEffect(() => {
    const chosen = lastPreference.current !== preference;
    lastPreference.current = preference;
    const animating = settledOnUI.current === paneWidth;
    settledOnUI.current = null;
    if (chosen && animating) return;
    shownWidth.set(
      chosen
        ? withTiming(paneWidth, { duration: 280, easing: PANE_EASE, reduceMotion: ReduceMotion.System })
        : paneWidth,
    );
  }, [paneWidth, preference, shownWidth]);

  // Only the result of a drag goes to React, to keep it. The pane animates to its place on the UI
  // thread from the frame the finger lifts.
  const commit = (next: SplitPaneMode, nextWidth: number | null, target: number) => {
    const changed = next !== mode || nextWidth !== preference.width;
    settledOnUI.current = changed ? target : null;
    if (changed) setSplitPanePreference({ mode: next, width: nextWidth });
  };

  const foldX = fold ? fold.x : null;
  const draggedWidth = preference.width;
  const resize = Gesture.Pan()
    .activeOffsetX([-6, 6])
    .onStart(() => {
      "worklet";
      dragStart.set(shownWidth.get());
      dragging.set(true);
    })
    .onUpdate((event) => {
      "worklet";
      shownWidth.set(Math.min(limit, Math.max(railWidth, dragStart.get() + event.translationX)));
    })
    .onEnd((event) => {
      "worklet";
      // A flick goes on a little past the finger, so a quick swipe collapses or opens the pane.
      const released = shownWidth.get() + event.velocityX * 0.08;
      const next = modeAt(released, railWidth);
      const nextWidth =
        next === "list" && foldX === null
          ? Math.round(Math.min(limit, Math.max(PANE_MIN_WIDTH, released)))
          : draggedWidth;
      const target = next === "rail" ? railWidth : (foldX ?? nextWidth ?? listWidth);
      shownWidth.set(withTiming(target, { duration: 280, easing: PANE_EASE, reduceMotion: ReduceMotion.System }));
      dragging.set(false);
      scheduleOnRN(commit, next, nextWidth, target);
    });

  const onResizeAction = (event: AccessibilityActionEvent) => {
    const wider = event.nativeEvent.actionName === "increment";
    if (mode === "rail") {
      if (wider) setSplitPanePreference({ mode: "list" });
      return;
    }
    if (fold) {
      if (!wider) setSplitPanePreference({ mode: "rail" });
      return;
    }
    const next = listWidth + (wider ? RESIZE_STEP : -RESIZE_STEP);
    if (next < PANE_MIN_WIDTH) setSplitPanePreference({ mode: "rail" });
    else setSplitPanePreference({ width: Math.min(limit, next) });
  };

  const paneStyle = useAnimatedStyle(() => ({ width: shownWidth.get() }));
  const handleStyle = useAnimatedStyle(() => ({ left: shownWidth.get() - HANDLE_WIDTH / 2 }));
  const grabberStyle = useAnimatedStyle(() => ({
    opacity: withTiming(dragging.get() ? 1 : 0, { duration: 160, reduceMotion: ReduceMotion.System }),
  }));
  const motion = useMemo(() => ({ shownWidth, railWidth }), [shownWidth, railWidth]);
  const splitValue = useMemo(
    () => (splitShown ? { mode, paneWidth, listWidth, foldWidth, detailWidth: width - paneWidth - foldWidth } : null),
    [splitShown, mode, paneWidth, listWidth, foldWidth, width],
  );

  // The detail keeps its place among the children in all layouts, so the navigation in it stays
  // mounted, with its screens and their state, when the device folds or the window changes size.
  return (
    <SplitLayoutContext value={splitValue}>
      {splitShown ? (
        <Animated.View key="pane" style={[styles.clip, paneStyle]}>
          <SplitPaneMotionContext value={motion}>
            <SafeAreaProvider style={styles.column}>{pane}</SafeAreaProvider>
          </SplitPaneMotionContext>
        </Animated.View>
      ) : null}
      {splitShown ? (
        <View
          key="divider"
          className={foldWidth > 0 ? "bg-background" : "bg-border"}
          style={{ width: foldWidth > 0 ? foldWidth : StyleSheet.hairlineWidth }}
        />
      ) : null}
      <View key="detail" style={styles.column}>
        <ColumnWidthContext value={splitValue?.detailWidth ?? null}>
          {/* Each column has its own safe area: the rail of iPhone Duo and the side insets of
              landscape touch only the column at that edge. */}
          <SafeAreaProvider style={styles.column}>{children}</SafeAreaProvider>
        </ColumnWidthContext>
      </View>
      {splitShown ? (
        <GestureDetector key="handle" gesture={resize}>
          <Animated.View
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={resizeLabel}
            accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
            onAccessibilityAction={onResizeAction}
            style={[styles.handle, handleStyle]}
          >
            <Animated.View className="h-10 w-1 rounded-full bg-muted" style={grabberStyle} />
          </Animated.View>
        </GestureDetector>
      ) : null}
    </SplitLayoutContext>
  );
}

/**
 * The two forms of the pane: the list, and the rail of its avatars. Both stay mounted, so a drag or a
 * change of mode crosses from one to the other with the width, without a swap. The list never lays
 * out narrower than its minimum width: the pane clips it, and it fades out as the rail fades in.
 */
export function SplitPaneLayers({ list, rail }: { list: ReactNode; rail: ReactNode }) {
  const split = useSplitLayout();
  const motion = use(SplitPaneMotionContext);
  const fallbackWidth = useSharedValue(0);
  const shownWidth = motion?.shownWidth ?? fallbackWidth;
  const railWidth = motion?.railWidth ?? PANE_RAIL_WIDTH;
  const listStyle = useAnimatedStyle(() => {
    const width = shownWidth.get();
    return {
      width: Math.max(width, PANE_MIN_WIDTH),
      opacity: interpolate(width, [railWidth, PANE_MIN_WIDTH], [0, 1], Extrapolation.CLAMP),
    };
  });
  const railStyle = useAnimatedStyle(() => {
    const width = shownWidth.get();
    return {
      opacity: interpolate(width, [railWidth, (railWidth + PANE_MIN_WIDTH) / 2], [1, 0], Extrapolation.CLAMP),
      transform: [{ translateX: interpolate(width, [railWidth, PANE_MIN_WIDTH], [0, -12], Extrapolation.CLAMP) }],
    };
  });
  if (!split || !motion) return list;
  const listShown = split.mode === "list";
  return (
    <View style={styles.column}>
      <Animated.View
        style={[styles.layer, listStyle]}
        pointerEvents={listShown ? "auto" : "none"}
        accessibilityElementsHidden={!listShown}
        importantForAccessibility={listShown ? "auto" : "no-hide-descendants"}
      >
        <ColumnWidthContext value={split.listWidth}>{list}</ColumnWidthContext>
      </Animated.View>
      <Animated.View
        style={[styles.layer, { width: railWidth }, railStyle]}
        pointerEvents={listShown ? "none" : "auto"}
        accessibilityElementsHidden={listShown}
        importantForAccessibility={listShown ? "no-hide-descendants" : "auto"}
      >
        <ColumnWidthContext value={railWidth}>{rail}</ColumnWidthContext>
      </Animated.View>
    </View>
  );
}

/**
 * A pane beside the main content on a wide window, such as a list beside the item it opened. On a
 * narrow window only the main content shows. The main content is never mounted again when the
 * layout changes. A drag on the divider resizes the pane, or collapses it to its rail of avatars.
 */
export function AdaptiveSplit({
  enabled,
  pane,
  resizeLabel,
  children,
}: {
  enabled: boolean;
  pane: ReactNode;
  /** What a screen reader says for the divider, which resizes the pane. */
  resizeLabel: string;
  children: ReactNode;
}) {
  // Expo Go does not include the native `ReservedRegionsView`, so there the window has no fold.
  if (isRunningInExpoGo()) {
    return (
      <View style={styles.row}>
        <SplitColumns enabled={enabled} pane={pane} resizeLabel={resizeLabel} fold={null}>
          {children}
        </SplitColumns>
      </View>
    );
  }
  return (
    <ReservedRegionsProvider style={styles.row}>
      <FoldSplitColumns enabled={enabled} pane={pane} resizeLabel={resizeLabel}>
        {children}
      </FoldSplitColumns>
    </ReservedRegionsProvider>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: "hidden" },
  column: { flex: 1 },
  handle: {
    alignItems: "center",
    bottom: 0,
    justifyContent: "center",
    position: "absolute",
    top: 0,
    width: HANDLE_WIDTH,
    zIndex: 10,
  },
  layer: { bottom: 0, left: 0, position: "absolute", top: 0 },
  row: { flex: 1, flexDirection: "row" },
});
