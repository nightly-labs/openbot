import type { BillingCurrency, BillingInterval, BillingPlanId } from "@openbot/contracts/billing";
import type { LicenseTier } from "@openbot/contracts/license";
import { Effect } from "effect";
import type { BillingAction, PlanEndReason } from "./account-analytics";
import { billingCall } from "./billing-errors";
import { type StripeSubscription, subscriptionPeriodEnd } from "./stripe-client";

/** The keys of the start and end claims in `billing_webhook_events`. No Stripe event id has them. */
const CLAIM_PREFIX = { started: "openbot_purchase:", ended: "openbot_purchase_end:" } as const;

/**
 * The changes of a subscription that the operator gets: its start, the cancel of its renewal, the
 * withdrawal of that cancel, and its end. A change of plan or users sends nothing.
 */
export type PurchaseEvent = "started" | "cancel_scheduled" | "cancel_withdrawn" | "ended";

/** The operator event of a stored change, or null for a change that sends no message. */
export function purchaseEvent(action: BillingAction | null): PurchaseEvent | null {
  if (action === "plan_started") return "started";
  if (action === "plan_ended") return "ended";
  return action === "cancel_scheduled" || action === "cancel_withdrawn" ? action : null;
}

interface PurchaseTerms {
  event: PurchaseEvent;
  /** When a cancelled renewal ends the subscription, in milliseconds (`subscriptionEnd`). */
  periodEnd: number | null;
  /** Why an ended subscription ended. */
  endReason?: PlanEndReason;
  interval: BillingInterval;
  currency: BillingCurrency;
  /** The list amount of one period, in minor units, before a discount. Null when Stripe gives no amount. */
  amount: number | null;
  /** True when the subscription starts with a free trial. */
  trial: boolean;
}

/** What a subscription bought: a server plan, or a license with its tier and users. */
export type BillingPurchaseDetails =
  | (PurchaseTerms & { product: "server"; plan: BillingPlanId })
  | (PurchaseTerms & { product: "license"; tier: LicenseTier; users: number; bundle: boolean });

/** A started, cancelled or ended subscription with the email of its account, for the operator message. */
export type BillingPurchase = BillingPurchaseDetails & { email: string };

/** The cancel date that Stripe has for the subscription, or the end of its paid period. In milliseconds. */
export function subscriptionEnd(subscription: StripeSubscription): number | null {
  return typeof subscription.cancel_at === "number"
    ? subscription.cancel_at * 1_000
    : subscriptionPeriodEnd(subscription);
}

export interface PurchaseReport {
  database: D1Database;
  now: () => number;
  /** Must not throw or wait: the message goes after the webhook answers. */
  send: ((purchase: BillingPurchase) => void) | null;
}

/**
 * Gives a subscription change to `send`. Stripe sends the events of a new subscription at the same
 * time, and each one can see the start, so only the event that adds the claim reports a start. An end
 * has a claim too: a refund and the Stripe event of the end can store it at the same time. The claims
 * are kept as long as the webhook events. A cancelled or resumed renewal has no claim, because a
 * subscription can have many. A failure skips the message, not the sync.
 */
export const reportPurchase = Effect.fn("reportPurchase")(
  function* (report: PurchaseReport, subscriptionId: string, userId: string, details: BillingPurchaseDetails) {
    const send = report.send;
    if (!send) return;
    // The read is before the claim, so a failed read leaves the start for the next event.
    const account = yield* billingCall(() =>
      report.database.prepare("SELECT email FROM users WHERE id = ?").bind(userId).first<{ email: string }>(),
    );
    if (!account) {
      console.warn("billing: purchase message skipped: the account is gone");
      return;
    }
    if (details.event === "started" || details.event === "ended") {
      const prefix = CLAIM_PREFIX[details.event];
      const claim = yield* billingCall(() =>
        report.database
          .prepare("INSERT OR IGNORE INTO billing_webhook_events(event_id, type, received_at) VALUES (?, ?, ?)")
          .bind(`${prefix}${subscriptionId}`, "purchase", report.now())
          .run(),
      );
      if (claim.meta.changes !== 1) return;
    }
    send({ ...details, email: account.email });
  },
  (operation) =>
    operation.pipe(
      Effect.catch(() => Effect.sync(() => console.warn("billing: purchase message skipped: the database failed"))),
    ),
);

const EVENT_TEXT = {
  started: "New",
  cancel_scheduled: "Cancelled renewal of the",
  cancel_withdrawn: "Resumed renewal of the",
  ended: "Ended",
} as const satisfies Record<PurchaseEvent, string>;

/** The operator message of a subscription change: the account email, the product, the amount, the currency and the period. */
export function purchaseAlertText(purchase: BillingPurchase): string {
  const amount = alertAmount(purchase.amount, purchase.currency);
  const head = `${EVENT_TEXT[purchase.event]} ${purchase.product === "server" ? "server plan" : "license"} for ${alertCode(purchase.email)}`;
  const product =
    purchase.product === "server"
      ? purchase.plan
      : `${purchase.tier}, ${purchase.users} user${purchase.users === 1 ? "" : "s"}${purchase.bundle ? ", bundle price" : ""}`;
  return `${head}: ${product}, ${amount} for 1 ${purchase.interval}.${purchaseNote(purchase)}`;
}

/** The sentence after the terms: the trial of a start, the last day of a cancelled renewal, or the reason of an end. */
function purchaseNote(purchase: BillingPurchase): string {
  if (purchase.event === "started") return purchase.trial ? " It starts with a free trial." : "";
  if (purchase.event === "cancel_scheduled")
    return purchase.periodEnd === null ? "" : ` It ends on ${new Date(purchase.periodEnd).toISOString().slice(0, 10)}.`;
  if (purchase.event === "ended") return purchase.endReason === "unpaid" ? " Reason: not paid." : " Reason: cancelled.";
  return "";
}

/** An amount in minor units as operator text, such as `$29.00 (USD)`. */
export function alertAmount(amount: number | null, currency: BillingCurrency): string {
  const code = currency.toUpperCase();
  return amount === null
    ? `amount not known (${code})`
    : `${new Intl.NumberFormat("en", { style: "currency", currency: code }).format(amount / 100)} (${code})`;
}

/** Discord shows the text between backticks as it is, so an email cannot make a link or a mention. */
export function alertCode(value: string): string {
  return `\`${value.replaceAll("`", "'")}\``;
}
