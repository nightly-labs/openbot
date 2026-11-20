import Plus from "lucide-react-native/icons/plus";
import type { ReactNode } from "react";
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import Animated from "react-native-reanimated";
import { useCSSVariable } from "uniwind";
import { haptics } from "@/shared/lib/haptics";
import { useReducedMotion } from "@/shared/lib/motion";
import { useText } from "@/shared/lib/text";

export const FLOW_CARD_WIDTH = 236;
const LANE_PADDING = 8;
const SCREEN_PADDING = 16;
const DIM_MS = 150;

export function FlowConnector({ grow = false }: { grow?: boolean }) {
  return <View className={`h-0.5 self-center rounded-full bg-separator ${grow ? "min-w-3 flex-1" : "w-4"}`} />;
}

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
  dimmed?: boolean;
}

export function FlowLanes({ lanes, joined }: { lanes: readonly FlowLane[]; joined: boolean }) {
  const reduced = useReducedMotion();
  return (
    <View className="flex-row items-center">
      <FlowConnector />
      <View>
        {lanes.map((lane, index) => (
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
