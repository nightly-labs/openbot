import type { MobileReleaseNoteGroup, MobileReleaseNotes } from "@openbot/contracts/mobile-features";
import { Button, Spinner, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { type PropsWithChildren, type ReactNode, useState } from "react";
import { Linking, Pressable, View } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { MOBILE_CHANGELOG_URL, useAppUpdateNotes } from "@/features/app-update/model/app-update";
import { BLOUB_RADIUS } from "@/shared/components/bloub-stage/bloub-look";
import { SheetScrollEdgeEffect } from "@/shared/components/sheet-scroll-edge-effect";
import { useReducedMotion } from "@/shared/lib/motion";
import { type MobileText, useText } from "@/shared/lib/text";

const DATE_FORMAT: Intl.DateTimeFormatOptions = { dateStyle: "medium" };
/** The space between the block's edge and the first note. */
const NOTES_TOP_GAP = 20;
/** The depth of the blur under the block's edge, below its round corners. */
const EDGE_BLUR = 56;
// A line fades, lifts and shrinks over this distance as it goes under the edge, and rises into
// place over it as it comes in at the bottom: about two lines of text.
const ROW_FADE = 44;
const ROW_LIFT = 4;
const ROW_RISE = 6;
const ROW_SCALE = 0.985;
/** A line at the bottom keeps a little of its text, so the list reads as one that goes on. */
const ROW_BOTTOM_OPACITY = 0.2;

interface RowScroll {
  scrollY: SharedValue<number>;
  /** The visible height of the panel; 0 until it is measured. */
  viewport: SharedValue<number>;
  reduced: boolean;
}

/**
 * One line of the notes. Its place in the panel sets its look on the UI thread: clear in the middle,
 * and fading, lifting and shrinking a little at the top and the bottom. `baseY` is the place of the
 * parent in the scroll content, for a line inside an item.
 */
function ScrollRow({
  scroll,
  baseY,
  className,
  children,
}: PropsWithChildren<{ scroll: RowScroll; baseY?: SharedValue<number>; className?: string }>) {
  const { scrollY, viewport, reduced } = scroll;
  const y = useSharedValue(0);
  const height = useSharedValue(0);
  const style = useAnimatedStyle(() => {
    const visible = viewport.get();
    if (visible === 0) return { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }] };
    const center = (baseY?.get() ?? 0) + y.get() - scrollY.get() + height.get() / 2;
    const top = interpolate(center, [BLOUB_RADIUS, BLOUB_RADIUS + ROW_FADE], [0, 1], Extrapolation.CLAMP);
    const bottom = interpolate(center, [visible - ROW_FADE, visible], [1, 0], Extrapolation.CLAMP);
    const shown = Math.min(top, bottom);
    const opacity = Math.min(top, ROW_BOTTOM_OPACITY + (1 - ROW_BOTTOM_OPACITY) * bottom);
    if (reduced) return { opacity, transform: [{ translateY: 0 }, { scale: 1 }] };
    return {
      opacity,
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

/** The dot and the gap before the text of an item. */
const ITEM_TEXT_INSET = 16;

/**
 * One item, line by line. A hidden copy of the text gives the lines as the screen wraps them, and
 * each line follows the scroll on its own, so only the lines at an edge move. Until the lines are
 * known, the item shows as one block. A screen reader reads the whole item once.
 */
function NoteItem({ item, scroll, dot }: { item: string; scroll: RowScroll; dot: string }) {
  const itemY = useSharedValue(0);
  const [lines, setLines] = useState<{ start: number; text: string }[] | null>(null);
  const dotView = <View className="mt-[9px] size-1.5 rounded-full" style={{ backgroundColor: dot }} />;
  return (
    <View
      accessible
      accessibilityLabel={item}
      className="mb-2.5"
      onLayout={(event) => itemY.set(event.nativeEvent.layout.y)}
    >
      <View pointerEvents="none" style={{ position: "absolute", left: ITEM_TEXT_INSET, right: 0, opacity: 0 }}>
        <Typography.Paragraph
          className="text-text-secondary"
          onTextLayout={(event) => {
            // Each line keeps its place in the item, which also names it.
            let start = 0;
            const next = event.nativeEvent.lines.map((line) => {
              const entry = { start, text: line.text.trimEnd() };
              start += line.text.length;
              return entry;
            });
            setLines((current) =>
              current?.length === next.length &&
              current.every((line, index) => line.start === next[index]?.start && line.text === next[index]?.text)
                ? current
                : next,
            );
          }}
        >
          {item}
        </Typography.Paragraph>
      </View>
      {lines ? (
        lines.map((line) => (
          <ScrollRow key={line.start} scroll={scroll} baseY={itemY} className="flex-row gap-2.5">
            {line.start === 0 ? dotView : <View className="size-1.5" />}
            <Typography.Paragraph numberOfLines={1} ellipsizeMode="clip" className="flex-1 text-text-secondary">
              {line.text}
            </Typography.Paragraph>
          </ScrollRow>
        ))
      ) : (
        <ScrollRow scroll={scroll} baseY={itemY} className="flex-row gap-2.5">
          {dotView}
          <Typography.Paragraph className="flex-1 text-text-secondary">{item}</Typography.Paragraph>
        </ScrollRow>
      )}
    </View>
  );
}

function groupTitle(t: MobileText["t"], group: MobileReleaseNoteGroup): string {
  switch (group.type) {
    case "notice":
      return t("mobile.app.update.group.notice");
    case "added":
      return t("mobile.app.update.group.added");
    case "changed":
      return t("mobile.app.update.group.changed");
    case "fixed":
      return t("mobile.app.update.group.fixed");
    case "removed":
      return t("mobile.app.update.group.removed");
    case "deprecated":
      return t("mobile.app.update.group.deprecated");
    case "security":
      return t("mobile.app.update.group.security");
    default:
      return group.heading;
  }
}

/** The notes as one row for each title and item, so each row can follow the scroll on its own. */
function releaseRows(
  releases: readonly MobileReleaseNotes[],
  scroll: RowScroll,
  dot: string,
  text: Pick<MobileText, "t" | "format">,
): ReactNode[] {
  const { t, format } = text;
  return releases.flatMap((release, index) => {
    const date = new Date(`${release.date}T00:00:00`);
    const heading = (
      <ScrollRow key={`release-${release.version}`} scroll={scroll} className={index > 0 ? "mt-8" : undefined}>
        <Typography.Heading type="h4" accessibilityRole="header">
          {t("mobile.app.update.releaseTitle", { version: release.version })}
        </Typography.Heading>
        {Number.isNaN(date.getTime()) ? null : (
          <Typography.Paragraph type="body-sm" className="text-muted">
            {format.date(date, DATE_FORMAT)}
          </Typography.Paragraph>
        )}
      </ScrollRow>
    );
    const groups = release.groups.flatMap((group) => {
      const groupKey = `${release.version}-${group.type}-${group.heading}`;
      return [
        <ScrollRow key={groupKey} scroll={scroll} className="mt-5 mb-2">
          <Typography.Paragraph type="body-sm" className="font-semibold text-muted">
            {groupTitle(t, group)}
          </Typography.Paragraph>
        </ScrollRow>,
        ...group.items.map((item) => <NoteItem key={`${groupKey}-${item}`} item={item} scroll={scroll} dot={dot} />),
      ];
    });
    return [heading, ...groups];
  });
}

/**
 * The release notes on the surface of the screen, under the update header. They slide down from
 * behind the block's edge over the list, and back up when they close. Their top lies under the
 * block's round corners. They load when they open.
 */
export function AppUpdateNotes({
  open,
  expanded,
  top,
  height,
}: {
  /** 0 is closed behind the block, 1 open over the list. */
  open: SharedValue<number>;
  expanded: boolean;
  top: number;
  /** From `top` to the bottom of home. */
  height: number;
}) {
  const { t, format } = useText();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const scrollY = useSharedValue(0);
  const viewport = useSharedValue(0);
  const scroll: RowScroll = { scrollY, viewport, reduced };
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.set(event.contentOffset.y);
  });
  const [foreground, muted] = useThemeColor(["foreground", "muted"]);
  const notes = useAppUpdateNotes(expanded);
  const style = useAnimatedStyle(() => ({
    // Closed, the panel hides: a scrolled list moves the block's edge above the panel's place.
    opacity: open.get() > 0 ? 1 : 0,
    transform: [{ translateY: -(1 - open.get()) * height }],
  }));
  const openChangelog = () => void Linking.openURL(MOBILE_CHANGELOG_URL).catch(() => undefined);

  return (
    <Animated.View
      pointerEvents={expanded ? "auto" : "none"}
      accessibilityElementsHidden={!expanded}
      importantForAccessibility={expanded ? "auto" : "no-hide-descendants"}
      className="bg-background"
      style={[{ position: "absolute", left: 0, right: 0, top, height }, style]}
    >
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={onScroll}
        // The home indicator covers the last points, so a row fades out above it.
        onLayout={(event) => viewport.set(event.nativeEvent.layout.height - insets.bottom / 2)}
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: BLOUB_RADIUS + NOTES_TOP_GAP,
          paddingBottom: insets.bottom + 24,
        }}
      >
        {notes.isPending ? (
          <View className="items-center py-8">
            <Spinner size="sm" color={String(muted)} />
          </View>
        ) : notes.isError ? (
          <View className="items-center gap-3 py-6">
            <Typography.Paragraph align="center" className="text-text-secondary">
              {t("mobile.app.update.notesFailed")}
            </Typography.Paragraph>
            <Button size="sm" variant="secondary" onPress={() => void notes.refetch()}>
              <Button.Label>{t("common.tryAgain")}</Button.Label>
            </Button>
          </View>
        ) : notes.data.length === 0 ? (
          <Typography.Paragraph align="center" className="py-6 text-text-secondary">
            {t("mobile.app.update.notesEmpty")}
          </Typography.Paragraph>
        ) : (
          releaseRows(notes.data, scroll, String(foreground), { t, format })
        )}
        <ScrollRow scroll={scroll} className="mt-6 items-center">
          <Pressable
            accessibilityRole="link"
            hitSlop={8}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            onPress={openChangelog}
          >
            <Typography.Paragraph type="body-sm" className="font-medium text-muted">
              {t("mobile.app.update.fullChangelog")}
            </Typography.Paragraph>
          </Pressable>
        </ScrollRow>
      </Animated.ScrollView>
      {/* The rows blur as they go under the block's edge, as the list does under the bar. */}
      <SheetScrollEdgeEffect
        style={{ position: "absolute", top: 0, left: 0, right: 0, height: BLOUB_RADIUS + EDGE_BLUR }}
      />
    </Animated.View>
  );
}
