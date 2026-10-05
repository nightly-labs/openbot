import type { BillingInterval } from "@openbot/contracts/billing";

export interface BillingPeriodPickerProps {
  interval: BillingInterval;
  disabled: boolean;
  onChange: (interval: BillingInterval) => void;
}
