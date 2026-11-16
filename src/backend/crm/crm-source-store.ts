import {
  CRM_LIMITS,
  type CrmEvery,
  type CrmSource,
  type CrmSourceError,
  type CrmSourceKind,
  type CrmSourceSyncState,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { databaseRow, databaseRows, optionalStringColumn, requiredStringColumn } from "../database/database-rows";
import { type CrmDetails, type CrmStore, CrmWrite, crmRefused, newCrmId } from "./crm-store";

/**
 * The rows of a payment source in the CRM: the `crm_sources` row, the refs that a person deleted,
 * and the customers, plans and payments that a sync writes. The source owns the plans and payments it
 * writes; customers take its fields only at import, and later CRM edits stay.
 */

/** A customer at the source. `currency` is the customer's, else the account default. */
export interface SourceCustomer {
  /** Unique over all sources, such as `stripe:cus_…`. */
  ref: string;
  /** The id at the source, kept in `stripeCustomerId`. */
  externalId: string;
  name: string;
  email: string;
  phone: string;
  currency: string;
}

/** A subscription. `every` null: an interval that the CRM does not have. */
export interface SourcePlan {
  ref: string;
  customer: SourceCustomer;
  name: string;
  amountMinor: number;
  currency: string;
  every: Exclude<CrmEvery, "once"> | null;
  startsOn: string;
  endsOn: string | null;
}

/** An invoice. `removed`: the source voided or deleted it. */
export interface SourcePayment {
  ref: string;
  customer: SourceCustomer;
  planRef: string | null;
  label: string;
  amountMinor: number;
  currency: string;
  dueOn: string;
  paidAt: string | null;
  removed: boolean;
}

export interface SourceBatch {
  customers: readonly SourceCustomer[];
  plans: readonly SourcePlan[];
  payments: readonly SourcePayment[];
}

export interface SourceSkips {
  currency: number;
  interval: number;
  limit: number;
}

export interface SourceStatePatch {
  state: CrmSourceSyncState;
  errorCode?: CrmSourceError | null;
  syncedAt?: string;
  skipped?: SourceSkips;
}

const TABLES = ["crm_customers", "crm_plans", "crm_payments"] as const;

/** Source text as a CRM label: no outer spaces, as the decoders need, and at most `limit` long. */
function cut(value: string, limit: number): string {
  return value.trim().slice(0, limit).trim();
}

export class CrmSourceStore {
  readonly #store: CrmStore;

  constructor(store: CrmStore) {
    this.#store = store;
  }

  get #db() {
    return this.#store.db;
  }

  /** Adds the source and gives it back the rows of an earlier connection of the same kind. */
  insert(input: { kind: CrmSourceKind; testMode: boolean; accountLabel: string; keyHint: string }): CrmSource {
    return this.#store.transaction(() => {
      if (databaseRow(this.#db.prepare("SELECT 1 AS found FROM crm_sources WHERE kind = ?").get(input.kind)))
        throw crmRefused("error.crm.sourceConnected");
      const sourceId = newCrmId();
      this.#db
        .prepare(
          `INSERT INTO crm_sources (source_id, kind, test_mode, account_label, key_hint, state, connected_at)
           VALUES (?, ?, ?, ?, ?, 'syncing', ?)`,
        )
        .run(
          sourceId,
          input.kind,
          input.testMode ? 1 : 0,
          cut(input.accountLabel, 200),
          input.keyHint,
          this.#store.timestamp(),
        );
      // Refs start with the kind, and one source of each kind can be connected.
      for (const table of TABLES)
        this.#db
          .prepare(`UPDATE ${table} SET source_id = ? WHERE source_id IS NULL AND source_ref LIKE ? ESCAPE '\\'`)
          .run(sourceId, `${input.kind}:%`);
      return this.#store.source(sourceId);
    });
  }

  /** Removes the source. Its rows stay, editable, with their refs for a later reconnect. */
  delete(sourceId: string): CrmSource {
    return this.#store.transaction(() => {
      const source = this.#store.source(sourceId);
      for (const table of TABLES)
        this.#db.prepare(`UPDATE ${table} SET source_id = NULL WHERE source_id = ?`).run(sourceId);
      this.#db.prepare("DELETE FROM crm_sources WHERE source_id = ?").run(sourceId);
      return source;
    });
  }

  /** Writes the sync state. False when the source is gone, such as after a disconnect during a sync. */
  setState(sourceId: string, patch: SourceStatePatch): boolean {
    const sets = ["state = ?", "error_code = ?"];
    const values: (string | null)[] = [patch.state, patch.errorCode ?? null];
    if (patch.syncedAt !== undefined) {
      sets.push("synced_at = ?");
      values.push(patch.syncedAt);
    }
    if (patch.skipped !== undefined) {
      sets.push("skipped_json = ?");
      values.push(JSON.stringify(patch.skipped));
    }
    const result = this.#db
      .prepare(`UPDATE crm_sources SET ${sets.join(", ")} WHERE source_id = ?`)
      .run(...values, sourceId);
    return Number(result.changes) > 0;
  }

  /** The plans and open payments that the source owns and that can still change. */
  openRefs(sourceId: string): string[] {
    const rows = databaseRows(
      this.#db
        .prepare(
          `SELECT source_ref FROM crm_plans WHERE source_id = ?1 AND (ends_on IS NULL OR ends_on >= ?2)
           UNION ALL SELECT source_ref FROM crm_payments WHERE source_id = ?1 AND paid_at IS NULL`,
        )
        .all(sourceId, this.#store.today()),
    );
    return rows.map((row) => requiredStringColumn(row, "source_ref"));
  }

  /** Writes one page of the source in one transaction. */
  apply(sourceId: string, batch: SourceBatch, skips: SourceSkips): { changed: boolean } {
    return this.#store.transaction(() => {
      const source = this.#store.source(sourceId);
      const sync = new SourceSync(this.#store, source, skips);
      for (const plan of batch.plans) sync.plan(plan);
      for (const payment of batch.payments) sync.payment(payment);
      for (const customer of batch.customers) sync.customer(customer, false);
      return { changed: sync.finish() };
    });
  }
}

