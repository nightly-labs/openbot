import { BlurView } from "expo-blur";
import { type Href, router, usePathname } from "expo-router";
import { useThemeColor } from "heroui-native/hooks";
import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";
import {
  Gesture,
  GestureDetector,
  GestureStateManager,
  type PanGesture,
  type PanGestureConfig,
  usePanGesture,
} from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  ReduceMotion,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { AppDrawerShownContext, AppDrawerShownOnUIContext } from "@/features/servers/components/app-drawer-activity";
import { ServerDrawerContent } from "@/features/servers/components/server-drawer-content";
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";

interface AppDrawerContextValue {
  openDrawer: () => void;
  closeDrawer: () => void;
  openingGesture: PanGesture;
  /** Turns off the pan that opens the drawer, for a screen whose own horizontal pans need it. */
  setOpeningBlocked: (blocked: boolean) => void;
}

const AppDrawerContext = createContext<AppDrawerContextValue | null>(null);
const DRAWER_SURFACE_MIN_RADIUS = 34;
// The surface reaches its full corner radius after this part of the opening motion.
const DRAWER_SURFACE_ROUNDING_PROGRESS = 0.15;
const DRAWER_SPRING = {
  dampingRatio: 0.8,
  duration: 300,
  overshootClamping: true,
  reduceMotion: ReduceMotion.System,
} as const;
/**
 * Android: the elevation that replaces the surface's box shadow. Android draws a box shadow with a
 * blur filter on each frame of the motion; it draws an elevation shadow on the render thread.
 */
const DRAWER_SURFACE_ELEVATION = 16;

/** Where the drawer is: at its closed place, between its places, or at its open place. */
type DrawerPhase = "closed" | "moving" | "open";

function triggerDrawerHaptic(): void {
  void haptics.impact();
}

