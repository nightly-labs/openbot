import { GripVertical } from "lucide-react-native";
import { type ReactNode, useEffect } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  ReduceMotion,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { haptics } from "@/shared/lib/haptics";

export const SERVER_ROW_HEIGHT = 68;
const SHIFT = { duration: 180, reduceMotion: ReduceMotion.System } as const;
const SETTLE = { dampingRatio: 1, duration: 220, reduceMotion: ReduceMotion.System } as const;

type Positions = Record<string, number>;

function positionsOf(ids: readonly string[]): Positions {
  return Object.fromEntries(ids.map((id, index) => [id, index]));
}

function orderOf(positions: Positions): string[] {
  "worklet";
  return Object.keys(positions).sort((a, b) => (positions[a] ?? 0) - (positions[b] ?? 0));
}

function movePosition(positions: Positions, id: string, target: number): Positions {
  "worklet";
  const order = orderOf(positions).filter((candidate) => candidate !== id);
  order.splice(target, 0, id);
  const next: Positions = {};
  for (let index = 0; index < order.length; index += 1) next[order[index] ?? ""] = index;
  return next;
}

function selectionHaptic() {
  void haptics.selection();
}

interface DragState {
  positions: SharedValue<Positions>;
  activeId: SharedValue<string | null>;
  startY: SharedValue<number>;
  offset: SharedValue<number>;
}

interface SortableServerListProps {
  color: string;
  ids: string[];
  renderRow: (id: string) => ReactNode;
  onDragActive: (active: boolean) => void;
  /** Returns false when the order could not be saved. */
  onReorder: (ids: string[]) => boolean;
}

/**
 * The UI thread owns row positions during a drag and after the drop. React later renders the saved order,
 * which gives the same positions, so the rows do not jump back while the workspace renders again.
 */
export function SortableServerList({ color, ids, renderRow, onDragActive, onReorder }: SortableServerListProps) {
  const signature = ids.join("\n");
  const drag: DragState = {
    positions: useSharedValue(positionsOf(ids)),
    activeId: useSharedValue<string | null>(null),
    startY: useSharedValue(0),
    offset: useSharedValue(0),
  };
  const { positions } = drag;

  useEffect(() => {
    positions.set(positionsOf(signature ? signature.split("\n") : []));
  }, [positions, signature]);

  const finish = (order: string[]) => {
    onDragActive(false);
    if (order.join("\n") === signature) return;
    if (!onReorder(order)) positions.set(positionsOf(signature.split("\n")));
  };

  return (
    <View style={{ height: ids.length * SERVER_ROW_HEIGHT }}>
      {ids.map((id) => (
        <SortableServerRow
          key={id}
          color={color}
          count={ids.length}
          drag={drag}
          id={id}
          onDragActive={onDragActive}
          onDrop={finish}
        >
          {renderRow(id)}
        </SortableServerRow>
      ))}
    </View>
  );
}

interface SortableServerRowProps {
  children: ReactNode;
  color: string;
  count: number;
  drag: DragState;
  id: string;
  onDragActive: (active: boolean) => void;
  onDrop: (order: string[]) => void;
}

function SortableServerRow({ children, color, count, drag, id, onDragActive, onDrop }: SortableServerRowProps) {
  const { activeId, offset, positions, startY } = drag;
  const pan = Gesture.Pan()
    .minDistance(0)
    .onStart(() => {
      activeId.set(id);
      startY.set((positions.get()[id] ?? 0) * SERVER_ROW_HEIGHT);
      offset.set(0);
      scheduleOnRN(onDragActive, true);
      scheduleOnRN(selectionHaptic);
    })
    .onUpdate((event) => {
      const start = startY.get();
      const next = Math.max(-start, Math.min((count - 1) * SERVER_ROW_HEIGHT - start, event.translationY));
      offset.set(next);
      const target = Math.round((start + next) / SERVER_ROW_HEIGHT);
      if (target !== positions.get()[id]) {
        positions.set(movePosition(positions.get(), id, target));
        scheduleOnRN(selectionHaptic);
      }
    })
    .onFinalize(() => {
      if (activeId.get() !== id) return;
      const settled = (positions.get()[id] ?? 0) * SERVER_ROW_HEIGHT - startY.get();
      offset.set(
        withSpring(settled, SETTLE, (finished) => {
          // A new drag interrupts the settle and owns the state from then on.
          if (!finished) return;
          activeId.set(null);
          scheduleOnRN(onDrop, orderOf(positions.get()));
        }),
      );
    });

  const style = useAnimatedStyle(() => {
    const active = activeId.get();
    if (active === id) return { transform: [{ translateY: startY.get() + offset.get() }, { scale: 1.02 }], zIndex: 10 };
    const y = (positions.get()[id] ?? 0) * SERVER_ROW_HEIGHT;
    return { transform: [{ translateY: active === null ? y : withTiming(y, SHIFT) }, { scale: 1 }], zIndex: 0 };
  });

  return (
    <Animated.View style={[{ height: SERVER_ROW_HEIGHT, left: 0, position: "absolute", right: 0, top: 0 }, style]}>
      <View className="flex-1 flex-row items-center">
        <View className="min-w-0 flex-1">{children}</View>
        <GestureDetector gesture={pan}>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            className="w-11 items-center justify-center self-stretch"
            hitSlop={8}
          >
            <GripVertical color={color} size={20} strokeWidth={1.8} />
          </View>
        </GestureDetector>
      </View>
    </Animated.View>
  );
}
