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
import { END_X } from "@/shared/lib/text-direction";

const SPLIT_MIN_WIDTH = 700;
const PANE_MIN_WIDTH = 320;
const PANE_MAX_WIDTH = 400;
const PANE_WIDTH_FRACTION = 0.36;
const PANE_DRAG_MAX_WIDTH = 520;
const DETAIL_MIN_WIDTH = 380;
const PANE_RAIL_WIDTH = 76;
const HANDLE_WIDTH = 24;
const RESIZE_STEP = 40;
const PANE_EASE = Easing.bezier(0.23, 1, 0.32, 1);

export interface SplitLayout {
  mode: SplitPaneMode;
  paneWidth: number;
  listWidth: number;
  foldWidth: number;
  detailWidth: number;
}

const SplitLayoutContext = createContext<SplitLayout | null>(null);
const SplitPaneMotionContext = createContext<{ shownWidth: SharedValue<number>; railWidth: number } | null>(null);
const ColumnWidthContext = createContext<number | null>(null);

export function useSplitLayout(): SplitLayout | null {
  return use(SplitLayoutContext);
}

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

  const shownWidth = useSharedValue(paneWidth);
  const dragStart = useSharedValue(0);
  const dragging = useSharedValue(false);
  const lastPreference = useRef(preference);
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
      shownWidth.set(Math.min(limit, Math.max(railWidth, dragStart.get() + event.translationX * END_X)));
    })
    .onEnd((event) => {
      "worklet";
      const released = shownWidth.get() + event.velocityX * END_X * 0.08;
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

export function AdaptiveSplit({
  enabled,
  pane,
  resizeLabel,
  children,
}: {
  enabled: boolean;
  pane: ReactNode;
  resizeLabel: string;
  children: ReactNode;
}) {
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
