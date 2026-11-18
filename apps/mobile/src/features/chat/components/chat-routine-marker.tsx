import { Typography } from "heroui-native";
import type { LucideIcon } from "lucide-react-native";
import CalendarCheck from "lucide-react-native/icons/calendar-check";
import CalendarClock from "lucide-react-native/icons/calendar-clock";
import CalendarPlus from "lucide-react-native/icons/calendar-plus";
import CalendarX2 from "lucide-react-native/icons/calendar-x-2";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import CirclePause from "lucide-react-native/icons/circle-pause";
import CircleX from "lucide-react-native/icons/circle-x";
import Clock3 from "lucide-react-native/icons/clock-3";
import LoaderCircle from "lucide-react-native/icons/loader-circle";
import TriangleAlert from "lucide-react-native/icons/triangle-alert";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import Animated, {
  cubicBezier,
  Easing,
  interpolate,
  ReduceMotion,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import type { RoutineMarker, RoutineMarkerEvent, RoutineRunGroup } from "@/features/chat/model/chat-messages";
import { useReducedMotion } from "@/shared/lib/motion";
import { useText } from "@/shared/lib/text";
import { ACTIVITY_ICON_SIZE, type ActivityColors, ChatActivityLine, useActivityColors } from "./chat-activity-line";
import { Spinner } from "./chat-subagents";

const ROUTINE_MARKER_ICONS: Record<RoutineMarkerEvent, LucideIcon> = {
  created: CalendarPlus,
  updated: CalendarClock,
  deleted: CalendarX2,
  queued: Clock3,
  running: LoaderCircle,
  "needs-attention": TriangleAlert,
  succeeded: CalendarCheck,
  failed: CircleX,
  interrupted: CirclePause,
  cancelled: CirclePause,
};

/** The open motion of the chat task list: the open is slower than the close, and rows settle in one after another. */
const OPEN_MS = 280;
const CLOSE_MS = 200;
const STAGGER_MS = 24;
const STAGGER_ROWS = 8;
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const EASE_CLOSE = Easing.bezier(0.32, 0.08, 0.24, 1);

/**
 * Whether routine groups start closed, and the state of each group that the chat has drawn: open or
 * closed, and the measured height of its markers. The list renders only the rows near the view, so
 * a group that scrolls out and back in comes back in the same state and at the same size.
 */
export interface RoutineGroupsState {
  collapse: boolean;
  /** `toggled`: the reader opened or closed the group. */
  groups: Map<string, { open: boolean; height: number; toggled: boolean }>;
}

export const RoutineGroupsContext = createContext<RoutineGroupsState>({ collapse: true, groups: new Map() });

/** Whether the group row with `id` is open: as the reader left it, else as Settings sets. */
function routineGroupOpen({ collapse, groups }: RoutineGroupsState, id: string): boolean {
  return groups.get(id)?.open ?? !collapse;
}

/**
 * The kind of a group row for the size averages of the chat list. A group that keeps its first state
 * has the kind of all groups in that state: one line when closed, and a kind per count when open.
 * A group that the reader toggled has a kind of its own from the first toggle, so the sizes of its
 * animation do not change the average that the list uses for the groups it has not measured yet.
 */
export function routineGroupKind(state: RoutineGroupsState, group: RoutineRunGroup): string {
  if (state.groups.get(group.id)?.toggled) return `routine-run-group:toggled:${group.id}`;
  return routineGroupOpen(state, group.id) ? `routine-run-group:${group.runs.length}` : "routine-run-group";
}

/** The kind color, or the state color while a routine runs or after it fails. */
function markerColor(event: RoutineMarkerEvent, colors: ActivityColors) {
  if (event === "running") return colors.running;
  if (event === "failed" || event === "needs-attention") return colors.danger;
  return colors.muted;
}

/** The marker icon. A running routine turns, as running subagents do. */
function MarkerIcon({ event, colors }: { event: RoutineMarkerEvent; colors: ActivityColors }) {
  if (event === "running") return <Spinner color={colors.running} size={ACTIVITY_ICON_SIZE} />;
  const Icon = ROUTINE_MARKER_ICONS[event];
  return <Icon size={ACTIVITY_ICON_SIZE} color={markerColor(event, colors)} />;
}

export function RoutineMarkerRow({ message }: { message: RoutineMarker }) {
  const { t } = useText();
  const colors = useActivityColors();
  return (
    <ChatActivityLine
      icon={<MarkerIcon event={message.event} colors={colors} />}
      label={t(message.label)}
      name={message.routineName}
      accessibilityLabel={`${t(message.label)}, ${message.routineName}`}
    />
  );
}

/** One marker of an open group. It follows the panel: each row starts a little after the one above it. */
function GroupedMarker({
  message,
  index,
  openness,
  opening,
}: {
  message: RoutineMarker;
  index: number;
  openness: SharedValue<number>;
  opening: SharedValue<boolean>;
}) {
  const start = (Math.min(index, STAGGER_ROWS) * STAGGER_MS) / OPEN_MS;
  const style = useAnimatedStyle(() => {
    const value = openness.get();
    const shown = opening.get() ? interpolate(value, [start, 1], [0, 1], "clamp") : value;
    return { opacity: shown, transform: [{ translateY: -4 * (1 - shown) }] };
  });
  return (
    <Animated.View style={style}>
      <RoutineMarkerRow message={message} />
    </Animated.View>
  );
}

/**
 * Consecutive routine markers, drawn as one row with a count. The row opens to show each marker. It
 * starts closed unless Settings turns off the collapse. A failed run gives the row its icon, so a
 * failure does not hide in a closed group.
 *
 * The panel animates its real height, as the task list does, so the chat list lays out the row on
 * each frame and the messages below move with it. A closed panel has no height and mounts its
 * markers on the first open. They are then out of the panel's flow, so they measure at their own
 * height while the panel is still closed. A panel that starts open keeps its markers in flow until
 * they are measured. So a chat opens with each group at its final size.
 */
export function RoutineRunGroupRow({ group }: { group: RoutineRunGroup }) {
  const { t, format } = useText();
  const colors = useActivityColors();
  const reducedMotion = useReducedMotion();
  const groupsState = useContext(RoutineGroupsContext);
  const { groups } = groupsState;
  const [saved] = useState(() => groups.get(group.id));
  const [open, setOpen] = useState(() => routineGroupOpen(groupsState, group.id));
  const [mounted, setMounted] = useState(open);
  // -1 while a panel that starts open has not measured its markers: it keeps its natural height.
  const [initialHeight] = useState(saved?.height ?? (open ? -1 : 0));
  const [floating, setFloating] = useState(initialHeight >= 0);
  const openOnLayout = useRef(false);
  const openness = useSharedValue(open ? 1 : 0);
  const opening = useSharedValue(open);
  const contentHeight = useSharedValue(initialHeight);
  useEffect(() => {
    opening.set(open);
    openness.set(
      withTiming(open ? 1 : 0, {
        duration: open ? OPEN_MS : CLOSE_MS,
        easing: open ? EASE_OUT : EASE_CLOSE,
        reduceMotion: ReduceMotion.System,
      }),
    );
  }, [open, opening, openness]);
  const panelStyle = useAnimatedStyle(() => {
    const height = contentHeight.get();
    return height < 0 ? {} : { height: height * openness.get() };
  });
  const lead = group.runs.find((run) => run.event === "failed") ?? group.runs.at(-1);
  const title = group.routineName ?? t("mobile.chat.routine.group.title");
  const count = group.runs.length;
  return (
    <View>
      <ChatActivityLine
        icon={<MarkerIcon event={lead?.event ?? "updated"} colors={colors} />}
        name={title}
        accessibilityState={{ expanded: open }}
        accessibilityLabel={[
          title,
          lead?.event === "failed" ? t(lead.label) : null,
          t("mobile.chat.routine.group.count", { count }),
        ]
          .filter(Boolean)
          .join(", ")}
        onPress={() => {
          // The first open waits for the markers to measure, so the panel grows to their height.
          if (!mounted) {
            openOnLayout.current = true;
            setMounted(true);
            return;
          }
          groups.set(group.id, { open: !open, height: contentHeight.get(), toggled: true });
          setOpen(!open);
        }}
        trailing={
          <>
            <View className="min-w-5 items-center rounded-full bg-control px-1.5">
              <Typography.Paragraph
                type="body-xs"
                className="font-medium"
                maxFontSizeMultiplier={1.4}
                style={{ color: colors.muted, fontVariant: ["tabular-nums"] }}
              >
                {format.number(count)}
              </Typography.Paragraph>
            </View>
            <Animated.View
              style={{
                transform: [{ rotate: open ? "180deg" : "0deg" }],
                transitionProperty: "transform",
                transitionDuration: reducedMotion ? 0 : 160,
                transitionTimingFunction: cubicBezier(0.23, 1, 0.32, 1),
              }}
            >
              <ChevronDown size={12} color={colors.dim} strokeWidth={2} />
            </Animated.View>
          </>
        }
      />
      <Animated.View
        style={[{ overflow: "hidden", alignSelf: "stretch" }, panelStyle]}
        pointerEvents={open ? "auto" : "none"}
        accessibilityElementsHidden={!open}
        importantForAccessibility={open ? "auto" : "no-hide-descendants"}
      >
        {mounted ? (
          <View
            // The runs sit under the group text, so the group reads as one block.
            className={floating ? "absolute inset-x-0 top-0 ps-5" : "ps-5"}
            onLayout={(event) => {
              const { height } = event.nativeEvent.layout;
              contentHeight.set(height);
              const opens = openOnLayout.current;
              openOnLayout.current = false;
              const toggled = opens || Boolean(groups.get(group.id)?.toggled);
              groups.set(group.id, { open: open || opens, height, toggled });
              if (!floating) setFloating(true);
              if (opens) setOpen(true);
            }}
          >
            {group.runs.map((run, index) => (
              <GroupedMarker key={run.id} message={run} index={index} openness={openness} opening={opening} />
            ))}
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}
