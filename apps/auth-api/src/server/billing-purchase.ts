import type { BillingCurrency, BillingInterval, BillingPlanId } from "@openbot/contracts/billing";
import type { LicenseTier } from "@openbot/contracts/license";
import { Effect } from "effect";
import type { BillingAction, PlanEndReason } from "./account-analytics";
import { billingCall } from "./billing-errors";
import { type StripeSubscription, subscriptionPeriodEnd } from "./stripe-client";

/** The keys of the claims in `billing_webhook_events`. No Stripe event id has them. */
const CLAIM_PREFIX = {
  started: "openbot_purchase:",
  ended: "openbot_purchase_end:",
  cancel: "openbot_purchase_cancel:",
} as const;

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
  /** The Stripe `canceled_at` of the subscription: the time of its last cancel request, in seconds. */
  cancelRequest: number | null;
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
 * has a claim too: a refund and the Stripe event of the end can store it at the same time. Two events
 * can also see one cancel of a renewal, so a cancel has a claim for its cancel request (`canceled_at`):
 * each new cancel request has a new time. A resume has no claim. The claims are kept as long as the
 * webhook events. A failure skips the message, not the sync.
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
    const key = claimKey(subscriptionId, details);
    if (key) {
      const claim = yield* billingCall(() =>
        report.database
          .prepare("INSERT OR IGNORE INTO billing_webhook_events(event_id, type, received_at) VALUES (?, ?, ?)")
          .bind(key, "purchase", report.now())
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

/** The claim of a change, or null for a change with no claim. */
function claimKey(subscriptionId: string, details: BillingPurchaseDetails): string | null {
  if (details.event === "started") return `${CLAIM_PREFIX.started}${subscriptionId}`;
  if (details.event === "ended") return `${CLAIM_PREFIX.ended}${subscriptionId}`;
  if (details.event === "cancel_scheduled" && details.cancelRequest !== null)
    return `${CLAIM_PREFIX.cancel}${subscriptionId}:${details.cancelRequest}`;
  return null;
}

/** The emoji and the word that start the message of each change, so that the operator can scan the channel. */
const EVENT_TEXT = {
  started: "🆕 **New**",
  cancel_scheduled: "🚪 **Cancelled**",
  cancel_withdrawn: "🔄 **Resumed**",
  ended: "⛔ **Ended**",
} as const satisfies Record<PurchaseEvent, string>;

/**
 * The operator message of a subscription change, on one line: the event, the product, the account
 * email, the plan, and the amount of one period. For example
 * ``🧪 **Trial** license · `a@b.c` · starter · 1 user · bundle · €9/mo``.
 */
export function purchaseAlertText(purchase: BillingPurchase): string {
  const event = purchase.event === "started" && purchase.trial ? "🧪 **Trial**" : EVENT_TEXT[purchase.event];
  const plan =
    purchase.product === "server"
      ? [purchase.plan]
      : [purchase.tier, alertUsers(purchase.users), ...(purchase.bundle ? ["bundle"] : [])];
  return alertLine(`${event} ${purchase.product}`, [
    alertCode(purchase.email),
    ...plan,
    alertAmount(purchase.amount, purchase.currency, purchase.interval),
    ...purchaseNote(purchase),
  ]);
}

/** The last day of a cancelled renewal, or the reason of an end. */
function purchaseNote(purchase: BillingPurchase): string[] {
  if (purchase.event === "cancel_scheduled")
    return purchase.periodEnd === null ? [] : [`ends ${new Date(purchase.periodEnd).toISOString().slice(0, 10)}`];
  if (purchase.event === "ended") return [purchase.endReason === "unpaid" ? "not paid" : "cancelled"];
  return [];
}

/** One operator message: the head, then each part after a middle dot. */
export function alertLine(head: string, parts: readonly string[]): string {
  return [head, ...parts].join(" · ");
}

export function alertUsers(users: number): string {
  return `${users} user${users === 1 ? "" : "s"}`;
}

const INTERVAL_TEXT = { month: "/mo", year: "/yr" } as const satisfies Record<BillingInterval, string>;

/**
 * An amount in minor units as operator text, such as `$29`, `€9.50/mo` or `PLN 480/yr`. The symbol
 * tells the currency, and a whole amount has no cents.
 */
export function alertAmount(amount: number | null, currency: BillingCurrency, interval?: BillingInterval): string {
  const code = currency.toUpperCase();
  if (amount === null) return `amount not known (${code})`;
  const value = new Intl.NumberFormat("en", {
    style: "currency",
    currency: code,
    trailingZeroDisplay: "stripIfInteger",
  })
    .format(amount / 100)
    .replace("\u00a0", " ");
  return interval ? `${value}${INTERVAL_TEXT[interval]}` : value;
}

/** Discord shows the text between backticks as it is, so an email cannot make a link or a mention. */
export function alertCode(value: string): string {
  return `\`${value.replaceAll("`", "'")}\``;
}
