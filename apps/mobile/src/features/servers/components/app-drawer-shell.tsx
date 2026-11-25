import { BlurView } from "expo-blur";
import { type Href, router, usePathname } from "expo-router";
import { useThemeColor } from "heroui-native/hooks";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { AppDrawerShownOnUIContext } from "@/features/servers/components/app-drawer-activity";
import { ServerDrawerContent } from "@/features/servers/components/server-drawer-content";
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { haptics } from "@/shared/lib/haptics";
import { useReducedMotion } from "@/shared/lib/motion";
import { isAndroid } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { END_X } from "@/shared/lib/text-direction";

interface AppDrawerContextValue {
  openDrawer: () => void;
  closeDrawer: () => void;
  openingGesture: PanGesture;
  setOpeningBlocked: (blocked: boolean) => void;
}

const AppDrawerContext = createContext<AppDrawerContextValue | null>(null);
const DRAWER_SURFACE_MIN_RADIUS = 34;
const DRAWER_SURFACE_ROUNDING_PROGRESS = 0.15;
const NAVIGATE_AT_PROGRESS = 0.05;
const DRAWER_SPRING = {
  dampingRatio: 0.8,
  duration: 300,
  overshootClamping: true,
  reduceMotion: ReduceMotion.System,
} as const;
const DRAWER_SURFACE_ELEVATION = 16;

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
  const activeServerId = useMobileWorkspaceSelector((current) => current.activeServer.id);
  const servers = useMobileWorkspaceSelector((current) => current.servers);
  const localServerKind = useMobileWorkspaceSelector((current) => current.localServerKind);
  const { leaveServer, removeServer, deleteLocalServer, setServerHidden, reorderServers, selectServer } =
    useMobileWorkspaceActions();
  const [muted] = useThemeColor(["muted"]);
  const reducedMotion = useReducedMotion();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerSettled, setDrawerSettled] = useState(false);
  const [drawerPhase, setDrawerPhase] = useState<DrawerPhase>("closed");
  const drawerShownOnUI = useSharedValue(false);
  const drawerProgress = useSharedValue(0);
  const startInset = END_X === 1 ? insets.left : insets.right;
  const endInset = END_X === 1 ? insets.right : insets.left;
  const drawerWidth = Math.min(360, Math.max(280, width - endInset - 52));
  const drawerSideInset = Math.max(startInset, 18);
  const surfaceCornerRadius = Math.max(DRAWER_SURFACE_MIN_RADIUS, insets.top, insets.right, insets.bottom, insets.left);

  const drawerOpenOnUI = useSharedValue(false);
  const commitDrawerState = useCallback((open: boolean) => {
    setDrawerOpen(open);
    if (!open) setDrawerSettled(false);
  }, []);
  const settleDrawer = useCallback(() => setDrawerSettled(true), []);
  const pendingServerId = useRef<string | null>(null);
  const selectPendingServer = useCallback(() => {
    const serverId = pendingServerId.current;
    pendingServerId.current = null;
    if (serverId) selectServer(serverId);
  }, [selectServer]);
  const finishOpening = useCallback(
    (finished?: boolean) => {
      "worklet";
      if (!finished) return;
      scheduleOnRN(settleDrawer);
      scheduleOnRN(selectPendingServer);
    },
    [selectPendingServer, settleDrawer],
  );
  const finishClosing = useCallback(
    (finished?: boolean) => {
      "worklet";
      if (!finished) return;
      drawerOpenOnUI.set(false);
      scheduleOnRN(commitDrawerState, false);
      scheduleOnRN(selectPendingServer);
    },
    [commitDrawerState, drawerOpenOnUI, selectPendingServer],
  );

  const pendingHref = useRef<Href | null>(null);
  const pushPendingHref = useCallback(() => {
    const href = pendingHref.current;
    pendingHref.current = null;
    if (href) router.push(href);
  }, []);
  useEffect(
    () => () => {
      pendingHref.current = null;
    },
    [],
  );
  const navigatePending = useSharedValue(false);
  useAnimatedReaction(
    () => navigatePending.get() && drawerProgress.get() <= NAVIGATE_AT_PROGRESS,
    (ready, before) => {
      if (!ready || before) return;
      navigatePending.set(false);
      scheduleOnRN(pushPendingHref);
    },
  );
  const finishClosingAndNavigate = useCallback(
    (finished?: boolean) => {
      "worklet";
      finishClosing(finished);
      if (!navigatePending.get()) return;
      navigatePending.set(false);
      scheduleOnRN(pushPendingHref);
    },
    [finishClosing, navigatePending, pushPendingHref],
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
    pendingHref.current = null;
    pendingServerId.current = null;
    drawerOpenOnUI.set(false);
    setDrawerOpen(false);
    setDrawerSettled(false);
    drawerProgress.set(0);
  }, [drawerOpenOnUI, drawerProgress, session]);

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
      activeOffsetX: 12 * END_X,
      failOffsetX: -10 * END_X,
      failOffsetY: [-10, 10],
      onUpdate: (event) => {
        "worklet";
        drawerProgress.set(Math.min(1, Math.max(0, (event.translationX * END_X) / drawerWidth)));
      },
      onDeactivate: (event) => {
        "worklet";
        const velocity = (event.velocityX * END_X) / drawerWidth;
        const projected = drawerProgress.get() + velocity / 6;
        const shouldOpen = projected > 0.45;
        if (shouldOpen) {
          drawerOpenOnUI.set(true);
          scheduleOnRN(triggerDrawerHaptic);
          scheduleOnRN(commitDrawerState, true);
        }
        drawerProgress.set(
          withSpring(shouldOpen ? 1 : 0, { ...DRAWER_SPRING, velocity }, shouldOpen ? finishOpening : undefined),
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
        .activeOffsetX(-8 * END_X)
        .failOffsetX(12 * END_X)
        .failOffsetY([-12, 12])
        .onUpdate((event) => {
          drawerProgress.set(Math.min(1, Math.max(0, 1 + (event.translationX * END_X) / drawerWidth)));
        })
        .onEnd((event) => {
          const velocity = (event.velocityX * END_X) / drawerWidth;
          const projected = drawerProgress.get() + velocity / 6;
          const shouldOpen = projected > 0.55;
          if (!shouldOpen) scheduleOnRN(triggerDrawerHaptic);
          drawerProgress.set(
            withSpring(shouldOpen ? 1 : 0, { ...DRAWER_SPRING, velocity }, shouldOpen ? finishOpening : finishClosing),
          );
        }),
    [drawerOpenOnUI, drawerProgress, drawerWidth, finishClosing, finishOpening],
  );

  const surfaceStyle = useAnimatedStyle(() =>
    isAndroid
      ? { transform: [{ translateX: drawerProgress.get() * drawerWidth * END_X }] }
      : {
          borderRadius: interpolate(
            drawerProgress.get(),
            [0, DRAWER_SURFACE_ROUNDING_PROGRESS],
            [0, surfaceCornerRadius],
            Extrapolation.CLAMP,
          ),
          transform: [{ translateX: drawerProgress.get() * drawerWidth * END_X }],
        },
  );
  const androidSurfaceEdgeStyle = useAnimatedStyle(() => {
    const shown = drawerProgress.get() > 0;
    return { borderRadius: shown ? surfaceCornerRadius : 0, elevation: shown ? DRAWER_SURFACE_ELEVATION : 0 };
  });
  const drawerStyle = useAnimatedStyle(() => ({
    opacity: isAndroid && drawerProgress.get() <= 0 ? 0 : interpolate(drawerProgress.get(), [0, 1], [0.55, 1]),
    transform: [{ translateX: interpolate(drawerProgress.get(), [0, 1], [-24 * END_X, 0]) }],
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
      if (pendingHref.current) return;
      if (!drawerOpenOnUI.get() || reducedMotion) {
        closeDrawer();
        router.push(href);
        return;
      }
      pendingHref.current = href;
      navigatePending.set(true);
      triggerDrawerHaptic();
      drawerProgress.set(withSpring(0, DRAWER_SPRING, finishClosingAndNavigate));
    },
    [closeDrawer, drawerOpenOnUI, drawerProgress, finishClosingAndNavigate, navigatePending, reducedMotion],
  );

  const selectServerAndClose = useCallback(
    (serverId: string) => {
      if (!drawerOpenOnUI.get()) {
        selectServer(serverId);
        return;
      }
      pendingServerId.current = serverId;
      closeDrawer();
    },
    [closeDrawer, drawerOpenOnUI, selectServer],
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
              renderToHardwareTextureAndroid={isAndroid && drawerPhase === "moving"}
            >
              <ServerDrawerContent
                activeServerId={activeServerId}
                muted={muted}
                open={drawerSettled}
                servers={servers}
                session={session}
                sideInset={drawerSideInset}
                topInset={insets.top}
                onNavigate={navigateAfterClosing}
                onLeave={leaveServer}
                onRemove={removeServer}
                onDelete={deleteLocalServer}
                onSetHidden={setServerHidden}
                localServerKind={localServerKind}
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
                          boxShadow: `${-12 * END_X}px 0 32px rgba(0, 0, 0, 0.28)`,
                        },
                        surfaceStyle,
                      ]
                }
              >
                <Animated.View collapsable={false} className="flex-1" style={contentTouchStyle}>
                  {children}
                </Animated.View>
                <Animated.View
                  className="absolute inset-0"
                  style={scrimTouchStyle}
                  accessibilityElementsHidden={!drawerOpen}
                  importantForAccessibility={drawerOpen ? "auto" : "no-hide-descendants"}
                >
                  {isAndroid ? null : (
                    <Animated.View className="absolute inset-0" pointerEvents="none" style={blurStyle}>
                      <BlurView intensity={5} style={{ flex: 1 }} tint="systemThickMaterial" />
                    </Animated.View>
                  )}
                  <Animated.View className="absolute inset-0 bg-drawer-scrim" pointerEvents="none" style={scrimStyle} />
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
    </AppDrawerContext.Provider>
  );
}

export function useAppDrawer(): AppDrawerContextValue {
  const value = useContext(AppDrawerContext);
  if (!value) throw new Error("useAppDrawer must be used within AppDrawerShell.");
  return value;
}
