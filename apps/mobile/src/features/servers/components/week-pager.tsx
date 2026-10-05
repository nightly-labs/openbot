import {
  addCalendarDays,
  type CalendarDay,
  calendarDays,
  calendarWeekStart,
} from "@openbot/team-client/routine-calendar-dates";
import { Typography } from "heroui-native";
import { useEffect, useRef, useState } from "react";
import { FlatList, Pressable, View } from "react-native";

const WEEK_MS = 7 * 86_400_000;
/** Two years each side of the first week. A week further away is reached again from the header menu. */
const PAGE_RADIUS = 104;
const PAGES = Array.from({ length: 2 * PAGE_RADIUS + 1 }, (_, index) => index);

interface WeekPagerProps {
  /** A day of the week that shows. */
  anchor: CalendarDay;
  today: CalendarDay;
  /** The highlighted day, or null when no single day is open. */
  selected: CalendarDay | null;
  /** Runs for each day. A day without an entry has no mark. */
  counts: ReadonlyMap<CalendarDay, number>;
  weekdayText: (day: CalendarDay) => string;
  dayNumberText: (day: CalendarDay) => string;
  dayLabel: (day: CalendarDay, count: number) => string;
  onSelectDay: (day: CalendarDay) => void;
  /** After a swipe settles on another week, with the first day of that week. */
  onWeekChange: (weekStart: CalendarDay) => void;
}

/** Weeks side by side: a swipe moves one week, and a tap selects a day. */
export function WeekPager({
  anchor,
  today,
  selected,
  counts,
  weekdayText,
  dayNumberText,
  dayLabel,
  onSelectDay,
  onWeekChange,
}: WeekPagerProps) {
  const [width, setWidth] = useState(0);
  const list = useRef<FlatList<number>>(null);
  // Page indexes count from the week that showed first, so they stay fixed while the sheet is open.
  const [origin] = useState(() => calendarWeekStart(anchor, 1));
  const weekStart = calendarWeekStart(anchor, 1);
  const index = Math.min(
    PAGES.length - 1,
    Math.max(0, PAGE_RADIUS + Math.round((Date.parse(weekStart) - Date.parse(origin)) / WEEK_MS)),
  );
  const shown = useRef(index);

  // A week that changes without a swipe, from a day tap or the header menu, scrolls into place.
  useEffect(() => {
    if (!width || shown.current === index) return;
    shown.current = index;
    list.current?.scrollToIndex({ index, animated: true });
  }, [index, width]);

  const pageStart = (page: number) => addCalendarDays(origin, (page - PAGE_RADIUS) * 7);

  return (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {width ? (
        <FlatList
          ref={list}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          data={PAGES}
          extraData={[selected, counts, today]}
          keyExtractor={String}
          initialScrollIndex={index}
          initialNumToRender={1}
          maxToRenderPerBatch={2}
          windowSize={3}
          getItemLayout={(_, page) => ({ length: width, offset: width * page, index: page })}
          onMomentumScrollEnd={(event) => {
            const page = Math.round(event.nativeEvent.contentOffset.x / width);
            if (page === shown.current) return;
            shown.current = page;
            onWeekChange(pageStart(page));
          }}
          renderItem={({ item }) => (
            <View className="flex-row" style={{ width }}>
              {calendarDays(pageStart(item), 7).map((day) => {
                const isSelected = day === selected;
                const count = counts.get(day) ?? 0;
                return (
                  <Pressable
                    key={day}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    accessibilityLabel={dayLabel(day, count)}
                    className={`flex-1 items-center gap-1 rounded-grouped py-2 ${isSelected ? "bg-grouped" : ""}`}
                    onPress={() => onSelectDay(day)}
                  >
                    <Typography type="body-xs" className="text-grouped-secondary">
                      {weekdayText(day)}
                    </Typography>
                    <Typography
                      weight={day === today || isSelected ? "semibold" : undefined}
                      className={
                        day === today ? "text-accent-text" : day < today ? "text-grouped-secondary" : undefined
                      }
                    >
                      {dayNumberText(day)}
                    </Typography>
                    <View className={`size-1 rounded-full ${count > 0 ? "bg-grouped-secondary" : ""}`} />
                  </Pressable>
                );
              })}
            </View>
          )}
        />
      ) : null}
    </View>
  );
}
