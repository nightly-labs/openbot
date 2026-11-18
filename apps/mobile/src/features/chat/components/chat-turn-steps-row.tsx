import Brain from "lucide-react-native/icons/brain";
import type { ColorValue } from "react-native";
import { type MobileText, useText } from "@/shared/lib/text";
import type { TurnStepsSummary } from "../model/turn-thinking";
import { ACTIVITY_ICON_SIZE, ChatActivityLine } from "./chat-activity-line";

/** "12s" or "1m 04s". */
export function turnDuration(seconds: number, { t, format }: Pick<MobileText, "t" | "format">): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return t("mobile.chat.thinking.seconds", { seconds: format.number(total) });
  return t("mobile.chat.thinking.minutes", {
    minutes: format.number(Math.floor(total / 60)),
    seconds: String(total % 60).padStart(2, "0"),
  });
}

/**
 * The row above a finished answer, or of a finished turn with no answer: how long the turn took and
 * its step count. It stays on the answer it belongs to. It opens the steps where a sheet can show them.
 */
export function ChatTurnStepsRow({
  summary,
  muted,
  onPress,
}: {
  summary: TurnStepsSummary;
  muted: ColorValue;
  /** Absent where no sheet can show the steps, such as a channel. */
  onPress: (() => void) | undefined;
}) {
  const text = useText();
  const steps = text.t("mobile.chat.thinking.steps", { count: summary.steps });
  const duration = summary.seconds === null ? null : turnDuration(summary.seconds, text);
  return (
    <ChatActivityLine
      icon={<Brain size={ACTIVITY_ICON_SIZE} color={muted} />}
      label={duration === null ? steps : text.t("mobile.chat.thinking.titleDone", { duration })}
      meta={duration === null ? undefined : steps}
      accessibilityLabel={duration === null ? steps : text.t("mobile.chat.thinking.summary", { duration, steps })}
      accessibilityHint={onPress ? text.t("mobile.chat.thinking.openHint") : undefined}
      onPress={onPress}
    />
  );
}
