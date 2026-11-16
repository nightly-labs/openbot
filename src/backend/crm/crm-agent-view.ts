import type { SQLInputValue } from "node:sqlite";
import {
  CRM_LIMITS,
  CRM_PRIVATE_FIELDS,
  CRM_TEXT_FIELDS,
  type CrmActivity,
  type CrmCustomer,
  type CrmEvery,
  type CrmMethod,
  type CrmPrivateField,
  type CrmTextField,
  isCrmProposedChange,
} from "@openbot/contracts/ipc";
import { isNumber, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import type { Effect } from "effect";
import { databaseRows } from "../database/database-rows";
import { CrmError } from "./crm-handle";
import {
  CRM_CUSTOMER_COLUMNS,
  CRM_PAYMENT_SELECT,
  type CrmDetails,
  type CrmPaymentRecord,
  type CrmStore,
  crmMissing,
  crmRefused,
  decodeCrmActivity,
  decodeCrmCustomer,
  decodeCrmNumberCursor,
  decodeCrmPayment,
  encodeCrmCursor,
  normalizeCrmSearch,
} from "./crm-store";

/**
 * What an agent reads and proposes through its CRM tools. Only agents that an owner or admin let in
 * use it. A private name reads as `Customer <number>`; another private text field reads as `hidden`,
 * and a search never matches a private value. A private part (amounts, dates, status, tags, plans,
 * method, owner) is not in the answer at all, because a `hidden` mark only where a value exists
 * would show that it exists. A filter or order on a private part is refused, and activity loses the
 * entries and values of private parts. Each answer lists `hiddenFields`. Amounts are decimal text in
 * the customer's currency, such as "129.00 EUR". Nothing here goes to the shared agent data tables:
 * each answer is built from the CRM tables for one tool call.
 */

const CRM_HIDDEN = "hidden";

type Hidden = ReadonlySet<CrmPrivateField>;

/** The private parts that an activity entry is about. The agent does not get an entry when one is hidden. */
function activityParts(kind: string, field: unknown): CrmPrivateField[] {
  const parts: CrmPrivateField[] = [];
  if (kind === "status-changed") parts.push("status");
  if (kind === "tags-changed") parts.push("tags");
  if (kind.startsWith("plan-")) parts.push("plans");
  if (field === "ownerAgentId") parts.push("owner");
  if (field === "method") parts.push("method");
  if (field === "amountMinor") parts.push("amounts");
  if (field === "dueOn" || field === "paidAt") parts.push("dates");
  return parts;
}

/** The detail keys that show a private part in an activity entry about something else. */
const PART_KEYS: { [Part in CrmPrivateField]?: readonly string[] } = {
  amounts: ["amountMinor"],
  dates: ["dueOn", "paidAt", "startsOn", "endsOn"],
  // A payment label can be the plan name, and the entry does not say if the payment had a plan.
  plans: ["plan", "label"],
};

function hiddenList(hidden: Hidden): CrmPrivateField[] {
  return CRM_PRIVATE_FIELDS.filter((field) => hidden.has(field));
}

export interface CrmAgentFindInput {
  /** Text in a visible field, or a customer number such as "12" or "Customer 12". */
  query?: string | undefined;
  /** A status id or label. */
  status?: string | undefined;
  /** A tag id or label. */
  tag?: string | undefined;
  payment?: "late" | "open" | "paid-up" | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

export interface CrmAgentPaymentsInput {
  state: "open" | "late";
  customerId?: string | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

type AgentCustomerFields = { [Field in CrmTextField]?: string | undefined } & {
  /** A status id or label. */
  status?: string | undefined;
  ownerAgentId?: string | null | undefined;
  method?: CrmMethod | null | undefined;
  currency?: string | undefined;
};

/** A proposed change as the tool takes it: decimal amounts, and statuses and tags by id or label. */
export type CrmAgentChange =
  | {
      kind: "customer-create";
      customer: AgentCustomerFields & { name: string; currency: string; tags?: string[] | undefined };
    }
  | { kind: "customer-update"; customerId: string; patch: AgentCustomerFields }
  | { kind: "customer-tags"; customerId: string; tags: string[] }
  | {
      kind: "plan-create";
      plan: { customerId: string; name: string; amount: string; every: CrmEvery; startsOn: string };
    }
  | {
      kind: "plan-update";
      planId: string;
      patch: { name?: string | undefined; amount?: string | undefined; every?: CrmEvery | undefined };
    }
  | { kind: "plan-end"; planId: string; endsOn: string }
  | {
      kind: "payment-create";
      payment: {
        customerId: string;
        label: string;
        amount: string;
        dueOn: string;
        method?: CrmMethod | null | undefined;
        paidAt?: string | null | undefined;
      };
    }
  | {
      kind: "payment-update";
      paymentId: string;
      patch: {
        label?: string | undefined;
        amount?: string | undefined;
        dueOn?: string | undefined;
        method?: CrmMethod | null | undefined;
      };
    }
  | { kind: "payment-paid"; paymentIds: string[]; paidAt: string | null }
  | { kind: "payment-split"; paymentId: string; parts: { amount: string; dueOn: string }[] };

export interface CrmAgentProposeInput {
  change: CrmAgentChange;
  reason: string;
  threadId: string | null;
}

type CrmAgentValue = string | number | boolean | null | CrmAgentValue[] | { [key: string]: CrmAgentValue };
export type CrmAgentRecord = { [key: string]: CrmAgentValue };

export interface CrmAgentOperations {
  agentFind(agentId: string, input: CrmAgentFindInput): Effect.Effect<CrmAgentRecord, CrmError>;
  agentCustomer(agentId: string, customerId: string): Effect.Effect<CrmAgentRecord, CrmError>;
  agentPayments(agentId: string, input: CrmAgentPaymentsInput): Effect.Effect<CrmAgentRecord, CrmError>;
  agentPropose(agentId: string, input: CrmAgentProposeInput): Effect.Effect<{ proposalId: string }, CrmError>;
}

// --- Amounts -------------------------------------------------------------------------------------

const exponents = new Map<string, number>();

/** The number of minor-unit digits of an ISO 4217 currency: 2 for EUR, 0 for JPY, 3 for KWD. */
function crmCurrencyExponent(currency: string): number {
  const known = exponents.get(currency);
  if (known !== undefined) return known;
  let exponent = 2;
  try {
    exponent =
      new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    // An unknown code keeps two digits, as most currencies have.
  }
  exponents.set(currency, exponent);
  return exponent;
}

/** Exact decimal text of minor units, such as "129.00 EUR". */
function formatCrmAmount(minor: number, currency: string): string {
  const exponent = crmCurrencyExponent(currency);
  const digits = String(minor).padStart(exponent + 1, "0");
  const value = exponent === 0 ? digits : `${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
  return `${value} ${currency}`;
}

/** Minor units of decimal text such as "129", "129.5" or "129.50 EUR". */
function parseCrmAmount(text: string, currency: string): number {
  // A comma groups thousands only ("1,290.50"). "129,50" is refused, not read as 12950.
  const plain = text.trim().replace(/^\d{1,3}(?:,\d{3})+(?=\.|\s|$)/u, (whole) => whole.replaceAll(",", ""));
  const match = /^(\d+)(?:\.(\d+))?(?:\s+([A-Za-z]{3}))?$/u.exec(plain);
  const whole = match?.[1];
  if (!match || whole === undefined || (match[3] !== undefined && match[3].toUpperCase() !== currency))
    throw crmRefused("error.crm.amountInvalid");
  const exponent = crmCurrencyExponent(currency);
  const fraction = (match[2] ?? "").replace(/0+$/u, "");
  if (fraction.length > exponent)
    throw new CrmError({ code: "refused", message: sourceText("error.crm.amountDecimals", { currency }) });
  const digits = `${whole}${fraction.padEnd(exponent, "0")}`.replace(/^0+(?=\d)/u, "");
  if (digits.length > 13) throw crmRefused("error.crm.amountInvalid");
  return Number(digits);
}

// --- Output --------------------------------------------------------------------------------------

/** Drops empty values, so each answer stays short. */
function compact(record: { [key: string]: CrmAgentValue | undefined }): CrmAgentRecord {
  const result: CrmAgentRecord = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    result[key] = value;
  }
  return result;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const CUSTOMER_OPEN_PAYMENTS = 50;
const CUSTOMER_PAID_PAYMENTS = 10;
const CUSTOMER_ACTIVITY = 20;

function limitOf(limit: number | undefined): number {
  return Math.min(Math.max(Math.trunc(limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
}

export class CrmAgentView {
  readonly #store: CrmStore;

  constructor(store: CrmStore) {
    this.#store = store;
  }

  #allow(agentId: string): Hidden {
    if (!this.#store.hasAgentAccess(agentId)) throw crmRefused("error.crm.agentNotAllowed");
    return new Set(this.#store.privateFields());
  }

  #name(name: string, number: number, hidden: Hidden): string {
    return hidden.has("name") ? `Customer ${number}` : name;
  }

  #statusName(statusId: string): string {
    const status = this.#store.statuses().find((item) => item.id === statusId);
    return status?.label ?? statusId;
  }

  /** A status by id, or by label with any case. */
  #resolveStatus(value: string): string {
    const lower = value.toLowerCase();
    const status = this.#store
      .statuses()
      .find((item) => item.id === value || item.label?.toLowerCase() === lower || item.id === lower);
    if (!status) throw crmMissing("error.crm.statusMissing");
    return status.id;
  }

  /** A tag by id, or by label with any case. */
  #resolveTag(value: string): string {
    const lower = value.toLowerCase();
    const tag = this.#store.tags().find((item) => item.id === value || item.label.toLowerCase() === lower);
    if (!tag) throw crmMissing("error.crm.tagMissing");
    return tag.id;
  }

  #tagLabels(tagIds: readonly string[]): string[] {
    const labels = new Map(this.#store.tags().map((tag) => [tag.id, tag.label]));
    return tagIds.flatMap((tagId) => {
      const label = labels.get(tagId);
      return label === undefined ? [] : [label];
    });
  }

  #summary(customer: CrmCustomer, hidden: Hidden): CrmAgentRecord {
    const amounts = !hidden.has("amounts");
    const dates = !hidden.has("dates");
    return compact({
      id: customer.id,
      number: customer.number,
      name: this.#name(customer.name, customer.number, hidden),
      status: hidden.has("status") ? null : this.#statusName(customer.statusId),
      tags: hidden.has("tags") ? null : this.#tagLabels(customer.tagIds),
      open: amounts && customer.openMinor > 0 ? formatCrmAmount(customer.openMinor, customer.currency) : null,
      // A late amount shows that a due date has passed.
      late: amounts && dates && customer.lateMinor > 0 ? formatCrmAmount(customer.lateMinor, customer.currency) : null,
      nextDueOn: dates ? customer.nextDueOn : null,
    });
  }

  #payment(payment: CrmPaymentRecord, hidden: Hidden): CrmAgentRecord {
    return compact({
      id: payment.id,
      number: payment.number,
      customer: { id: payment.customerId, name: this.#name(payment.customerName, payment.customerNumber, hidden) },
      // A plan payment has the plan name as its label.
      label: hidden.has("plans") && payment.planId !== null ? null : payment.label,
      amount: hidden.has("amounts") ? null : formatCrmAmount(payment.amountMinor, payment.currency),
      dueOn: hidden.has("dates") ? null : payment.dueOn,
      paidAt: hidden.has("dates") ? null : payment.paidAt,
      planId: hidden.has("plans") ? null : payment.planId,
      method: hidden.has("method") ? null : payment.method,
      source: payment.source,
    });
  }

  #activity(activity: CrmActivity, hidden: Hidden): CrmAgentRecord | null {
    const details: CrmDetails = { ...activity.details };
    const field = details.field;
    if (activityParts(activity.kind, field).some((part) => hidden.has(part))) return null;
    if (isOneOf(CRM_TEXT_FIELDS, field) && hidden.has(field)) {
      details.from = CRM_HIDDEN;
      details.to = CRM_HIDDEN;
    }
    for (const part of hidden) for (const key of PART_KEYS[part] ?? []) delete details[key];
    // The id of a link is the Stripe customer id.
    if (activity.kind === "customer-linked" && hidden.has("stripeCustomerId")) delete details.id;
    const currency = details.currency;
    if (isString(currency)) {
      for (const key of ["amountMinor", ...(field === "amountMinor" ? ["from", "to"] : [])]) {
        const value = details[key];
        if (isNumber(value)) details[key === "amountMinor" ? "amount" : key] = formatCrmAmount(value, currency);
      }
      if (field === "amountMinor") details.field = "amount";
      delete details.amountMinor;
      delete details.currency;
    }
    const actor = activity.actor;
    return compact({
      at: activity.createdAt,
      kind: activity.kind,
      by: actor.kind === "person" ? (actor.name ?? "owner") : actor.id,
      proposedBy: activity.proposedBy,
      ...details,
    });
  }

  find(agentId: string, input: CrmAgentFindInput): CrmAgentRecord {
    const hidden = this.#allow(agentId);
    const values: SQLInputValue[] = [this.#store.today()];
    const param = (value: SQLInputValue) => {
      values.push(value);
      return `?${values.length}`;
    };
    const where: string[] = [];
    const query = input.query?.trim();
    if (query) {
      const matches: string[] = [];
      const visible = CRM_TEXT_FIELDS.filter((field) => !hidden.has(field));
      if (visible.length > 0) {
        const pattern = `%${normalizeCrmSearch(query).replace(/[\\%_]/gu, "\\$&")}%`;
        matches.push(`EXISTS (SELECT 1 FROM json_each(c.search_text) AS j
          WHERE j.key IN (SELECT value FROM json_each(${param(JSON.stringify(visible))}))
          AND j.value LIKE ${param(pattern)} ESCAPE '\\')`);
      }
      const number = /^(?:customer\s*)?#?(\d{1,15})$/iu.exec(query)?.[1];
      if (number !== undefined) matches.push(`c.number = ${param(Number(number))}`);
      where.push(matches.length > 0 ? `(${matches.join(" OR ")})` : "0");
    }
    const refuse = (part: CrmPrivateField) => {
      if (hidden.has(part)) throw crmRefused("error.crm.fieldPrivate");
    };
    if (input.status !== undefined) refuse("status");
    if (input.tag !== undefined) refuse("tags");
    if (input.payment === "late" || input.payment === "paid-up") refuse("dates");
    if (input.status !== undefined) where.push(`c.status_id = ${param(this.#resolveStatus(input.status))}`);
    if (input.tag !== undefined)
      where.push(
        `EXISTS (SELECT 1 FROM crm_customer_tags AS ct WHERE ct.customer_id = c.customer_id AND ct.tag_id = ${param(this.#resolveTag(input.tag))})`,
      );
    const late =
      "EXISTS (SELECT 1 FROM crm_payments AS p WHERE p.customer_id = c.customer_id AND p.paid_at IS NULL AND p.due_on < ?1)";
    if (input.payment === "late") where.push(late);
    if (input.payment === "paid-up") where.push(`NOT ${late}`);
    if (input.payment === "open")
      where.push("EXISTS (SELECT 1 FROM crm_payments AS p WHERE p.customer_id = c.customer_id AND p.paid_at IS NULL)");
    if (input.cursor !== undefined) {
      const after = Number(input.cursor);
      if (!Number.isSafeInteger(after) || after < 0) throw crmRefused("error.crm.badCursor");
      where.push(`c.number > ${param(after)}`);
    }
    const limit = limitOf(input.limit);
    const rows = databaseRows(
      this.#store.db
        .prepare(
          `SELECT ${CRM_CUSTOMER_COLUMNS} FROM crm_customers AS c
           ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY c.number LIMIT ${param(limit + 1)}`,
        )
        .all(...values),
    ).map(decodeCrmCustomer);
    const customers = rows.slice(0, limit);
    const last = customers.at(-1);
    // An empty list stays, so the agent reads that nothing matched.
    return {
      customers: customers.map((customer) => this.#summary(customer, hidden)),
      ...(rows.length > limit && last ? { next: String(last.number) } : {}),
      ...compact({ hiddenFields: hiddenList(hidden) }),
    };
  }

  customer(agentId: string, customerId: string): CrmAgentRecord {
    const hidden = this.#allow(agentId);
    const customer = this.#store.customer(customerId);
    const text: { [key: string]: CrmAgentValue } = {};
    for (const field of CRM_TEXT_FIELDS) {
      if (field === "name") continue;
      text[field] = hidden.has(field) ? CRM_HIDDEN : customer[field];
    }
    const payments = (where: string, order: string, limit: number) =>
      databaseRows(
        this.#store.db
          .prepare(`${CRM_PAYMENT_SELECT} WHERE p.customer_id = ? AND ${where} ORDER BY ${order} LIMIT ?`)
          .all(customer.id, limit),
      ).map((row) => {
        const { customer: _customer, ...payment } = this.#payment(decodeCrmPayment(row), hidden);
        return payment;
      });
    const activity = databaseRows(
      this.#store.db
        .prepare("SELECT * FROM crm_activity WHERE customer_id = ? ORDER BY created_at DESC, activity_id DESC LIMIT ?")
        .all(customer.id, CUSTOMER_ACTIVITY),
    ).flatMap((row) => this.#activity(decodeCrmActivity(row), hidden) ?? []);
    const amounts = !hidden.has("amounts");
    const dates = !hidden.has("dates");
    return compact({
      ...this.#summary(customer, hidden),
      ...compact(text),
      owner: hidden.has("owner") ? null : customer.ownerAgentId,
      method: hidden.has("method") ? null : customer.method,
      currency: customer.currency,
      paid: amounts && customer.paidMinor > 0 ? formatCrmAmount(customer.paidMinor, customer.currency) : null,
      lastPaidAt: dates ? customer.lastPaidAt : null,
      plans: hidden.has("plans")
        ? null
        : customer.plans.map((plan) =>
            compact({
              id: plan.id,
              name: plan.name,
              amount: amounts ? formatCrmAmount(plan.amountMinor, customer.currency) : null,
              every: plan.every,
              startsOn: dates ? plan.startsOn : null,
              endsOn: dates ? plan.endsOn : null,
              source: plan.source,
            }),
          ),
      // An order by date would show the dates.
      openPayments: payments("p.paid_at IS NULL", dates ? "p.due_on, p.number" : "p.number", CUSTOMER_OPEN_PAYMENTS),
      recentPaid: payments(
        "p.paid_at IS NOT NULL",
        dates ? "p.paid_at DESC, p.number DESC" : "p.number DESC",
        CUSTOMER_PAID_PAYMENTS,
      ),
      activity,
      hiddenFields: hiddenList(hidden),
    });
  }

  payments(agentId: string, input: CrmAgentPaymentsInput): CrmAgentRecord {
    const hidden = this.#allow(agentId);
    // Without dates the list goes by invoice number, so neither its order nor its cursor shows a date.
    const dates = !hidden.has("dates");
    const where = ["p.paid_at IS NULL"];
    const values: SQLInputValue[] = [];
    if (input.state === "late") {
      if (!dates) throw crmRefused("error.crm.fieldPrivate");
      where.push("p.due_on < ?");
      values.push(this.#store.today());
    }
    if (input.customerId !== undefined) {
      this.#store.customerRecord(input.customerId);
      where.push("p.customer_id = ?");
      values.push(input.customerId);
    }
    if (input.cursor !== undefined) {
      const [dueOn, number] = decodeCrmNumberCursor(input.cursor);
      if (dates) {
        where.push("(p.due_on, p.number) > (?, ?)");
        values.push(dueOn, number);
      } else {
        where.push("p.number > ?");
        values.push(number);
      }
    }
    const limit = limitOf(input.limit);
    const order = dates ? "p.due_on, p.number" : "p.number";
    const rows = databaseRows(
      this.#store.db
        .prepare(`${CRM_PAYMENT_SELECT} WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ?`)
        .all(...values, limit + 1),
    ).map(decodeCrmPayment);
    const payments = rows.slice(0, limit);
    const last = payments.at(-1);
    // An empty list stays, so the agent reads that nothing matched.
    return {
      payments: payments.map((payment) => this.#payment(payment, hidden)),
      ...(rows.length > limit && last ? { next: encodeCrmCursor([dates ? last.dueOn : "", last.number]) } : {}),
      ...compact({ hiddenFields: hiddenList(hidden) }),
    };
  }

  propose(agentId: string, input: CrmAgentProposeInput): string {
    this.#allow(agentId);
    const { change, customerId } = this.#proposedChange(input.change);
    if (!isCrmProposedChange(change) || input.reason.length > CRM_LIMITS.reason)
      throw crmRefused("error.crm.invalidChange");
    if (this.#store.sourceOwns(change)) throw crmRefused("error.crm.sourceOwned");
    return this.#store.propose({
      agentId,
      customerId,
      // The client reads a thread id as an identifier; a longer one is left out.
      threadId: input.threadId !== null && input.threadId.length <= 128 ? input.threadId : null,
      reason: input.reason,
      change,
    });
  }

  #customerFields(fields: AgentCustomerFields): { [key: string]: unknown } {
    const result: { [key: string]: unknown } = {};
    for (const field of CRM_TEXT_FIELDS) if (fields[field] !== undefined) result[field] = fields[field];
    if (fields.status !== undefined) result.statusId = this.#resolveStatus(fields.status);
    if (fields.ownerAgentId !== undefined) result.ownerAgentId = fields.ownerAgentId;
    if (fields.method !== undefined) result.method = fields.method;
    if (fields.currency !== undefined) result.currency = fields.currency.toUpperCase();
    return result;
  }

  /** The contract change, with the customer it is for, after a check that each target exists. */
  #proposedChange(change: CrmAgentChange): { change: unknown; customerId: string | null } {
    const store = this.#store;
    const defined = (record: { [key: string]: unknown }) =>
      Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
    switch (change.kind) {
      case "customer-create": {
        const { tags, ...fields } = change.customer;
        return {
          customerId: null,
          change: {
            kind: change.kind,
            customer: defined({
              ...this.#customerFields(fields),
              name: fields.name,
              currency: fields.currency.toUpperCase(),
              tagIds: tags?.map((tag) => this.#resolveTag(tag)),
            }),
          },
        };
      }
      case "customer-update":
        store.customerRecord(change.customerId);
        return {
          customerId: change.customerId,
          change: { kind: change.kind, customerId: change.customerId, patch: this.#customerFields(change.patch) },
        };
      case "customer-tags":
        store.customerRecord(change.customerId);
        return {
          customerId: change.customerId,
          change: {
            kind: change.kind,
            customerId: change.customerId,
            tagIds: [...new Set(change.tags.map((tag) => this.#resolveTag(tag)))],
          },
        };
      case "plan-create": {
        const customer = store.customerRecord(change.plan.customerId);
        const { amount, ...plan } = change.plan;
        return {
          customerId: customer.id,
          change: { kind: change.kind, plan: { ...plan, amountMinor: parseCrmAmount(amount, customer.currency) } },
        };
      }
      case "plan-update": {
        const plan = store.plan(change.planId);
        const customer = store.customerRecord(plan.customerId);
        const { amount, ...patch } = change.patch;
        return {
          customerId: customer.id,
          change: {
            kind: change.kind,
            planId: plan.id,
            patch: defined({
              ...patch,
              amountMinor: amount === undefined ? undefined : parseCrmAmount(amount, customer.currency),
            }),
          },
        };
      }
      case "plan-end":
        return { customerId: store.plan(change.planId).customerId, change };
      case "payment-create": {
        const customer = store.customerRecord(change.payment.customerId);
        const { amount, ...payment } = change.payment;
        return {
          customerId: customer.id,
          change: {
            kind: change.kind,
            payment: defined({ ...payment, amountMinor: parseCrmAmount(amount, customer.currency) }),
          },
        };
      }
      case "payment-update": {
        const payment = store.payment(change.paymentId);
        const { amount, ...patch } = change.patch;
        return {
          customerId: payment.customerId,
          change: {
            kind: change.kind,
            paymentId: payment.id,
            patch: defined({
              ...patch,
              amountMinor: amount === undefined ? undefined : parseCrmAmount(amount, payment.currency),
            }),
          },
        };
      }
      case "payment-paid": {
        const paymentIds = [...new Set(change.paymentIds)];
        const customers = new Set(paymentIds.map((paymentId) => store.payment(paymentId).customerId));
        const [only] = customers;
        return {
          customerId: customers.size === 1 && only !== undefined ? only : null,
          change: { kind: change.kind, paymentIds, paidAt: change.paidAt },
        };
      }
      case "payment-split": {
        const payment = store.payment(change.paymentId);
        return {
          customerId: payment.customerId,
          change: {
            kind: change.kind,
            paymentId: payment.id,
            parts: change.parts.map((part) => ({
              amountMinor: parseCrmAmount(part.amount, payment.currency),
              dueOn: part.dueOn,
            })),
          },
        };
      }
    }
  }
}
