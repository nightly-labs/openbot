import { isReferralCode } from "@openbot/contracts/referral";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { createServerFn } from "@tanstack/solid-start";
import { readPricingOffer } from "./pricing-offer";
import type { PricingOffer } from "./pricing-page";

export interface ReferralSearch {
  ref?: string;
}

export interface ReferralInvite {
  code: string;
  inviterName: string | null;
}

export interface ReferralLanding {
  invite: ReferralInvite;
  offer: PricingOffer;
}

export function referralSearch(value: unknown): ReferralSearch {
  const code = isDynamicRecord(value) && isString(value.ref) ? value.ref.toLowerCase() : "";
  return isReferralCode(code) ? { ref: code } : {};
}

const readReferralInviter = createServerFn({ method: "GET" })
  .validator((code: unknown) => (isString(code) ? code : ""))
  .handler(async ({ data }): Promise<{ found: boolean; inviterName: string | null }> => {
    if (!isReferralCode(data)) return { found: false, inviterName: null };
    const [{ requestReferrals }, { runApiEffect }] = await Promise.all([
      import("../server/request-auth"),
      import("../server/effect-runtime"),
    ]);
    try {
      const inviter = await runApiEffect(requestReferrals().inviter(data));
      return { found: inviter !== null, inviterName: inviter?.firstName ?? null };
    } catch {
      console.warn("referral landing: the inviter did not load");
      return { found: false, inviterName: null };
    }
  });

export async function loadReferralLanding(code: string | undefined): Promise<ReferralLanding | null> {
  if (!code) return null;
  const [inviter, offer] = await Promise.all([readReferralInviter({ data: code }), readPricingOffer()]);
  if (!inviter.found) return null;
  return { invite: { code, inviterName: inviter.inviterName }, offer };
}
