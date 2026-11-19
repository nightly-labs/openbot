import { CRM_LIMITS, type CrmEvery } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Schema } from "effect";
import { CrmError } from "./crm-handle";
import { type CrmSourceAdapter, type SourceAccount, SourceFailure, type SourceSession } from "./crm-source";
import type { SourceBatch, SourceCustomer, SourcePayment, SourcePlan } from "./crm-source-store";
import { localCrmDate } from "./crm-store";

const STRIPE_VERSION = "2025-03-31.basil";
const TIMEOUT_MS = 30_000;
const PAGE = 100;
const HasId = Schema.Struct({ id: Schema.String });
const RESOURCES = ["customers", "invoices", "subscriptions", "products"] as const;
const HUNDREDTHS_ONLY = new Set(["ISK", "UGX"]);

const text = Schema.optional(Schema.NullOr(Schema.String));
const seconds = Schema.optional(Schema.NullOr(Schema.Number));
const Customer = Schema.Struct({
  id: Schema.String,
  deleted: Schema.optional(Schema.Boolean),
  name: text,
  email: text,
  phone: text,
  currency: text,
});
type Customer = typeof Customer.Type;
const CustomerRef = Schema.Union([Schema.String, Customer]);
const Price = Schema.Struct({
  nickname: text,
  unit_amount: seconds,
  product: Schema.Union([Schema.String, Schema.Struct({ id: Schema.String, name: text })]),
  recurring: Schema.optional(
    Schema.NullOr(Schema.Struct({ interval: Schema.String, interval_count: Schema.Number, usage_type: text })),
  ),
});
const Subscription = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  customer: CustomerRef,
  currency: Schema.String,
  start_date: Schema.Number,
  ended_at: seconds,
  cancel_at: seconds,
  canceled_at: seconds,
  items: Schema.Struct({
    data: Schema.Array(Schema.Struct({ price: Price, quantity: seconds })),
  }),
});
type Subscription = typeof Subscription.Type;
const Invoice = Schema.Struct({
  id: Schema.String,
  number: text,
  status: text,
  customer: Schema.optional(Schema.NullOr(CustomerRef)),
  currency: Schema.String,
  amount_due: Schema.Number,
  amount_paid: Schema.Number,
  due_date: seconds,
  created: Schema.Number,
  status_transitions: Schema.optional(Schema.NullOr(Schema.Struct({ paid_at: seconds }))),
  parent: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        subscription_details: Schema.optional(
          Schema.NullOr(
            Schema.Struct({
              subscription: Schema.optional(
                Schema.NullOr(Schema.Union([Schema.String, Schema.Struct({ id: Schema.String })])),
              ),
            }),
          ),
        ),
      }),
    ),
  ),
});
type Invoice = typeof Invoice.Type;
const Product = Schema.Struct({ id: Schema.String, name: text });
const Account = Schema.Struct({
  default_currency: text,
  business_profile: Schema.optional(Schema.NullOr(Schema.Struct({ name: text }))),
  settings: Schema.optional(
    Schema.NullOr(Schema.Struct({ dashboard: Schema.optional(Schema.NullOr(Schema.Struct({ display_name: text }))) })),
  ),
});
const list = <S extends Schema.Top>(item: S) => Schema.Struct({ data: Schema.Array(item), has_more: Schema.Boolean });

type Params = readonly (readonly [string, string])[];

export interface StripeSourceOptions {
  fetch: (input: URL, init: RequestInit) => Promise<Response>;
  apiBase?: string;
  now?: () => Date;
}

function day(value: number): string {
  return localCrmDate(new Date(value * 1000));
}

function minor(amount: number, currency: string): number {
  const value = HUNDREDTHS_ONLY.has(currency) ? Math.round(amount / 100) : amount;
  return Math.min(Math.max(0, Math.round(value)), CRM_LIMITS.amountMinor);
}

function every(interval: string, count: number): Exclude<CrmEvery, "once"> | null {
  const months = interval === "year" ? count * 12 : interval === "month" ? count : 0;
  if (months === 1) return "month";
  if (months === 3) return "quarter";
  if (months === 12) return "year";
  return null;
}