export function AppDrawerShell({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { session } = useMobileSession();
  const { t } = useText();
  // The shell holds every screen, so it reads only what the drawer shows: a change elsewhere in the
  // workspace does not render the drawer again.
  const activeServerId = useMobileWorkspaceSelector((current) => current.activeServer.id);
  const servers = useMobileWorkspaceSelector((current) => current.servers);
  const { leaveServer, removeServer, reorderServers, selectServer } = useMobileWorkspaceActions();
  const [muted] = useThemeColor(["muted"]);
  // The accessibility state of the drawer. It changes when the drawer starts to open and when it has closed.
  const [drawerOpen, setDrawerOpen] = useState(false);
  // The drawer reads its values from the host only after its opening motion: each answer renders the
  // drawer again, and a render during the motion drops frames on Android.
  const [drawerSettled, setDrawerSettled] = useState(false);
  const [drawerPhase, setDrawerPhase] = useState<DrawerPhase>("closed");
  const drawerShownOnUI = useSharedValue(false);
  const drawerProgress = useSharedValue(0);
  // The surface stays in view at the right, clear of a right inset (the iPhone Duo rail).
  const drawerWidth = Math.min(360, Math.max(280, width - insets.right - 52));
  const drawerSideInset = Math.max(insets.left, 18);
  const surfaceCornerRadius = Math.max(DRAWER_SURFACE_MIN_RADIUS, insets.top, insets.right, insets.bottom, insets.left);

  const drawerOpenOnUI = useSharedValue(false);
  const commitDrawerState = useCallback((open: boolean) => {
    setDrawerOpen(open);
    if (!open) setDrawerSettled(false);
  }, []);
  const settleDrawer = useCallback(() => setDrawerSettled(true), []);
  const finishOpening = useCallback(
    (finished?: boolean) => {
      "worklet";
      if (finished) scheduleOnRN(settleDrawer);
    },
    [settleDrawer],
  );
  const finishClosing = useCallback(
    (finished?: boolean) => {
      "worklet";
      if (!finished) return;
      drawerOpenOnUI.set(false);
      scheduleOnRN(commitDrawerState, false);
    },
    [commitDrawerState, drawerOpenOnUI],
  );

  const openDrawer = useCallback(() => {
    triggerDrawerHaptic();
    drawerOpenOnUI.set(true);
    setDrawerOpen(true);
    drawerProgress.set(withSpring(1, DRAWER_SPRING, finishOpening));
  }, [drawerOpenOnUI, drawerProgress, finishOpening]);

  const closeDrawer = useCallback(() => {
    if (!drawerOpenOnUI.get()) return;
    triggerDrawerHaptic();
    drawerProgress.set(withSpring(0, DRAWER_SPRING, finishClosing));
  }, [drawerOpenOnUI, drawerProgress, finishClosing]);

  useEffect(() => {
    if (session) return;
    drawerOpenOnUI.set(false);
    setDrawerOpen(false);
    setDrawerSettled(false);
    drawerProgress.set(0);
  }, [drawerOpenOnUI, drawerProgress, session]);

  // The phase changes only at the closed and open places, so React renders twice for each motion and
  // not on each frame.
  useAnimatedReaction(
    (): DrawerPhase => {
      const progress = drawerProgress.get();
      return progress <= 0 ? "closed" : progress >= 1 ? "open" : "moving";
    },
    (phase, previous) => {
      if (phase === previous) return;
      drawerShownOnUI.set(phase !== "closed");
      scheduleOnRN(setDrawerPhase, phase);
    },
  );

  // Rows attach their swipe to this gesture, so it must stay the same object. A new gesture on each
  // navigation or drawer change would rebuild the swipe of every row. ReanimatedSwipeable relations
  // accept only hook gestures. The memoized config keeps the gesture object stable, so its callbacks
  // need the worklet directive.
  const openingEnabled = useSharedValue(false);
  const [openingBlocked, setOpeningBlocked] = useState(false);
  useEffect(() => {
    openingEnabled.set(!openingBlocked && pathname === "/connected");
  }, [openingBlocked, openingEnabled, pathname]);
  const openingConfig = useMemo<PanGestureConfig>(
    () => ({
      onTouchesDown: (event) => {
        "worklet";
        if (!openingEnabled.get() || drawerOpenOnUI.get()) GestureStateManager.fail(event.handlerTag);
      },
      activeOffsetX: 12,
      failOffsetX: -10,
      failOffsetY: [-10, 10],
      onUpdate: (event) => {
        "worklet";
        drawerProgress.set(Math.min(1, Math.max(0, event.translationX / drawerWidth)));
      },
      onDeactivate: (event) => {
        "worklet";
        const projected = drawerProgress.get() + event.velocityX / drawerWidth / 6;
        const shouldOpen = projected > 0.45;
        if (shouldOpen) {
          drawerOpenOnUI.set(true);
          scheduleOnRN(triggerDrawerHaptic);
          scheduleOnRN(commitDrawerState, true);
        }
        drawerProgress.set(
          withSpring(
            shouldOpen ? 1 : 0,
            { ...DRAWER_SPRING, velocity: event.velocityX / drawerWidth },
            shouldOpen ? finishOpening : undefined,
          ),
        );
      },
    }),
    [commitDrawerState, drawerOpenOnUI, drawerProgress, drawerWidth, finishOpening, openingEnabled],
  );
  const openingGesture = usePanGesture(openingConfig);

  const closingGesture = useMemo(
    () =>
      Gesture.Pan()
        .onTouchesDown((_event, manager) => {
          if (!drawerOpenOnUI.get()) manager.fail();
        })
        .activeOffsetX(-8)
        .failOffsetX(12)
        .failOffsetY([-12, 12])
        .onUpdate((event) => {
          drawerProgress.set(Math.min(1, Math.max(0, 1 + event.translationX / drawerWidth)));
        })
        .onEnd((event) => {
          const projected = drawerProgress.get() + event.velocityX / drawerWidth / 6;
          const shouldOpen = projected > 0.55;
          if (!shouldOpen) scheduleOnRN(triggerDrawerHaptic);
          drawerProgress.set(
            withSpring(
              shouldOpen ? 1 : 0,
              { ...DRAWER_SPRING, velocity: event.velocityX / drawerWidth },
              // A drag that started before the opening motion ended stopped that motion and its callback.
              shouldOpen ? finishOpening : finishClosing,
            ),
          );
        }),
    [drawerOpenOnUI, drawerProgress, drawerWidth, finishClosing, finishOpening],
  );

  const surfaceStyle = useAnimatedStyle(() =>
    isAndroid
      ? { transform: [{ translateX: drawerProgress.get() * drawerWidth }] }
      : {
          borderRadius: interpolate(
            drawerProgress.get(),
            [0, DRAWER_SURFACE_ROUNDING_PROGRESS],
            [0, surfaceCornerRadius],
            Extrapolation.CLAMP,
          ),
          transform: [{ translateX: drawerProgress.get() * drawerWidth }],
        },
  );
  // Android: the radius and the shadow change only when the drawer leaves or reaches its closed place.
  // A radius that changes on each frame clips the whole surface again on each frame. This style has
  // no value that changes on each frame, so Reanimated sends it only at those two places.
  const androidSurfaceEdgeStyle = useAnimatedStyle(() => {
    const shown = drawerProgress.get() > 0;
    return { borderRadius: shown ? surfaceCornerRadius : 0, elevation: shown ? DRAWER_SURFACE_ELEVATION : 0 };
  });
  const drawerStyle = useAnimatedStyle(() => ({
    // Android: a closed drawer lies fully under the surface. At opacity 0, Android does not draw it.
    opacity: isAndroid && drawerProgress.get() <= 0 ? 0 : interpolate(drawerProgress.get(), [0, 1], [0.55, 1]),
    transform: [{ translateX: interpolate(drawerProgress.get(), [0, 1], [-24, 0]) }],
  }));
  const scrimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(drawerProgress.get(), [0, 1], [0, 0.5]),
  }));
  const blurStyle = useAnimatedStyle(() => ({
    opacity: drawerProgress.get(),
  }));
  const scrimTouchStyle = useAnimatedStyle(() => ({
    pointerEvents: drawerOpenOnUI.get() ? "auto" : "none",
  }));
  const contentTouchStyle = useAnimatedStyle(() => ({
    pointerEvents: drawerOpenOnUI.get() || drawerProgress.get() > 0 ? "none" : "auto",
  }));

  const navigateAfterClosing = useCallback(
    (href: Href) => {
      closeDrawer();
      setTimeout(() => router.push(href), 300);
    },
    [closeDrawer],
  );

  const selectServerAndClose = useCallback(
    (serverId: string) => {
      selectServer(serverId);
      closeDrawer();
    },
    [closeDrawer, selectServer],
  );

  const contextValue = useMemo(
    () => ({ closeDrawer, openDrawer, openingGesture, setOpeningBlocked }),
    [closeDrawer, openDrawer, openingGesture],
  );

  if (!session) {
    return <AppDrawerContext.Provider value={contextValue}>{children}</AppDrawerContext.Provider>;
  }

  return (
    <AppDrawerContext.Provider value={contextValue}>
      <AppDrawerShownContext.Provider value={drawerPhase !== "closed"}>
        <AppDrawerShownOnUIContext.Provider value={drawerShownOnUI}>
          <GestureDetector gesture={closingGesture}>
            <View className="flex-1 bg-sidebar">
              <Animated.View
                style={[
                  {
                    bottom: 0,
                    left: 0,
                    paddingBottom: Math.max(insets.bottom, 12),
                    paddingLeft: drawerSideInset,
                    position: "absolute",
                    top: 0,
                    width: drawerWidth,
                  },
                  drawerStyle,
                ]}
                accessibilityElementsHidden={!drawerOpen}
                importantForAccessibility={drawerOpen ? "auto" : "no-hide-descendants"}
                // Android: while the drawer moves, its fading content draws from one cached layer.
                renderToHardwareTextureAndroid={isAndroid && drawerPhase === "moving"}
              >
                <ServerDrawerContent
                  activeServerId={activeServerId}
                  muted={muted}
                  open={drawerSettled}
                  servers={servers}
                  session={session}
                  topInset={insets.top}
                  onNavigate={navigateAfterClosing}
                  onLeave={leaveServer}
                  onRemove={removeServer}
                  onReorder={reorderServers}
                  onSelectServer={selectServerAndClose}
                />
              </Animated.View>

              <GestureDetector gesture={openingGesture}>
                <Animated.View
                  className="flex-1 overflow-hidden bg-background"
                  style={
                    isAndroid
                      ? [{ borderCurve: "continuous" }, androidSurfaceEdgeStyle, surfaceStyle]
                      : [
                          {
                            borderCurve: "continuous",
                            boxShadow: "-12px 0 32px rgba(0, 0, 0, 0.28)",
                          },
                          surfaceStyle,
                        ]
                  }
                >
                  <Animated.View collapsable={false} className="flex-1" style={contentTouchStyle}>
                    {children}
                  </Animated.View>
                  <Animated.View className="absolute inset-0" style={scrimTouchStyle}>
                    {/* Android: without a blur method this view is only a tint, one more full-screen layer to
                    draw on each frame. The scrim keeps the dimming. */}
                    {isAndroid ? null : (
                      <Animated.View className="absolute inset-0" pointerEvents="none" style={blurStyle}>
                        <BlurView intensity={5} style={{ flex: 1 }} tint="systemThickMaterial" />
                      </Animated.View>
                    )}
                    <Animated.View
                      className="absolute inset-0 bg-drawer-scrim"
                      pointerEvents="none"
                      style={scrimStyle}
                    />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("mobile.server.drawer.close")}
                      className="flex-1"
                      onPress={closeDrawer}
                    />
                  </Animated.View>
                </Animated.View>
              </GestureDetector>
            </View>
          </GestureDetector>
        </AppDrawerShownOnUIContext.Provider>
      </AppDrawerShownContext.Provider>
    </AppDrawerContext.Provider>
  );
}

export function useAppDrawer(): AppDrawerContextValue {
  const value = useContext(AppDrawerContext);
  if (!value) throw new Error("useAppDrawer must be used within AppDrawerShell.");
  return value;
}