/** The rows of one page. Customers resolve in this order: ref, source id, one email match, import. */
class SourceSync {
  readonly #store: CrmStore;
  readonly #source: CrmSource;
  readonly #skips: SourceSkips;
  readonly #write: CrmWrite;
  readonly #resolved = new Map<string, string | null>();
  #emails: Map<string, string[]> | null = null;
  #changed = false;

  constructor(store: CrmStore, source: CrmSource, skips: SourceSkips) {
    this.#store = store;
    this.#source = source;
    this.#skips = skips;
    this.#write = new CrmWrite(store, { kind: "source", id: source.kind, name: null }, null);
  }

  get #db() {
    return this.#store.db;
  }

  finish(): boolean {
    this.#write.finish();
    return this.#changed;
  }

  #record(customerId: string, kind: string, details: CrmDetails): void {
    this.#write.record(customerId, kind, details);
    this.#changed = true;
  }

  #row(table: (typeof TABLES)[number], ref: string): DynamicRecord | null {
    return databaseRow(this.#db.prepare(`SELECT * FROM ${table} WHERE source_ref = ?`).get(ref)) ?? null;
  }

  #own(table: (typeof TABLES)[number], idColumn: string, id: string): void {
    this.#db
      .prepare(`UPDATE ${table} SET source_id = ? WHERE ${idColumn} = ? AND source_id IS NOT ?`)
      .run(this.#source.id, id, this.#source.id);
  }

  /** The CRM customer of `customer`, or null when a person deleted it. `paying` sets the status of an import. */
  customer(customer: SourceCustomer, paying: boolean): string | null {
    const known = this.#resolved.get(customer.ref);
    if (known !== undefined) {
      if (known !== null && paying) this.#promote(known);
      return known;
    }
    const customerId = this.#resolve(customer, paying);
    this.#resolved.set(customer.ref, customerId);
    return customerId;
  }

  #resolve(customer: SourceCustomer, paying: boolean): string | null {
    if (
      databaseRow(this.#db.prepare("SELECT 1 AS found FROM crm_source_ignored WHERE source_ref = ?").get(customer.ref))
    )
      return null;
    const linked = this.#row("crm_customers", customer.ref);
    if (linked) {
      const customerId = requiredStringColumn(linked, "customer_id");
      this.#own("crm_customers", "customer_id", customerId);
      if (paying) this.#promote(customerId);
      return customerId;
    }
    const match = this.#match(customer);
    if (match !== null) {
      this.#db
        .prepare(
          `UPDATE crm_customers SET source_id = ?, source_ref = ?,
             stripe_customer_id = CASE WHEN stripe_customer_id = '' THEN ? ELSE stripe_customer_id END
           WHERE customer_id = ?`,
        )
        .run(this.#source.id, customer.ref, customer.externalId, match);
      this.#record(match, "customer-linked", { source: this.#source.kind, id: customer.externalId });
      if (paying) this.#promote(match);
      return match;
    }
    const customerId = this.#write.createCustomer({
      name:
        cut(customer.name, CRM_LIMITS.name) ||
        cut(customer.email, CRM_LIMITS.name) ||
        cut(customer.externalId, CRM_LIMITS.name),
      currency: customer.currency,
      statusId: paying ? "customer" : "lead",
      method: "stripe",
      contactEmail: cut(customer.email, CRM_LIMITS.text),
      phone: cut(customer.phone, CRM_LIMITS.text),
      stripeCustomerId: cut(customer.externalId, CRM_LIMITS.text),
    });
    this.#db
      .prepare("UPDATE crm_customers SET source_id = ?, source_ref = ? WHERE customer_id = ?")
      .run(this.#source.id, customer.ref, customerId);
    this.#changed = true;
    return customerId;
  }

  /** An unlinked customer with the same source id, else the only one with the same email. */
  #match(customer: SourceCustomer): string | null {
    const byId = databaseRow(
      this.#db
        .prepare("SELECT customer_id FROM crm_customers WHERE stripe_customer_id = ? AND source_ref IS NULL LIMIT 1")
        .get(customer.externalId),
    );
    if (byId) return requiredStringColumn(byId, "customer_id");
    const email = customer.email.trim().toLowerCase();
    if (email === "") return null;
    const found = this.#emailIndex().get(email) ?? [];
    return found.length === 1 ? (found[0] ?? null) : null;
  }

  #emailIndex(): Map<string, string[]> {
    if (this.#emails !== null) return this.#emails;
    const emails = new Map<string, string[]>();
    const rows = databaseRows(
      this.#db
        .prepare(
          `SELECT customer_id, contact_email, billing_email FROM crm_customers
           WHERE source_ref IS NULL AND stripe_customer_id = ''`,
        )
        .all(),
    );
    for (const row of rows) {
      const customerId = requiredStringColumn(row, "customer_id");
      const own = new Set(
        [row.contact_email, row.billing_email]
          .filter(isString)
          .map((value) => value.trim().toLowerCase())
          .filter((value) => value !== ""),
      );
      for (const email of own) emails.set(email, [...(emails.get(email) ?? []), customerId]);
    }
    this.#emails = emails;
    return emails;
  }

  /** A lead that pays becomes a customer. */
  #promote(customerId: string): void {
    const customer = this.#store.customerRecord(customerId);
    if (customer.statusId !== "lead") return;
    const from = this.#store.status("lead");
    const to = this.#store.status("customer");
    this.#db.prepare("UPDATE crm_customers SET status_id = ? WHERE customer_id = ?").run(to.id, customerId);
    this.#record(customerId, "status-changed", { from: from.id, to: to.id, fromLabel: from.label, toLabel: to.label });
  }

  /** The customer of a plan or payment in its currency, or null when the row is skipped. */
  #owner(customer: SourceCustomer, currency: string, paying: boolean): string | null {
    const customerId = this.customer(customer, paying);
    if (customerId === null) return null;
    if (this.#store.customerRecord(customerId).currency !== currency) {
      this.#skips.currency += 1;
      return null;
    }
    return customerId;
  }

  plan(plan: SourcePlan): void {
    const active = plan.endsOn === null || plan.endsOn >= this.#store.today();
    const existing = this.#row("crm_plans", plan.ref);
    // A subscription that ended before the CRM knew it is history that the invoices already show.
    if (existing === null && !active) return;
    if (plan.every === null) {
      if (existing === null) this.#skips.interval += 1;
      // The CRM cannot show the new interval, but it still shows that the plan ended.
      else this.#planEnd(existing, plan.endsOn, cut(plan.name, CRM_LIMITS.label));
      return;
    }
    const customerId = this.#owner(plan.customer, plan.currency, active);
    if (customerId === null) return;
    const name = cut(plan.name, CRM_LIMITS.label);
    if (existing === null) {
      const count = databaseRow(
        this.#db.prepare("SELECT count(*) AS count FROM crm_plans WHERE customer_id = ?").get(customerId),
      );
      if (Number(count?.count ?? 0) >= CRM_LIMITS.customerPlans) {
        this.#skips.limit += 1;
        return;
      }
      const at = this.#write.at;
      this.#db
        .prepare(
          `INSERT INTO crm_plans (plan_id, customer_id, name, amount_minor, every, starts_on, ends_on, source_id,
             source_ref, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          newCrmId(),
          customerId,
          name,
          plan.amountMinor,
          plan.every,
          plan.startsOn,
          plan.endsOn,
          this.#source.id,
          plan.ref,
          at,
          at,
        );
      this.#record(customerId, "plan-created", {
        plan: name,
        amountMinor: plan.amountMinor,
        currency: plan.currency,
        every: plan.every,
        startsOn: plan.startsOn,
        payment: null,
      });
      return;
    }
    const planId = requiredStringColumn(existing, "plan_id");
    const owner = requiredStringColumn(existing, "customer_id");
    this.#own("crm_plans", "plan_id", planId);
    // Remove the old end first: the CHECK ends_on >= starts_on refuses a new start after the old end.
    if (existing.ends_on !== plan.endsOn && existing.ends_on !== null)
      this.#db.prepare("UPDATE crm_plans SET ends_on = NULL WHERE plan_id = ?").run(planId);
    const before = existing.name;
    const changes = [
      ["name", "name", existing.name, name],
      ["amountMinor", "amount_minor", existing.amount_minor, plan.amountMinor],
      ["every", "every", existing.every, plan.every],
      ["startsOn", "starts_on", existing.starts_on, plan.startsOn],
    ] as const;
    for (const [field, column, from, to] of changes) {
      if (from === to) continue;
      this.#update("crm_plans", "plan_id", planId, column, to);
      this.#record(owner, "plan-changed", {
        plan: isString(before) ? before : name,
        field,
        from: isString(from) || typeof from === "number" ? from : null,
        to,
        currency: plan.currency,
      });
    }
    this.#planEnd(existing, plan.endsOn, name);
  }

  #planEnd(existing: DynamicRecord, endsOn: string | null, name: string): void {
    if (existing.ends_on === endsOn) return;
    this.#update("crm_plans", "plan_id", requiredStringColumn(existing, "plan_id"), "ends_on", endsOn);
    if (endsOn !== null)
      this.#record(requiredStringColumn(existing, "customer_id"), "plan-ended", {
        plan: name,
        endsOn,
        removedPayments: 0,
      });
  }

  payment(payment: SourcePayment): void {
    const existing = this.#row("crm_payments", payment.ref);
    if (payment.removed) {
      if (existing === null || existing.paid_at !== null) return;
      const customerId = requiredStringColumn(existing, "customer_id");
      this.#db
        .prepare("DELETE FROM crm_payments WHERE payment_id = ?")
        .run(requiredStringColumn(existing, "payment_id"));
      this.#record(customerId, "payment-deleted", {
        number: Number(existing.number),
        label: requiredStringColumn(existing, "label"),
        amountMinor: Number(existing.amount_minor),
        currency: payment.currency,
        paidAt: null,
      });
      return;
    }
    const paying = payment.paidAt !== null;
    const customerId = this.#owner(payment.customer, payment.currency, paying);
    if (customerId === null) return;
    const label = cut(payment.label, CRM_LIMITS.label);
    const planId =
      payment.planRef === null
        ? null
        : optionalStringColumn(
            databaseRow(
              this.#db
                .prepare("SELECT plan_id FROM crm_plans WHERE source_ref = ? AND customer_id = ?")
                .get(payment.planRef, customerId),
            ) ?? { plan_id: null },
            "plan_id",
          );
    if (existing === null) {
      const created = this.#write.insertPayment({
        customerId,
        planId,
        label,
        amountMinor: payment.amountMinor,
        dueOn: payment.dueOn,
        paidAt: payment.paidAt,
        method: "stripe",
        source: { id: this.#source.id, ref: payment.ref },
      });
      this.#record(customerId, "payment-created", {
        number: created.number,
        label,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        dueOn: payment.dueOn,
        paidAt: payment.paidAt,
      });
      return;
    }
    const paymentId = requiredStringColumn(existing, "payment_id");
    const owner = requiredStringColumn(existing, "customer_id");
    const number = Number(existing.number);
    this.#own("crm_payments", "payment_id", paymentId);
    if (existing.plan_id !== planId && planId !== null)
      this.#update("crm_payments", "payment_id", paymentId, "plan_id", planId);
    const changes = [
      ["label", "label", existing.label, label],
      ["amountMinor", "amount_minor", existing.amount_minor, payment.amountMinor],
      ["dueOn", "due_on", existing.due_on, payment.dueOn],
    ] as const;
    for (const [field, column, from, to] of changes) {
      if (from === to) continue;
      this.#update("crm_payments", "payment_id", paymentId, column, to);
      this.#record(owner, "payment-changed", {
        number,
        field,
        from: isString(from) || typeof from === "number" ? from : null,
        to,
        currency: payment.currency,
      });
    }
    const paidAt = optionalStringColumn(existing, "paid_at");
    if (paidAt === payment.paidAt) return;
    this.#update("crm_payments", "payment_id", paymentId, "paid_at", payment.paidAt);
    if (payment.paidAt === null) this.#record(owner, "payment-unpaid", { number, label });
    else if (paidAt === null)
      this.#record(owner, "payment-paid", {
        number,
        label,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        paidAt: payment.paidAt,
      });
    else this.#record(owner, "payment-changed", { number, field: "paidAt", from: paidAt, to: payment.paidAt });
  }

  #update(
    table: "crm_plans" | "crm_payments",
    idColumn: string,
    id: string,
    column: string,
    value: string | number | null,
  ): void {
    this.#db
      .prepare(`UPDATE ${table} SET ${column} = ?, updated_at = ? WHERE ${idColumn} = ?`)
      .run(value, this.#write.at, id);
  }
}
