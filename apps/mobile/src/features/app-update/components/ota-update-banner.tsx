import type { MobileReleaseNotes } from "@openbot/contracts/mobile-features";
import { StatusBar } from "expo-status-bar";
import { Button, Spinner, Typography } from "heroui-native";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import { type PropsWithChildren, useCallback, useEffect, useState } from "react";
import { BackHandler, Linking, Pressable, useWindowDimensions, View } from "react-native";
import Animated, {
  Easing,
  type SharedValue,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { showFailureAlert } from "@/features/analytics/failure-reports";
import { groupTitle, NoteItem } from "@/features/app-update/components/app-update-notes";
import {
  type AppUpdate,
  dismissAppUpdate,
  installAppUpdate,
  MOBILE_CHANGELOG_URL,
  newestReleaseVersion,
  rememberShownOtaNotes,
  useOtaUpdateNotes,
} from "@/features/app-update/model/app-update";
import { BloubEyes, EYES_HEIGHT, EYES_WIDTH } from "@/shared/components/bloub-stage/bloub-eyes";
import { BLOUB_MOVE, bloubGradient, useBloubColors } from "@/shared/components/bloub-stage/bloub-look";
import type { LargeTitleScroll } from "@/shared/components/large-title";
import { haptics } from "@/shared/lib/haptics";
import { currentAppVersion } from "@/shared/lib/mobile-features";
import { useReducedMotion } from "@/shared/lib/motion";
import { currentText, useText } from "@/shared/lib/text";

export type ReadyAppUpdate = Extract<AppUpdate, { kind: "ready" }>;

const LATER_FILL = "rgba(4, 0, 7, 0.09)";
const ACTION_STYLE = { height: 40, borderRadius: 999, paddingHorizontal: 18 };
const BLOCK_RADIUS = 28;
const LIST_GAP = 12;
const TOP_GAP = 2;
const BOTTOM_PADDING = 20;
const NOTES_GAP = 12;
const NOTES_BOTTOM_GAP = 8;
const NOTES_PREVIEW = 132;
const TOGGLE_ESTIMATE = 28;
const NOTES_MAX_SHARE = 0.42;
const EDGE_FADE = 56;
const EDGE_INSET = 4;
const ROW_LIFT = 4;
const ROW_RISE = 6;
const ROW_SCALE = 0.985;
const EYES_SCALE = 0.3;
const UPDATE_ID_LENGTH = 8;
const REVEAL = { duration: 420, easing: Easing.bezier(0.32, 0.72, 0, 1) };
const GROUP_ORDER = ["notice", "security", "added", "changed", "fixed", "removed", "deprecated"];

type MovingPart = "drop" | "reveal" | "notes";

export interface OtaUpdateBanner {
  update: ReadyAppUpdate | null;
  shown: boolean;
  pushDown: SharedValue<number>;
  moving: boolean;
  setMoving: (part: MovingPart, moving: boolean) => void;
  clear: () => void;
}

export function useOtaUpdateBanner(update: ReadyAppUpdate | null): OtaUpdateBanner {
  const pushDown = useSharedValue(0);
  const [latched, setLatched] = useState(update);
  if (update && update.id !== latched?.id) setLatched(update);
  const [movingParts, setMovingParts] = useState<readonly MovingPart[]>([]);
  const setMoving = useCallback((part: MovingPart, moving: boolean) => {
    setMovingParts((current) => {
      if (current.includes(part) === moving) return current;
      return moving ? [...current, part] : current.filter((entry) => entry !== part);
    });
  }, []);
  const clear = useCallback(() => {
    setMovingParts([]);
    setLatched(null);
  }, []);
  return { update: latched, shown: update !== null, pushDown, moving: movingParts.length > 0, setMoving, clear };
}

export function OtaUpdateSpacer({ banner }: { banner: OtaUpdateBanner }) {
  const { pushDown } = banner;
  const style = useAnimatedStyle(() => ({ height: pushDown.get() }));
  if (!banner.update) return null;
  return <Animated.View style={style} />;
}

function mergedGroups(releases: readonly MobileReleaseNotes[] | undefined) {
  const groups = new Map<string, { type: string; heading: string; items: string[] }>();
  for (const release of releases ?? []) {
    for (const group of release.groups) {
      const entry = groups.get(group.type) ?? { type: group.type, heading: group.heading, items: [] };
      for (const item of group.items) if (!entry.items.includes(item)) entry.items.push(item);
      groups.set(group.type, entry);
    }
  }
  const rank = (type: string) => {
    const index = GROUP_ORDER.indexOf(type);
    return index === -1 ? GROUP_ORDER.length : index;
  };
  return [...groups.values()].sort((left, right) => rank(left.type) - rank(right.type));
}

function updateLabel(update: ReadyAppUpdate): string {
  const version = currentAppVersion();
  const id = update.updateId?.slice(0, UPDATE_ID_LENGTH);
  return [version, id].filter((part): part is string => Boolean(part)).join(" · ");
}

interface RowScroll {
  scrollY: SharedValue<number>;
  viewport: SharedValue<number>;
  below: SharedValue<number>;
  reduced: boolean;
}

function edgeFade(distance: number, zone: number): number {
  "worklet";
  if (zone <= EDGE_INSET) return distance >= 0 ? 1 : 0;
  const linear = Math.min(1, Math.max(0, (distance - EDGE_INSET) / (zone - EDGE_INSET)));
  return linear * linear * (3 - 2 * linear);
}

function ScrollRow({
  scroll,
  baseY,
  className,
  children,
}: PropsWithChildren<{ scroll: RowScroll; baseY?: SharedValue<number>; className?: string }>) {
  const { scrollY, viewport, below, reduced } = scroll;
  const y = useSharedValue(0);
  const height = useSharedValue(0);
  const style = useAnimatedStyle(() => {
    const visible = viewport.get();
    if (visible === 0) return { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }] };
    const offset = scrollY.get();
    const rowTop = (baseY?.get() ?? 0) + y.get() - offset;
    const top = edgeFade(rowTop, Math.min(EDGE_FADE, Math.max(0, offset) + NOTES_GAP));
    const bottom = edgeFade(
      visible - rowTop - height.get(),
      Math.min(EDGE_FADE, Math.max(0, below.get()) + NOTES_BOTTOM_GAP),
    );
    const shown = Math.min(top, bottom);
    if (reduced) return { opacity: shown, transform: [{ translateY: 0 }, { scale: 1 }] };
    return {
      opacity: shown,
      transform: [
        { translateY: -(1 - top) * ROW_LIFT + (1 - bottom) * ROW_RISE },
        { scale: ROW_SCALE + (1 - ROW_SCALE) * shown },
      ],
    };
  });
  return (
    <Animated.View
      className={className}
      style={style}
      onLayout={(event) => {
        y.set(event.nativeEvent.layout.y);
        height.set(event.nativeEvent.layout.height);
      }}
    >
      {children}
    </Animated.View>
  );
}