export function stripeSource(options: StripeSourceOptions): CrmSourceAdapter {
  const apiBase = options.apiBase ?? "https://api.stripe.com";
  const now = options.now ?? (() => new Date());

  const get = <S extends Schema.Top>(key: string, path: string, schema: S, params: Params = []) =>
    Effect.tryPromise({
      try: async (signal) => {
        const url = new URL(path, apiBase);
        for (const [name, value] of params) url.searchParams.append(name, value);
        const response = await options.fetch(url, {
          headers: { Authorization: `Bearer ${key}`, "Stripe-Version": STRIPE_VERSION },
          signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
        });
        const body = response.ok ? await response.json() : null;
        return { status: response.status, body };
      },
      catch: () => new SourceFailure({ code: "network" }),
    }).pipe(
      Effect.flatMap(({ status, body }) => {
        if (status === 404) return Effect.succeed(null);
        if (status === 401) return Effect.fail(new SourceFailure({ code: "invalid-key" }));
        if (status === 403) return Effect.fail(new SourceFailure({ code: "permission" }));
        if (status === 429) return Effect.fail(new SourceFailure({ code: "rate-limited" }));
        if (status < 200 || status > 299) return Effect.fail(new SourceFailure({ code: "stripe" }));
        return Schema.decodeUnknownEffect(schema)(body).pipe(
          Effect.mapError(() => new SourceFailure({ code: "stripe" })),
        );
      }),
    );

  const pages = <S extends Schema.Top>(
    key: string,
    path: string,
    item: S,
    params: Params,
    page: (data: readonly S["Type"][]) => Effect.Effect<void, SourceFailure | CrmError>,
  ) =>
    Effect.gen(function* () {
      let after: string | null = null;
      while (true) {
        const from: Params = after === null ? [] : [["starting_after", after]];
        const result = yield* get(key, path, list(item), [...params, ["limit", String(PAGE)], ...from]);
        if (result === null) return;
        yield* page(result.data);
        const last = result.data.at(-1);
        if (!result.has_more || !Schema.is(HasId)(last)) return;
        after = last.id;
      }
    });

  const account = (key: string) =>
    get(key, "/v1/account", Account).pipe(
      Effect.catchIf(
        (failure) => failure.code === "permission",
        () => Effect.succeed(null),
      ),
    );

  const open = (key: string): Effect.Effect<SourceSession, SourceFailure> =>
    Effect.gen(function* () {
      const settings = yield* account(key);
      const fallback = settings?.default_currency?.toUpperCase() ?? "USD";
      const customers = new Map<string, Customer | null>();
      const products = new Map<string, string>();

      const customerOf = (ref: string | Customer | null | undefined) =>
        Effect.gen(function* () {
          if (ref === null || ref === undefined) return null;
          if (typeof ref !== "string") return ref.deleted ? null : ref;
          const known = customers.get(ref);
          if (known !== undefined) return known;
          const found = yield* get(key, `/v1/customers/${encodeURIComponent(ref)}`, Customer);
          const live = found === null || found.deleted ? null : found;
          customers.set(ref, live);
          return live;
        });

      const sourceCustomer = (customer: Customer, currency: string | null): SourceCustomer => ({
        ref: `stripe:${customer.id}`,
        externalId: customer.id,
        name: customer.name ?? "",
        email: customer.email ?? "",
        phone: customer.phone ?? "",
        currency: customer.currency?.toUpperCase() ?? currency ?? fallback,
      });

      const productName = (product: string | { id: string; name?: string | null | undefined }) =>
        Effect.gen(function* () {
          if (typeof product !== "string") return product.name ?? "";
          const known = products.get(product);
          if (known !== undefined) return known;
          const found = yield* get(key, `/v1/products/${encodeURIComponent(product)}`, Product);
          const name = found?.name ?? "";
          products.set(product, name);
          return name;
        });

      const plan = (subscription: Subscription) =>
        Effect.gen(function* () {
          if (subscription.status === "incomplete" || subscription.status === "incomplete_expired") return null;
          const customer = yield* customerOf(subscription.customer);
          if (customer === null) return null;
          const currency = subscription.currency.toUpperCase();
          const items = subscription.items.data.filter((item) => item.price.recurring?.usage_type !== "metered");
          const recurring = subscription.items.data[0]?.price.recurring;
          const names: string[] = [];
          for (const item of subscription.items.data) {
            const name = (item.price.nickname ?? "").trim() || (yield* productName(item.price.product)).trim();
            if (name !== "" && !names.includes(name)) names.push(name);
          }
          const amount = items.reduce((sum, item) => sum + (item.price.unit_amount ?? 0) * (item.quantity ?? 1), 0);
          const startsOn = day(subscription.start_date);
          const end = subscription.ended_at ?? subscription.cancel_at ?? subscription.canceled_at ?? null;
          const endsOn = end === null ? null : day(end) < startsOn ? startsOn : day(end);
          return {
            ref: `stripe:${subscription.id}`,
            customer: sourceCustomer(customer, currency),
            name: names.join(" + ") || subscription.id,
            amountMinor: minor(amount, currency),
            currency,
            every: recurring ? every(recurring.interval, recurring.interval_count) : null,
            startsOn,
            endsOn,
          } satisfies SourcePlan;
        });

      const payment = (invoice: Invoice) =>
        Effect.gen(function* () {
          if (invoice.status !== "open" && invoice.status !== "paid" && invoice.status !== "uncollectible") {
            if (invoice.status !== "void") return null;
          }
          if (invoice.amount_due === 0 && invoice.amount_paid === 0) return null;
          const currency = invoice.currency.toUpperCase();
          const removed = invoice.status === "void";
          const found = yield* customerOf(invoice.customer);
          const ref = typeof invoice.customer === "string" ? invoice.customer : (invoice.customer?.id ?? null);
          const customer = found ?? (removed && ref !== null ? { id: ref } : null);
          if (customer === null) return null;
          const paid = invoice.status === "paid";
          const subscription = invoice.parent?.subscription_details?.subscription;
          const subscriptionId = typeof subscription === "string" ? subscription : (subscription?.id ?? null);
          return {
            ref: `stripe:${invoice.id}`,
            customer: sourceCustomer(customer, currency),
            planRef: subscriptionId === null ? null : `stripe:${subscriptionId}`,
            label: invoice.number || invoice.id,
            amountMinor: minor(paid ? invoice.amount_paid : invoice.amount_due, currency),
            currency,
            dueOn: day(invoice.due_date ?? invoice.created),
            paidAt: paid
              ? new Date((invoice.status_transitions?.paid_at ?? invoice.created) * 1000).toISOString()
              : null,
            removed,
          } satisfies SourcePayment;
        });

      const batch = (
        customers: readonly Customer[],
        subscriptions: readonly Subscription[],
        invoices: readonly Invoice[],
      ) =>
        Effect.gen(function* () {
          const plans: SourcePlan[] = [];
          for (const subscription of subscriptions) {
            const item = yield* plan(subscription);
            if (item !== null) plans.push(item);
          }
          const payments: SourcePayment[] = [];
          for (const invoice of invoices) {
            const item = yield* payment(invoice);
            if (item !== null) payments.push(item);
          }
          return {
            customers: customers
              .filter((customer) => !customer.deleted)
              .map((customer) => sourceCustomer(customer, null)),
            plans,
            payments,
          } satisfies SourceBatch;
        });

      return {
        objects: (refs) =>
          Effect.gen(function* () {
            const subscriptions: Subscription[] = [];
            const invoices: Invoice[] = [];
            for (const ref of refs) {
              const id = ref.slice("stripe:".length);
              const path = encodeURIComponent(id);
              if (id.startsWith("sub_")) {
                const subscription = yield* get(key, `/v1/subscriptions/${path}`, Subscription, [
                  ["expand[]", "customer"],
                ]);
                if (subscription !== null) subscriptions.push(subscription);
              } else if (id.startsWith("in_")) {
                const invoice = yield* get(key, `/v1/invoices/${path}`, Invoice, [["expand[]", "customer"]]);
                if (invoice !== null) invoices.push(invoice);
              }
            }
            return yield* batch([], subscriptions, invoices);
          }),
        list: (page) =>
          Effect.gen(function* () {
            const expand = [["expand[]", "data.customer"]] as const;
            for (const status of ["active", "past_due", "trialing"])
              yield* pages(key, "/v1/subscriptions", Subscription, [...expand, ["status", status]], (data) =>
                batch([], data, []).pipe(Effect.flatMap(page)),
              );
            const since = String(Math.floor(now().getTime() / 1000) - 365 * 24 * 60 * 60);
            for (const params of [
              [["status", "open"]],
              [["status", "uncollectible"]],
              [
                ["status", "paid"],
                ["created[gte]", since],
              ],
            ] as const)
              yield* pages(key, "/v1/invoices", Invoice, [...expand, ...params], (data) =>
                batch([], [], data).pipe(Effect.flatMap(page)),
              );
            yield* pages(key, "/v1/customers", Customer, [], (data) => batch(data, [], []).pipe(Effect.flatMap(page)));
          }),
      } satisfies SourceSession;
    });

  return {
    kind: "stripe",
    check: (key) =>
      Effect.gen(function* () {
        if (key.startsWith("sk_"))
          return yield* new CrmError({ code: "refused", message: sourceText("error.crm.sourceSecretKey") });
        const mode = /^rk_(live|test)_[A-Za-z0-9]+$/u.exec(key)?.[1];
        if (mode === undefined) return yield* new SourceFailure({ code: "invalid-key" });
        for (const resource of RESOURCES) yield* get(key, `/v1/${resource}`, list(Schema.Unknown), [["limit", "1"]]);
        const settings = yield* account(key);
        return {
          testMode: mode === "test",
          accountLabel: settings?.settings?.dashboard?.display_name || settings?.business_profile?.name || "",
        } satisfies SourceAccount;
      }),
    open,
  };
}
