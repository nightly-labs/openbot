import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { Typography } from "heroui-native";
import { View } from "react-native";

import { useText } from "@/shared/lib/text";

// The field shows its count from this share of the limit on, so a short text has no counter.
const COUNTER_FROM = 0.9;

export function instructionsTooLong(text: string): boolean {
  return text.length > INPUT_LIMITS.agentDescription;
}

/**
 * The count under an instructions field near its limit, and an error over it. The field keeps the
 * whole text rather than cutting it at the limit, so the user sees what does not fit and shortens it.
 */
export function InstructionsLimit({ text }: { text: string }) {
  const { t, format } = useText();
  if (text.length < INPUT_LIMITS.agentDescription * COUNTER_FROM) return null;
  const limit = format.number(INPUT_LIMITS.agentDescription);
  return (
    <View className="gap-1 px-1">
      <Typography.Paragraph type="body-xs" className="text-text-secondary">
        {t("mobile.agent.instructions.length", { length: format.number(text.length), limit })}
      </Typography.Paragraph>
      {instructionsTooLong(text) ? (
        <Typography.Paragraph accessibilityRole="alert" type="body-xs" className="text-danger-text">
          {t("mobile.agent.instructions.tooLong", { limit })}
        </Typography.Paragraph>
      ) : null}
    </View>
  );
}