function NotesStatus({
  loading,
  failed,
  retry,
  color,
}: {
  loading: boolean;
  failed: boolean;
  retry: () => void;
  color: string;
}) {
  const { t } = useText();
  if (loading) {
    return (
      <View accessible accessibilityLabel={t("common.loading")} className="flex-row items-center py-1">
        <Spinner size="sm" color={color} />
      </View>
    );
  }
  if (!failed) return null;
  return (
    <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1 py-1">
      <Typography.Paragraph type="body-sm" style={{ color, opacity: 0.7 }}>
        {t("mobile.app.update.notesFailed")}
      </Typography.Paragraph>
      <Pressable accessibilityRole="button" hitSlop={8} onPress={retry}>
        <Typography.Paragraph type="body-sm" className="font-semibold" style={{ color }}>
          {t("common.tryAgain")}
        </Typography.Paragraph>
      </Pressable>
    </View>
  );
}

function UpdateEyes({ color, active, reduced }: { color: string; active: boolean; reduced: boolean }) {
  const gazeX = useSharedValue(0);
  const gazeY = useSharedValue(0);
  const box = { width: EYES_WIDTH * EYES_SCALE, height: EYES_HEIGHT * EYES_SCALE };
  return (
    <View style={box}>
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          position: "absolute",
          width: EYES_WIDTH,
          height: EYES_HEIGHT,
          left: (box.width - EYES_WIDTH) / 2,
          top: (box.height - EYES_HEIGHT) / 2,
          transform: [{ scale: EYES_SCALE }],
        }}
      >
        <BloubEyes mood="idle" active={active} reduced={reduced} gazeX={gazeX} gazeY={gazeY} eyeColor={color} />
      </View>
    </View>
  );
}

