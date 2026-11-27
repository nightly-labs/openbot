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
const NOTES_TOP_GAP = 20;
const EDGE_BLUR = 56;
const ROW_FADE = 44;
const ROW_LIFT = 4;
const ROW_RISE = 6;
const ROW_SCALE = 0.985;
const ROW_BOTTOM_OPACITY = 0.2;

interface RowScroll {
  scrollY: SharedValue<number>;
  viewport: SharedValue<number>;
  reduced: boolean;
}

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

const ITEM_TEXT_INSET = 16;

export interface NoteLineRow {
  key: number;
  baseY: SharedValue<number>;
  className: string;
  children: ReactNode;
}

export function NoteItem({
  item,
  dot,
  textColor,
  compact = false,
  renderRow,
}: {
  item: string;
  dot: string;
  textColor?: string;
  compact?: boolean;
  renderRow: (row: NoteLineRow) => ReactNode;
}) {
  const itemY = useSharedValue(0);
  const [lines, setLines] = useState<{ start: number; text: string }[] | null>(null);
  const type = compact ? "body-sm" : "body";
  const textClassName = textColor ? "flex-1" : "flex-1 text-text-secondary";
  const textStyle = textColor ? { color: textColor } : undefined;
  const dotView = (
    <View
      className={compact ? "mt-[8px] size-1.5 rounded-full" : "mt-[9px] size-1.5 rounded-full"}
      style={{ backgroundColor: dot }}
    />
  );
  return (
    <View
      accessible
      accessibilityLabel={item}
      className={compact ? "mb-1.5" : "mb-2.5"}
      onLayout={(event) => itemY.set(event.nativeEvent.layout.y)}
    >
      <View pointerEvents="none" style={{ position: "absolute", left: ITEM_TEXT_INSET, right: 0, opacity: 0 }}>
        <Typography.Paragraph
          type={type}
          className="text-text-secondary"
          onTextLayout={(event) => {
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
      {lines
        ? lines.map((line) =>
            renderRow({
              key: line.start,
              baseY: itemY,
              className: "flex-row gap-2.5",
              children: (
                <>
                  {line.start === 0 ? dotView : <View className="size-1.5" />}
                  <Typography.Paragraph
                    type={type}
                    numberOfLines={1}
                    ellipsizeMode="clip"
                    className={textClassName}
                    style={textStyle}
                  >
                    {line.text}
                  </Typography.Paragraph>
                </>
              ),
            }),
          )
        : renderRow({
            key: -1,
            baseY: itemY,
            className: "flex-row gap-2.5",
            children: (
              <>
                {dotView}
                <Typography.Paragraph type={type} className={textClassName} style={textStyle}>
                  {item}
                </Typography.Paragraph>
              </>
            ),
          })}
    </View>
  );
}

export function groupTitle(t: MobileText["t"], group: MobileReleaseNoteGroup): string {
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
        ...group.items.map((item) => (
          <NoteItem
            key={`${groupKey}-${item}`}
            item={item}
            dot={dot}
            renderRow={(row) => (
              <ScrollRow key={row.key} scroll={scroll} baseY={row.baseY} className={row.className}>
                {row.children}
              </ScrollRow>
            )}
          />
        )),
      ];
    });
    return [heading, ...groups];
  });
}

export function AppUpdateNotes({
  open,
  expanded,
  top,
  height,
}: {
  open: SharedValue<number>;
  expanded: boolean;
  top: number;
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
      <SheetScrollEdgeEffect
        style={{ position: "absolute", top: 0, left: 0, right: 0, height: BLOUB_RADIUS + EDGE_BLUR }}
      />
    </Animated.View>
  );
}
