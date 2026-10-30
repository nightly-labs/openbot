import { createServerFn } from "@tanstack/solid-start";
import { isEuCountry, LIST_PRICE_PLANS, type PricingOffer } from "./pricing-page";

/**
 * Reads what the pricing page sells. It runs on the Worker: the server prices are Stripe Prices, and
 * the country is the `CF-IPCountry` header. The imports are inside the handler, so the browser bundle
 * never holds `cloudflare:workers`, and a test that imports the route does not load the Start server.
 *
 * When the Stripe prices do not load, this logs the failure and gives the list prices.
 */
export const readPricingOffer = createServerFn({ method: "GET" }).handler(async (): Promise<PricingOffer> => {
  const [{ getRequestHeader }, { requestBillingService }, { runApiEffect }, { BillingError }] = await Promise.all([
    import("@tanstack/solid-start/server"),
    import("../server/request-auth"),
    import("../server/effect-runtime"),
    import("../server/billing-errors"),
  ]);
  const inEu = isEuCountry(getRequestHeader("cf-ipcountry"));
  try {
    // Building the service can throw too: a Worker without the remote ticket key (the preview) cannot make one.
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
