import { CREDIT_PRICES_URL } from "@openbot/contracts/credits";
import { desktopAnalytics } from "../../analytics";

export function openCreditPrices(openUrl: (url: string) => Promise<void>): void {
  desktopAnalytics.track("help_link_opened", { destination: "credit-prices" });
  void openUrl(CREDIT_PRICES_URL);
}
