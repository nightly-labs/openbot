import { Host } from "@expo/ui";
import { Picker, Text } from "@expo/ui/swift-ui";
import { disabled as disabledModifier, pickerStyle, tag } from "@expo/ui/swift-ui/modifiers";
import type { BillingInterval } from "@openbot/contracts/billing";
import { useUniwind } from "uniwind";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import type { BillingPeriodPickerProps } from "./billing-period-picker.types";

/** Monthly or yearly billing, as the native iOS segmented control. */
export function BillingPeriodPicker({ interval, disabled, onChange }: BillingPeriodPickerProps) {
  const { t } = useText();
  const { theme } = useUniwind();
  return (
    <Host matchContents={{ vertical: true }} style={{ flex: 1 }} colorScheme={theme === "dark" ? "dark" : "light"}>
      <Picker<BillingInterval>
        label={t("mobile.server.hosted.billingPeriod")}
        selection={interval}
        modifiers={[pickerStyle("segmented"), disabledModifier(disabled)]}
        onSelectionChange={(next) => {
          if (next === interval) return;
          void haptics.selection();
          onChange(next);
        }}
      >
        <Text modifiers={[tag("month")]}>{t("mobile.server.hosted.monthly")}</Text>
        <Text modifiers={[tag("year")]}>{t("mobile.server.hosted.yearly")}</Text>
      </Picker>
    </Host>
  );
}
