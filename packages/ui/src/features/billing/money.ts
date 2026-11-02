import type { BillingCurrency } from "@openbot/contracts/billing";
import type { AppFormat } from "@openbot/i18n";

/**
 * A money amount in minor units, with the narrow currency sign as in Add server, and cents only when it
 * has them.
 */
export function formatMinorMoney(format: AppFormat, minor: number, currency: BillingCurrency): string {
  const whole = minor % 100 === 0;
  return format.number(minor / 100, {
    style: "currency",
    currency: currency.toUpperCase(),
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  });
}
