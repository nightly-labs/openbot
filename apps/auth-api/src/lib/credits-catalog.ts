import type { CreditMediaModel } from "@openbot/contracts/credit-media";
import { createServerFn } from "@tanstack/solid-start";

export const readCreditsCatalog = createServerFn({ method: "GET" }).handler(
  async (): Promise<readonly CreditMediaModel[]> => {
    const [{ requestCreditMedia }, { runApiEffect }, { BillingError }] = await Promise.all([
      import("../server/request-auth"),
      import("../server/effect-runtime"),
      import("../server/billing-errors"),
    ]);
    try {
      const catalog = await runApiEffect(requestCreditMedia().catalog());
      return catalog.models;
    } catch (error) {
      console.warn("credits: media prices did not load", error instanceof BillingError ? error.code : "unexpected");
      return [];
    }
  },
);
