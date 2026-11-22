import { addCalendarDays, type CalendarDay } from "@openbot/team-client/routine-calendar-dates";
import { Typography } from "heroui-native";
import { useEffect, useRef, useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import { haptics } from "@/shared/lib/haptics";

const DAY_MS = 86_400_000;
export const DAY_STRIP_LENGTH = 7;
const DAY_RADIUS = 730;
const DAYS = Array.from({ length: 2 * DAY_RADIUS + 1 }, (_, index) => index);

interface DayStripProps {
  start: CalendarDay;
  today: CalendarDay;
  selected: CalendarDay | null;
  counts: ReadonlyMap<CalendarDay, number>;
  weekdayText: (day: CalendarDay) => string;
  dayNumberText: (day: CalendarDay) => string;
  dayLabel: (day: CalendarDay, count: number) => string;
  onSelectDay: (day: CalendarDay) => void;
  onStartChange: (start: CalendarDay) => void;
}

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
  const [origin] = useState(start);
  const index = Math.min(
    DAYS.length - 1,
    Math.max(0, DAY_RADIUS + Math.round((Date.parse(start) - Date.parse(origin)) / DAY_MS)),
  );
  const shown = useRef(index);
  const target = useRef<number | null>(null);

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
          removeClippedSubviews={false}
          snapToInterval={column}
          decelerationRate="fast"
          data={DAYS}
          extraData={[selected, counts, today]}
          keyExtractor={String}
          initialScrollIndex={index}
          initialNumToRender={DAY_STRIP_LENGTH * 3}
          maxToRenderPerBatch={DAY_STRIP_LENGTH * 2}
          windowSize={5}
          scrollEventThrottle={16}
          getItemLayout={(_, item) => ({ length: column, offset: column * item, index: item })}
          onScrollBeginDrag={() => {
            target.current = null;
          }}
          onScroll={(event) => {
            const item = Math.round(event.nativeEvent.contentOffset.x / column);
            if (item === shown.current || item < 0 || item >= DAYS.length) return;
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
