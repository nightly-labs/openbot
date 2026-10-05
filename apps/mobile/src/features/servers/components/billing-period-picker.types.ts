import type { BillingInterval } from "@openbot/contracts/billing";

export interface BillingPeriodPickerProps {
  interval: BillingInterval;
  /** "Yearly", or "Yearly (Save 20%)" when yearly billing costs less. */
  yearlyLabel: string;
  disabled: boolean;
  onChange: (interval: BillingInterval) => void;
}
