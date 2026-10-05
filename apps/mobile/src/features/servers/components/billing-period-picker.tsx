import { Host } from "@expo/ui";
import { SegmentedButton, SingleChoiceSegmentedButtonRow, Text } from "@expo/ui/jetpack-compose";
import { fillMaxWidth } from "@expo/ui/jetpack-compose/modifiers";
import { BILLING_INTERVALS } from "@openbot/contracts/billing";
import { useCSSVariable } from "uniwind";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import type { BillingPeriodPickerProps } from "./billing-period-picker.types";

/** Monthly or yearly billing, as the Material 3 single-choice segmented buttons. */
export function BillingPeriodPicker({ interval, disabled, onChange }: BillingPeriodPickerProps) {
  const { t } = useText();
  const accent = String(useCSSVariable("--openbot-accent"));
  return (
    <Host matchContents={{ vertical: true }} seedColor={accent} style={{ flex: 1 }}>
      <SingleChoiceSegmentedButtonRow modifiers={[fillMaxWidth()]}>
        {BILLING_INTERVALS.map((option) => (
          <SegmentedButton
            key={option}
            selected={option === interval}
            enabled={!disabled}
            onClick={() => {
              if (option === interval) return;
              void haptics.selection();
              onChange(option);
            }}
          >
            <SegmentedButton.Label>
              <Text>{option === "year" ? t("mobile.server.hosted.yearly") : t("mobile.server.hosted.monthly")}</Text>
            </SegmentedButton.Label>
          </SegmentedButton>
        ))}
      </SingleChoiceSegmentedButtonRow>
    </Host>
  );
}