export function OtaUpdateBlock({
  banner,
  scroll,
  hidden,
}: {
  banner: OtaUpdateBanner;
  scroll: LargeTitleScroll;
  hidden: boolean;
}) {
  const { t } = useText();
  const colors = useBloubColors();
  const reduced = useReducedMotion();
  const window = useWindowDimensions();
  const { update, shown, pushDown, clear, setMoving } = banner;
  const notes = useOtaUpdateNotes(update !== null && update.updateId !== null);
  const [installing, setInstalling] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [natural, setNatural] = useState(-1);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [toggleHeight, setToggleHeight] = useState(0);
  const [footerHeight, setFooterHeight] = useState(0);
  const [placed, setPlaced] = useState(false);
  const [underStatusBar, setUnderStatusBar] = useState(false);
  const drop = useSharedValue(0);
  const reveal = useSharedValue(0);
  const contentHeight = useSharedValue(0);
  const scrollY = useSharedValue(0);
  const scrollRef = useAnimatedRef<Animated.ScrollView>();

  const groups = mergedGroups(update?.updateId ? notes.data : undefined);
  const count = groups.reduce((sum, group) => sum + group.items.length, 0);
  const loading = notes.isPending && notes.fetchStatus !== "idle";
  const failed = notes.isError;
  const hasNotes = loading || failed || count > 0;
  const maxNotes = Math.round(window.height * NOTES_MAX_SHARE);
  const canExpand = natural > NOTES_PREVIEW;
  const scrolls = natural > maxNotes;
  const measured = placed || (headerHeight > 0 && footerHeight > 0 && natural >= 0);
  if (measured && !placed) setPlaced(true);
  const top = scroll.headerHeight + TOP_GAP;
  const fixed = top + headerHeight + (canExpand ? toggleHeight || TOGGLE_ESTIMATE : 0) + footerHeight + BOTTOM_PADDING;
  const barHeight = scroll.headerHeight;
  const newestNotes = notes.data ? newestReleaseVersion(notes.data) : null;

  const clipHeight = useDerivedValue(() => {
    const full = contentHeight.get();
    const closed = Math.min(full, NOTES_PREVIEW);
    return closed + (Math.min(full, maxNotes) - closed) * reveal.get();
  });
  const below = useDerivedValue(() => contentHeight.get() - clipHeight.get() - scrollY.get());
  const rows: RowScroll = { scrollY, viewport: clipHeight, below, reduced };

  useAnimatedReaction(
    () => {
      const total = fixed + clipHeight.get();
      const bottom = total - (1 - drop.get()) * (total + 20) - Math.max(0, scroll.scrolled.get());
      return measured && bottom > scroll.barTop;
    },
    (next, previous) => {
      if (next !== previous) scheduleOnRN(setUnderStatusBar, next);
    },
  );
  useAnimatedReaction(
    () => (measured ? drop.get() * Math.max(0, fixed + clipHeight.get() - barHeight + LIST_GAP) : 0),
    (next) => pushDown.set(next),
  );
  useEffect(() => () => pushDown.set(0), [pushDown]);

  useEffect(() => {
    if (!update || !measured) return;
    if (reduced) {
      drop.set(shown ? 1 : 0);
      if (!shown) clear();
      return;
    }
    setMoving("drop", true);
    drop.set(
      withTiming(shown ? 1 : 0, BLOUB_MOVE, (finished) => {
        if (!finished) return;
        if (shown) scheduleOnRN(setMoving, "drop", false);
        else scheduleOnRN(clear);
      }),
    );
  }, [clear, drop, measured, reduced, setMoving, shown, update]);

  useEffect(() => {
    const updateId = update?.updateId;
    if (shown && updateId && newestNotes) void rememberShownOtaNotes(updateId, newestNotes).catch(() => undefined);
  }, [newestNotes, shown, update?.updateId]);
  useEffect(() => {
    if (reduced || reveal.get() === (expanded ? 1 : 0)) reveal.set(expanded ? 1 : 0);
    else {
      setMoving("reveal", true);
      reveal.set(
        withTiming(expanded ? 1 : 0, REVEAL, (finished) => {
          if (finished) scheduleOnRN(setMoving, "reveal", false);
        }),
      );
    }
    if (!expanded) scrollRef.current?.scrollTo({ y: 0, animated: !reduced });
  }, [expanded, reduced, reveal, scrollRef, setMoving]);
  useEffect(() => {
    if ((!canExpand || !shown) && expanded) setExpanded(false);
  }, [canExpand, expanded, shown]);
  useEffect(() => {
    if (!expanded) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      setExpanded(false);
      return true;
    });
    return () => subscription.remove();
  }, [expanded]);

  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.set(event.contentOffset.y);
  });
  const blockStyle = useAnimatedStyle(() => ({
    opacity: measured && !hidden ? 1 : 0,
    transform: [
      { translateY: -(1 - drop.get()) * (fixed + clipHeight.get() + 20) - Math.max(0, scroll.scrolled.get()) },
    ],
  }));
  const clipStyle = useAnimatedStyle(() => ({ height: clipHeight.get() }));
  const chevronStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${reveal.get() * 180}deg` }] }));

  if (!update) return null;

  const measureNotes = (height: number) => {
    setNatural(height);
    if (contentHeight.get() === 0 || reduced) {
      contentHeight.set(height);
      return;
    }
    setMoving("notes", true);
    contentHeight.set(
      withTiming(height, REVEAL, (finished) => {
        if (finished) scheduleOnRN(setMoving, "notes", false);
      }),
    );
  };
  const toggle = () => {
    void haptics.impact("soft");
    setExpanded(!expanded);
  };
  const install = () => {
    void haptics.impact("light");
    setInstalling(true);
    installAppUpdate(update, colors.dark ? colors.dimBody : colors.body).catch((error: unknown) => {
      setInstalling(false);
      const { t: text } = currentText();
      showFailureAlert(error, "update", text("mobile.app.update.failedTitle"), text("mobile.app.update.restartFailed"));
    });
  };
  const later = () => {
    void haptics.impact("soft");
    setExpanded(false);
    void dismissAppUpdate(update).catch(() => undefined);
  };
  const label = updateLabel(update);

  return (
    <Animated.View
      pointerEvents={hidden || !shown ? "none" : "box-none"}
      style={[
        {
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          paddingTop: top,
          paddingBottom: BOTTOM_PADDING,
          borderBottomLeftRadius: BLOCK_RADIUS,
          borderBottomRightRadius: BLOCK_RADIUS,
          borderCurve: "continuous",
          overflow: "hidden",
          backgroundColor: colors.body,
          experimental_backgroundImage: bloubGradient(colors.light, colors.body),
        },
        blockStyle,
      ]}
    >
      {underStatusBar && !hidden ? <StatusBar style="dark" /> : null}
      <View
        className="flex-row items-center gap-3 px-5"
        onLayout={(event) => setHeaderHeight(event.nativeEvent.layout.height)}
      >
        <UpdateEyes color={colors.eye} active={!hidden} reduced={reduced} />
        <View className="flex-1">
          <Typography.Heading type="h4" accessibilityRole="header" style={{ color: colors.eye }}>
            {t("mobile.app.update.quickTitle")}
          </Typography.Heading>
          <Typography.Paragraph type="body-sm" style={{ color: colors.eye, opacity: 0.62 }}>
            {hasNotes ? label : [label, t("mobile.app.update.readyBody")].filter(Boolean).join(" · ")}
          </Typography.Paragraph>
        </View>
      </View>
      <Animated.View style={clipStyle}>
        <Animated.ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          scrollEnabled={expanded && scrolls}
          showsVerticalScrollIndicator={expanded && scrolls}
          alwaysBounceVertical={false}
          scrollEventThrottle={16}
          onScroll={onScroll}
          onContentSizeChange={(_, height) => measureNotes(height)}
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingTop: hasNotes ? NOTES_GAP : 0,
            paddingBottom: hasNotes ? NOTES_BOTTOM_GAP : 0,
          }}
        >
          <NotesStatus loading={loading} failed={failed} retry={() => void notes.refetch()} color={colors.eye} />
          {groups.flatMap((group, index) => [
            <ScrollRow key={`heading-${group.type}`} scroll={rows} className={index > 0 ? "mt-2.5 mb-1" : "mb-1"}>
              <Typography.Paragraph
                type="body-xs"
                accessibilityRole="header"
                className="font-semibold uppercase tracking-openbot-wide"
                style={{ color: colors.eye, opacity: 0.55 }}
              >
                {groupTitle(t, group)}
              </Typography.Paragraph>
            </ScrollRow>,
            ...group.items.map((item) => (
              <NoteItem
                key={`${group.type}-${item}`}
                item={item}
                dot={colors.eye}
                textColor={colors.eye}
                compact
                renderRow={(row) => (
                  <ScrollRow key={row.key} scroll={rows} baseY={row.baseY} className={row.className}>
                    {row.children}
                  </ScrollRow>
                )}
              />
            )),
          ])}
          {count > 0 && canExpand ? (
            <ScrollRow scroll={rows} className="mt-2 mb-1 self-start">
              <Pressable
                accessibilityRole="link"
                hitSlop={8}
                style={({ pressed }) => ({ opacity: pressed ? 0.35 : 0.6 })}
                onPress={() => void Linking.openURL(MOBILE_CHANGELOG_URL).catch(() => undefined)}
              >
                <Typography.Paragraph type="body-sm" className="font-medium underline" style={{ color: colors.eye }}>
                  {t("mobile.app.update.fullChangelog")}
                </Typography.Paragraph>
              </Pressable>
            </ScrollRow>
          ) : null}
        </Animated.ScrollView>
      </Animated.View>
      {canExpand ? (
        <View className="px-5 pt-2" onLayout={(event) => setToggleHeight(event.nativeEvent.layout.height)}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            hitSlop={8}
            className="flex-row items-center gap-1 self-start"
            style={({ pressed }) => ({ opacity: pressed ? 0.45 : 1 })}
            onPress={toggle}
          >
            <Typography.Paragraph type="body-sm" className="font-semibold" style={{ color: colors.eye }}>
              {expanded
                ? t("mobile.app.update.showLess")
                : count === 1
                  ? t("mobile.app.update.showMore")
                  : t("mobile.app.update.showAll", { count })}
            </Typography.Paragraph>
            <Animated.View style={chevronStyle}>
              <ChevronDown size={16} color={colors.eye} strokeWidth={2.2} />
            </Animated.View>
          </Pressable>
        </View>
      ) : null}
      <View className="flex-row gap-2 px-5 pt-4" onLayout={(event) => setFooterHeight(event.nativeEvent.layout.height)}>
        <Button
          size="sm"
          variant="ghost"
          feedbackVariant="scale"
          isDisabled={installing}
          style={[ACTION_STYLE, { backgroundColor: colors.eye }]}
          onPress={install}
        >
          {installing ? <Spinner size="sm" color={colors.body} /> : null}
          <Button.Label className="font-sans font-semibold" style={{ color: colors.body }}>
            {t("mobile.app.update.restart")}
          </Button.Label>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          feedbackVariant="scale"
          isDisabled={installing}
          style={[ACTION_STYLE, { backgroundColor: LATER_FILL }]}
          onPress={later}
        >
          <Button.Label className="font-sans font-semibold" style={{ color: colors.eye }}>
            {t("mobile.app.update.later")}
          </Button.Label>
        </Button>
      </View>
    </Animated.View>
  );
}
