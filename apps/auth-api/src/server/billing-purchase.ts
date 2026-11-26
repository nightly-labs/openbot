import type { BillingCurrency, BillingInterval, BillingPlanId } from "@openbot/contracts/billing";
import type { LicenseTier } from "@openbot/contracts/license";
import { Effect } from "effect";
import type { BillingAction, PlanEndReason } from "./account-analytics";
import { billingCall } from "./billing-errors";
import { type StripeSubscription, subscriptionPeriodEnd } from "./stripe-client";

const CLAIM_PREFIX = {
  started: "openbot_purchase:",
  ended: "openbot_purchase_end:",
  cancel: "openbot_purchase_cancel:",
} as const;

export type PurchaseEvent = "started" | "cancel_scheduled" | "cancel_withdrawn" | "ended";

export function purchaseEvent(action: BillingAction | null): PurchaseEvent | null {
  if (action === "plan_started") return "started";
  if (action === "plan_ended") return "ended";
  return action === "cancel_scheduled" || action === "cancel_withdrawn" ? action : null;
}

interface PurchaseTerms {
  event: PurchaseEvent;
  periodEnd: number | null;
  cancelRequest: number | null;
  endReason?: PlanEndReason;
  interval: BillingInterval;
  currency: BillingCurrency;
  amount: number | null;
  trial: boolean;
}

export type BillingPurchaseDetails =
  | (PurchaseTerms & { product: "server"; plan: BillingPlanId })
  | (PurchaseTerms & { product: "license"; tier: LicenseTier; users: number; bundle: boolean });

export type BillingPurchase = BillingPurchaseDetails & { email: string };

export interface CreditPurchase {
  email: string;
  credits: number;
  currency: BillingCurrency;
  amount: number | null;
  wallet: "personal" | "server";
  serverId: string | null;
}

export function subscriptionEnd(subscription: StripeSubscription): number | null {
  return typeof subscription.cancel_at === "number"
    ? subscription.cancel_at * 1_000
    : subscriptionPeriodEnd(subscription);
}

export interface PurchaseReport {
  database: D1Database;
  now: () => number;
  send: ((purchase: BillingPurchase) => void) | null;
}

export const reportPurchase = Effect.fn("reportPurchase")(
  function* (report: PurchaseReport, subscriptionId: string, userId: string, details: BillingPurchaseDetails) {
    const send = report.send;
    if (!send) return;
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

function claimKey(subscriptionId: string, details: BillingPurchaseDetails): string | null {
  if (details.event === "started") return `${CLAIM_PREFIX.started}${subscriptionId}`;
  if (details.event === "ended") return `${CLAIM_PREFIX.ended}${subscriptionId}`;
  if (details.event === "cancel_scheduled" && details.cancelRequest !== null)
    return `${CLAIM_PREFIX.cancel}${subscriptionId}:${details.cancelRequest}`;
  return null;
}

const EVENT_TEXT = {
  started: "🆕 **New**",
  cancel_scheduled: "🚪 **Cancelled**",
  cancel_withdrawn: "🔄 **Resumed**",
  ended: "⛔ **Ended**",
} as const satisfies Record<PurchaseEvent, string>;

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

export function creditPurchaseAlertText(purchase: CreditPurchase): string {
  return alertLine("💳 **Credits purchased**", [
    alertCode(purchase.email),
    `${purchase.credits} credits`,
    alertAmount(purchase.amount, purchase.currency),
    purchase.wallet === "server" ? `server ${alertCode(purchase.serverId ?? "unknown")}` : "personal wallet",
  ]);
}

function purchaseNote(purchase: BillingPurchase): string[] {
  if (purchase.event === "cancel_scheduled")
    return purchase.periodEnd === null ? [] : [`ends ${new Date(purchase.periodEnd).toISOString().slice(0, 10)}`];
  if (purchase.event === "ended") return [purchase.endReason === "unpaid" ? "not paid" : "cancelled"];
  return [];
}

export function alertLine(head: string, parts: readonly string[]): string {
  return [head, ...parts].join(" · ");
}

export function alertUsers(users: number): string {
  return `${users} user${users === 1 ? "" : "s"}`;
}

const INTERVAL_TEXT = { month: "/mo", year: "/yr" } as const satisfies Record<BillingInterval, string>;

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

export function alertCode(value: string): string {
  return `\`${value.replaceAll("`", "'")}\``;
}
