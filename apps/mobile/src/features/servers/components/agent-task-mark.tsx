import type { AgentTask } from "@openbot/contracts/ipc";
import Check from "lucide-react-native/icons/check";
import Circle from "lucide-react-native/icons/circle";
import X from "lucide-react-native/icons/x";
import { View } from "react-native";
import { useCSSVariable } from "uniwind";

/**
 * As on desktop: a dot while the task runs, a ring while it waits or has not started, and a mark for
 * how its last turn ended. The state is in the text beside it, so the mark is hidden from VoiceOver.
 */
export function AgentTaskMark({ task }: { task: AgentTask }) {
  const muted = String(useCSSVariable("--openbot-text-grouped-secondary"));
  const accent = String(useCSSVariable("--openbot-accent-text"));
  const success = String(useCSSVariable("--openbot-success-text"));
  const danger = String(useCSSVariable("--openbot-danger-text"));
  return (
    <View
      className="size-4 items-center justify-center"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {task.state === "running" ? (
        <View className="size-2 rounded-full" style={{ backgroundColor: accent }} />
      ) : task.state === "queued" || task.outcome === null ? (
        <Circle color={muted} size={14} strokeWidth={1.8} />
      ) : task.outcome === "completed" ? (
        <Check color={success} size={16} strokeWidth={2} />
      ) : (
        <X color={danger} size={16} strokeWidth={2} />
      )}
    </View>
  );
}
