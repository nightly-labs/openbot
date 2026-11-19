import { createServerFn } from "@tanstack/solid-start";
import { isEuCountry, LIST_PRICE_PLANS, type PricingOffer } from "./pricing-page";

export const readPricingOffer = createServerFn({ method: "GET" }).handler(async (): Promise<PricingOffer> => {
  const [{ getRequest }, { requestCountry }, { requestBillingService }, { runApiEffect }, { BillingError }] =
    await Promise.all([
      import("@tanstack/solid-start/server"),
      import("../server/request-country"),
      import("../server/request-auth"),
      import("../server/effect-runtime"),
      import("../server/billing-errors"),
    ]);
  const inEu = isEuCountry(requestCountry(getRequest()));
  try {
    const billing = requestBillingService();
    if (!billing) return { plans: LIST_PRICE_PLANS, inEu };
    const catalog = await runApiEffect(billing.catalog());
    const licenseTrialEnd = billing.license.trialEnd();
    return { plans: catalog.plans, inEu, ...(licenseTrialEnd === null ? {} : { licenseTrialEnd }) };
  } catch (error) {
    console.warn("pricing: server prices did not load", error instanceof BillingError ? error.code : "unexpected");
    return { plans: LIST_PRICE_PLANS, inEu };
  }
});
