import { addCalendarDays, type CalendarDay } from "@openbot/team-client/routine-calendar-dates";
import { Typography } from "heroui-native";
import { useEffect, useRef, useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import { haptics } from "@/shared/lib/haptics";

const DAY_MS = 86_400_000;
/** The strip shows this many days at a time. */
export const DAY_STRIP_LENGTH = 7;
/** Two years each side of the first day. A day further away is reached again from the header menu. */
const DAY_RADIUS = 730;
const DAYS = Array.from({ length: 2 * DAY_RADIUS + 1 }, (_, index) => index);

interface DayStripProps {
  /** The first day on screen. */
  start: CalendarDay;
  today: CalendarDay;
  /** The highlighted day, or null when no single day is open. */
  selected: CalendarDay | null;
  /** Runs for each day. A day without an entry has no mark. */
  counts: ReadonlyMap<CalendarDay, number>;
  weekdayText: (day: CalendarDay) => string;
  dayNumberText: (day: CalendarDay) => string;
  dayLabel: (day: CalendarDay, count: number) => string;
  onSelectDay: (day: CalendarDay) => void;
  /**
   * When a swipe moves the first day on screen. It runs during the swipe, so the days load while
   * the finger still moves; the strip then stops on a whole day, not on a whole week.
   */
  onStartChange: (start: CalendarDay) => void;
}

/** Days in a row that a swipe moves one day at a time, with a tick for each day it passes. */
export function DayStrip({
  start,
  today,
  selected,
  counts,
  weekdayText,
  dayNumberText,
  dayLabel,
  onSelectDay,
  onStartChange,
}: DayStripProps) {
  const [width, setWidth] = useState(0);
  const column = width / DAY_STRIP_LENGTH;
  const list = useRef<FlatList<number>>(null);
  // Indexes count from the day that showed first, so they stay fixed while the sheet is open.
  const [origin] = useState(start);
  const index = Math.min(
    DAYS.length - 1,
    Math.max(0, DAY_RADIUS + Math.round((Date.parse(start) - Date.parse(origin)) / DAY_MS)),
  );
  const shown = useRef(index);
  // The first day a scroll from code moves to. The days it passes on the way are not choices.
  const target = useRef<number | null>(null);

  // A start that changes without a swipe, from the header menu or VoiceOver, scrolls into place.
  useEffect(() => {
    if (!column || shown.current === index) return;
    shown.current = index;
    target.current = index;
    list.current?.scrollToOffset({ offset: index * column, animated: true });
  }, [index, column]);

  const dayAt = (item: number) => addCalendarDays(origin, item - DAY_RADIUS);

  return (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {column ? (
        <FlatList
          ref={list}
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={column}
          decelerationRate="fast"
          data={DAYS}
          extraData={[selected, counts, today]}
          keyExtractor={String}
          initialScrollIndex={index}
          // The days on each side are drawn before the swipe reaches them.
          initialNumToRender={DAY_STRIP_LENGTH * 3}
          maxToRenderPerBatch={DAY_STRIP_LENGTH * 2}
          windowSize={5}
          scrollEventThrottle={16}
          getItemLayout={(_, item) => ({ length: column, offset: column * item, index: item })}
          // A finger on the list ends a scroll from code, so the swipe chooses the days again.
          onScrollBeginDrag={() => {
            target.current = null;
          }}
          onScroll={(event) => {
            const item = Math.round(event.nativeEvent.contentOffset.x / column);
            if (item === shown.current || item < 0 || item >= DAYS.length) return;
            // Like a wheel: one tick for each day that passes, from a finger or from code.
            void haptics.selection();
            shown.current = item;
            if (target.current !== null) {
              if (item === target.current) target.current = null;
              return;
            }
            onStartChange(dayAt(item));
          }}
          renderItem={({ item }) => {
            const day = dayAt(item);
            const isSelected = day === selected;
            const count = counts.get(day) ?? 0;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={dayLabel(day, count)}
                className={`items-center gap-1 rounded-grouped py-2 ${isSelected ? "bg-grouped" : ""}`}
                style={{ width: column }}
                onPress={() => onSelectDay(day)}
              >
                <Typography type="body-xs" className="text-grouped-secondary">
                  {weekdayText(day)}
                </Typography>
                <Typography
                  weight={day === today || isSelected ? "semibold" : undefined}
                  className={day === today ? "text-accent-text" : day < today ? "text-grouped-secondary" : undefined}
                >
                  {dayNumberText(day)}
                </Typography>
                <View className={`size-1 rounded-full ${count > 0 ? "bg-grouped-secondary" : ""}`} />
              </Pressable>
            );
          }}
        />
      ) : null}
    </View>
  );
}
