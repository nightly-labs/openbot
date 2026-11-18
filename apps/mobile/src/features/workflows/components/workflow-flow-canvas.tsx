import Plus from "lucide-react-native/icons/plus";
import type { ReactNode } from "react";
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import Animated from "react-native-reanimated";
import { useCSSVariable } from "uniwind";
import { haptics } from "@/shared/lib/haptics";
import { useReducedMotion } from "@/shared/lib/motion";
import { useText } from "@/shared/lib/text";

/**
 * The width of a step on the flow canvas. Every step has it, so a text wraps the same way everywhere.
 * The flow runs from left to right, as on the desktop canvas, and the canvas scrolls sideways.
 */
export const FLOW_CARD_WIDTH = 236;
/** The space above and below each path: two paths have twice this between them. */
const LANE_PADDING = 8;
/** The padding of the screen content, which the canvas reaches past to scroll edge to edge. */
const SCREEN_PADDING = 16;
/** The fade of a path that a run did not take: the hover time of the desktop. */
const DIM_MS = 150;

/** A line from one step to the next, to its right. `grow` fills the space to the end of a path. */
export function FlowConnector({ grow = false }: { grow?: boolean }) {
  return <View className={`h-0.5 self-center rounded-full bg-separator ${grow ? "min-w-3 flex-1" : "w-4"}`} />;
}

/** A place between two steps: a line, a "+" that adds a step there, and a line. */
export function FlowAddButton({ onPress }: { onPress: () => void }) {
  const { t } = useText();
  const [muted, control, controlActive] = useCSSVariable([
    "--openbot-text-grouped-secondary",
    "--openbot-bg-control",
    "--openbot-bg-control-active",
  ]);
  return (
    <View className="flex-row items-center">
      <FlowConnector />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("mobile.workflow.editor.addHere")}
        hitSlop={8}
        className="size-7 items-center justify-center rounded-full"
        style={({ pressed }) => ({ backgroundColor: String(pressed ? controlActive : control) })}
        onPress={() => {
          void haptics.selection();
          onPress();
        }}
      >
        <Plus color={String(muted)} size={15} strokeWidth={2.4} />
      </Pressable>
      <FlowConnector />
    </View>
  );
}

/**
 * The canvas of a flow: the steps in a row from left to right. It scrolls sideways when the flow is
 * wider than the screen, and keeps a short flow in the middle.
 */
export function FlowCanvas({ children }: { children: ReactNode }) {
  const { width } = useWindowDimensions();
  return (
    <ScrollView
      horizontal
      style={{ marginHorizontal: -SCREEN_PADDING }}
      contentContainerStyle={{
        minWidth: width,
        paddingHorizontal: SCREEN_PADDING,
        alignItems: "center",
        justifyContent: "center",
      }}
      showsHorizontalScrollIndicator={false}
    >
      <View className="flex-row items-center">{children}</View>
    </ScrollView>
  );
}

/** The start or the end of a path: half a line to each next path, and a line to its middle. */
function LaneCap({ index, count, join }: { index: number; count: number; join: boolean }) {
  const edge = join ? "border-r-2" : "border-l-2";
  return (
    <View className="w-4 self-stretch">
      <View className={`flex-1 border-separator ${index > 0 ? edge : ""}`} />
      <View className={`flex-1 border-separator ${index < count - 1 ? edge : ""}`} />
      <View className="absolute inset-x-0 h-0.5 bg-separator" style={{ top: "50%", marginTop: -1 }} />
    </View>
  );
}

export interface FlowLane {
  key: string;
  label: ReactNode;
  content: ReactNode;
  /** The run did not take this path: it shows at half strength, as the desktop dims the branch. */
  dimmed?: boolean;
}

/**
 * The paths of a condition, or of a step that sends its result to more than one step, one under the
 * other. A line splits from the step at the left into each path. When the paths join, a line from the
 * end of each path meets again at their right.
 */
export function FlowLanes({ lanes, joined }: { lanes: readonly FlowLane[]; joined: boolean }) {
  const reduced = useReducedMotion();
  return (
    <View className="flex-row items-center">
      <FlowConnector />
      <View>
        {lanes.map((lane, index) => (
          // The caps span the whole path, padding too, so their lines meet the caps of the next path.
          <View key={lane.key} className="flex-row">
            <LaneCap index={index} count={lanes.length} join={false} />
            <Animated.View
              className="flex-1 flex-row items-center"
              style={{
                paddingVertical: LANE_PADDING,
                opacity: lane.dimmed ? 0.5 : 1,
                transitionProperty: "opacity",
                transitionDuration: reduced ? 0 : DIM_MS,
                transitionTimingFunction: "ease-out",
              }}
            >
              <View className="px-1.5">{lane.label}</View>
              {lane.content}
              {joined ? <FlowConnector grow /> : null}
            </Animated.View>
            {joined ? <LaneCap index={index} count={lanes.length} join /> : null}
          </View>
        ))}
      </View>
      {joined ? <FlowConnector /> : null}
    </View>
  );
}
