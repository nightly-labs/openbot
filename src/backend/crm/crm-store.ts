import { randomBytes } from "node:crypto";
import type { SQLInputValue } from "node:sqlite";
import {
  CRM_ACTOR_KINDS,
  CRM_BUILTIN_STATUS_IDS,
  CRM_EVERY,
  CRM_LIMITS,
  CRM_METHODS,
  CRM_PRIVATE_FIELDS,
  CRM_SOURCE_ERRORS,
  CRM_SOURCE_KINDS,
  CRM_SOURCE_STATES,
  CRM_TEXT_FIELDS,
  CRM_TONES,
  type CrmActivity,
  type CrmActivityPage,
  type CrmActivityPageInput,
  type CrmActor,
  type CrmApplyResult,
  type CrmChange,
  type CrmCustomer,
  type CrmCustomerInput,
  type CrmCustomerPage,
  type CrmCustomerPageInput,
  type CrmCustomerPatch,
  type CrmCustomerText,
  type CrmEvery,
  type CrmMethod,
  type CrmOverview,
  type CrmPayment,
  type CrmPaymentPage,
  type CrmPaymentPageInput,
  type CrmPlan,
  type CrmPlanInput,
  type CrmPrivateField,
  type CrmProposal,
  type CrmProposedChange,
  type CrmSource,
  type CrmSourceKind,
  type CrmStatus,
  type CrmTag,
  type CrmTextField,
  type CrmTone,
  isCrmChange,
  isCrmProposedChange,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord, isNumber, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { type SourceMessages, sourceText } from "@openbot/i18n/source";
import {
  checkedColumn,
  databaseRow,
  databaseRows,
  optionalStringColumn,
  requiredNumberColumn,
  requiredStringColumn,
} from "../database/database-rows";
import { withTransaction } from "../database/sqlite-transaction";
import type { OpenBotDatabase } from "../openbot-database";
import { CrmError } from "./crm-handle";

type CrmErrorKey = Exclude<Extract<keyof SourceMessages, `error.crm.${string}`>, "error.crm.amountDecimals">;

export function crmMissing(key: CrmErrorKey): CrmError {
  return new CrmError({ code: "missing", message: sourceText(key) });
}

export function crmRefused(key: CrmErrorKey): CrmError {
  return new CrmError({ code: "refused", message: sourceText(key) });
}

export type CrmDetails = Record<string, string | number | null>;

const CRM_TEXT_COLUMNS = {
  name: "name",
  contactName: "contact_name",
  contactEmail: "contact_email",
  phone: "phone",
  billingEmail: "billing_email",
  domain: "domain",
  taxId: "tax_id",
  address: "address",
  stripeCustomerId: "stripe_customer_id",
  notes: "notes",
} as const satisfies Record<CrmTextField, string>;

const PERIOD_MONTHS = { month: 1, quarter: 3, year: 12 } as const;

export interface CrmCustomerRecord extends CrmCustomerText {
  id: string;
  number: number;
  statusId: string;
  ownerAgentId: string | null;
  method: CrmMethod | null;
  currency: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  sourceId: string | null;
  sourceRef: string | null;
}

export interface CrmStatusRecord extends CrmStatus {
  position: number;
}

export interface CrmPaymentRecord extends CrmPayment {
  customerNumber: number;
  customerName: string;
}

export function newCrmId(): string {
  return randomBytes(16).toString("hex");
}

export function normalizeCrmSearch(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

function searchText(text: CrmCustomerText): string {
  return JSON.stringify(Object.fromEntries(CRM_TEXT_FIELDS.map((field) => [field, normalizeCrmSearch(text[field])])));
}

export function localCrmDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addCrmMonths(date: string, months: number): string | null {
  const total = Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1 + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  if (year > 9999) return null;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(Number(date.slice(8, 10)), last);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function encodeCrmCursor(key: readonly [string, string | number]): string {
  return Buffer.from(JSON.stringify(key)).toString("base64url");
}

function cursorKey(cursor: string): [string, unknown] {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw crmRefused("error.crm.badCursor");
  }
  if (!Array.isArray(value) || value.length !== 2 || !isString(value[0])) throw crmRefused("error.crm.badCursor");
  return [value[0], value[1]];
}

export function decodeCrmNumberCursor(cursor: string): [string, number] {
  const [key, number] = cursorKey(cursor);
  if (!isNumber(number) || !Number.isSafeInteger(number)) throw crmRefused("error.crm.badCursor");
  return [key, number];
}

function decodeCrmTextCursor(cursor: string): [string, string] {
  const [key, text] = cursorKey(cursor);
  if (!isString(text)) throw crmRefused("error.crm.badCursor");
  return [key, text];
}

function nullableMethod(row: DynamicRecord): CrmMethod | null {
  return row.method === null ? null : checkedColumn(row, "method", CRM_METHODS);
}

function customerText(row: DynamicRecord): CrmCustomerText {
  return {
    name: requiredStringColumn(row, "name"),
    contactName: requiredStringColumn(row, "contact_name"),
    contactEmail: requiredStringColumn(row, "contact_email"),
    phone: requiredStringColumn(row, "phone"),
    billingEmail: requiredStringColumn(row, "billing_email"),
    domain: requiredStringColumn(row, "domain"),
    taxId: requiredStringColumn(row, "tax_id"),
    address: requiredStringColumn(row, "address"),
    stripeCustomerId: requiredStringColumn(row, "stripe_customer_id"),
    notes: requiredStringColumn(row, "notes"),
  };
}

function decodeCrmCustomerRecord(row: DynamicRecord): CrmCustomerRecord {
  return {
    ...customerText(row),
    id: requiredStringColumn(row, "customer_id"),
    number: requiredNumberColumn(row, "number"),
    statusId: requiredStringColumn(row, "status_id"),
    ownerAgentId: optionalStringColumn(row, "owner_agent_id"),
    method: nullableMethod(row),
    currency: requiredStringColumn(row, "currency"),
    createdAt: requiredStringColumn(row, "created_at"),
    updatedAt: requiredStringColumn(row, "updated_at"),
    revision: requiredNumberColumn(row, "revision"),
    sourceId: optionalStringColumn(row, "source_id"),
    sourceRef: optionalStringColumn(row, "source_ref"),
  };
}

function sourceKind(row: DynamicRecord): CrmSourceKind | null {
  return row.source_kind === null || row.source_kind === undefined
    ? null
    : checkedColumn(row, "source_kind", CRM_SOURCE_KINDS);
}

function crmSourceKindColumn(alias: string): string {
  return `(SELECT s.kind FROM crm_sources AS s WHERE s.source_id = ${alias}.source_id)`;
}

function decodePlan(row: DynamicRecord): CrmPlan {
  return {
    id: requiredStringColumn(row, "plan_id"),
    customerId: requiredStringColumn(row, "customer_id"),
    name: requiredStringColumn(row, "name"),
    amountMinor: requiredNumberColumn(row, "amount_minor"),
    every: checkedColumn(row, "every", CRM_EVERY),
    startsOn: requiredStringColumn(row, "starts_on"),
    endsOn: optionalStringColumn(row, "ends_on"),
    source: sourceKind(row),
  };
}

export function decodeCrmPayment(row: DynamicRecord): CrmPaymentRecord {
  return {
    id: requiredStringColumn(row, "payment_id"),
    number: requiredNumberColumn(row, "number"),
    customerId: requiredStringColumn(row, "customer_id"),
    planId: optionalStringColumn(row, "plan_id"),
    label: requiredStringColumn(row, "label"),
    amountMinor: requiredNumberColumn(row, "amount_minor"),
    currency: requiredStringColumn(row, "currency"),
    dueOn: requiredStringColumn(row, "due_on"),
    paidAt: optionalStringColumn(row, "paid_at"),
    method: nullableMethod(row),
    source: sourceKind(row),
    customerNumber: requiredNumberColumn(row, "customer_number"),
    customerName: requiredStringColumn(row, "customer_name"),
  };
}

function publicPayment(payment: CrmPaymentRecord): CrmPayment {
  return {
    id: payment.id,
    number: payment.number,
    customerId: payment.customerId,
    planId: payment.planId,
    label: payment.label,
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    dueOn: payment.dueOn,
    paidAt: payment.paidAt,
    method: payment.method,
    source: payment.source,
  };
}

function decodeDetails(text: string): CrmDetails {
  const value = JSON.parse(text);
  if (!isDynamicRecord(value)) return {};
  const details: CrmDetails = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === null || isString(item) || isNumber(item)) details[key] = item;
  }
  return details;
}

export function decodeCrmActivity(row: DynamicRecord): CrmActivity {
  return {
    id: requiredStringColumn(row, "activity_id"),
    customerId: requiredStringColumn(row, "customer_id"),
    actor: {
      kind: checkedColumn(row, "actor_kind", CRM_ACTOR_KINDS),
      id: optionalStringColumn(row, "actor_id"),
      name: optionalStringColumn(row, "actor_name"),
    },
    kind: requiredStringColumn(row, "kind"),
    details: decodeDetails(requiredStringColumn(row, "details_json")),
    proposedBy: optionalStringColumn(row, "proposed_by"),
    createdAt: requiredStringColumn(row, "created_at"),
  };
}

function skipCount(skipped: CrmDetails, key: string): number {
  const value = skipped[key];
  return isNumber(value) && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function decodeSource(row: DynamicRecord): CrmSource {
  const skipped = decodeDetails(requiredStringColumn(row, "skipped_json"));
  return {
    id: requiredStringColumn(row, "source_id"),
    kind: checkedColumn(row, "kind", CRM_SOURCE_KINDS),
    testMode: requiredNumberColumn(row, "test_mode") === 1,
    accountLabel: requiredStringColumn(row, "account_label"),
    keyHint: requiredStringColumn(row, "key_hint"),
    state: checkedColumn(row, "state", CRM_SOURCE_STATES),
    errorCode: row.error_code === null ? null : checkedColumn(row, "error_code", CRM_SOURCE_ERRORS),
    syncedAt: optionalStringColumn(row, "synced_at"),
    connectedAt: requiredStringColumn(row, "connected_at"),
    skipped: {
      currency: skipCount(skipped, "currency"),
      interval: skipCount(skipped, "interval"),
      limit: skipCount(skipped, "limit"),
    },
  };
}

function editable(row: { source: CrmSourceKind | null }): void {
  if (row.source !== null) throw crmRefused("error.crm.sourceOwned");
}

function decodeStatus(row: DynamicRecord): CrmStatusRecord {
  return {
    id: requiredStringColumn(row, "status_id"),
    label: optionalStringColumn(row, "label"),
    tone: checkedColumn(row, "tone", CRM_TONES),
    position: requiredNumberColumn(row, "position"),
  };
}

function decodeTag(row: DynamicRecord): CrmTag {
  return { id: requiredStringColumn(row, "tag_id"), label: requiredStringColumn(row, "label") };
}

function jsonArray(row: DynamicRecord, key: string): unknown[] {
  const value = JSON.parse(requiredStringColumn(row, key));
  if (!Array.isArray(value)) throw new Error(`Invalid SQLite column ${key}.`);
  return value;
}

export const CRM_CUSTOMER_COLUMNS = `c.*,
  (SELECT json_group_array(tag_id) FROM (SELECT ct.tag_id FROM crm_customer_tags AS ct
    JOIN crm_tags AS t ON t.tag_id = ct.tag_id WHERE ct.customer_id = c.customer_id ORDER BY t.label, t.tag_id)) AS tag_ids,
  (SELECT json_group_array(json_object('plan_id', plan_id, 'customer_id', customer_id, 'name', name,
    'amount_minor', amount_minor, 'every', every, 'starts_on', starts_on, 'ends_on', ends_on, 'source_kind', source_kind))
    FROM (SELECT p.*, ${crmSourceKindColumn("p")} AS source_kind FROM crm_plans AS p WHERE p.customer_id = c.customer_id
      ORDER BY p.starts_on, p.created_at, p.plan_id)) AS plans,
  ${crmSourceKindColumn("c")} AS source_kind,
  (SELECT coalesce(sum(amount_minor), 0) FROM crm_payments
    WHERE customer_id = c.customer_id AND paid_at IS NOT NULL) AS paid_minor,
  (SELECT coalesce(sum(amount_minor), 0) FROM crm_payments
    WHERE customer_id = c.customer_id AND paid_at IS NULL) AS open_minor,
  (SELECT coalesce(sum(amount_minor), 0) FROM crm_payments
    WHERE customer_id = c.customer_id AND paid_at IS NULL AND due_on < ?1) AS late_minor,
  (SELECT min(due_on) FROM crm_payments WHERE customer_id = c.customer_id AND paid_at IS NULL) AS next_due_on,
  (SELECT max(paid_at) FROM crm_payments WHERE customer_id = c.customer_id AND paid_at IS NOT NULL) AS last_paid_at`;

export function decodeCrmCustomer(row: DynamicRecord): CrmCustomer {
  const tagIds = jsonArray(row, "tag_ids").filter(isString);
  const plans = jsonArray(row, "plans").map((plan) => {
    if (!isDynamicRecord(plan)) throw new Error("Invalid SQLite column plans.");
    return decodePlan(plan);
  });
  return {
    ...decodeCrmCustomerRecord(row),
    tagIds,
    plans,
    paidMinor: requiredNumberColumn(row, "paid_minor"),
    openMinor: requiredNumberColumn(row, "open_minor"),
    lateMinor: requiredNumberColumn(row, "late_minor"),
    nextDueOn: optionalStringColumn(row, "next_due_on"),
    lastPaidAt: optionalStringColumn(row, "last_paid_at"),
    source: sourceKind(row),
  };
}

export const CRM_PAYMENT_SELECT = `SELECT p.*, c.currency, c.number AS customer_number, c.name AS customer_name,
  ${crmSourceKindColumn("p")} AS source_kind FROM crm_payments AS p JOIN crm_customers AS c ON c.customer_id = p.customer_id`;

const ACTIVITY_PAGE_SIZE = 100;

export interface CrmStoreOptions {
  database: OpenBotDatabase;
  now: () => Date;
}

export class CrmStore {
  readonly #database: OpenBotDatabase;
  readonly #now: () => Date;

  constructor(options: CrmStoreOptions) {
    this.#database = options.database;
    this.#now = options.now;
  }

  get db() {
    return this.#database.connection;
  }

  today(): string {
    return localCrmDate(this.#now());
  }

  timestamp(): string {
    return this.#now().toISOString();
  }

  transaction<T>(work: () => T): T {
    return withTransaction(this.db, work);
  }

  customerRecord(customerId: string): CrmCustomerRecord {
    const row = databaseRow(this.db.prepare("SELECT * FROM crm_customers WHERE customer_id = ?").get(customerId));
    if (!row) throw crmMissing("error.crm.customerMissing");
    return decodeCrmCustomerRecord(row);
  }

  customer(customerId: string): CrmCustomer {
    const row = databaseRow(
      this.db
        .prepare(`SELECT ${CRM_CUSTOMER_COLUMNS} FROM crm_customers AS c WHERE c.customer_id = ?2`)
        .get(this.today(), customerId),
    );
    if (!row) throw crmMissing("error.crm.customerMissing");
    return decodeCrmCustomer(row);
  }

  plan(planId: string): CrmPlan {
    const row = databaseRow(
      this.db
        .prepare(`SELECT p.*, ${crmSourceKindColumn("p")} AS source_kind FROM crm_plans AS p WHERE p.plan_id = ?`)
        .get(planId),
    );
    if (!row) throw crmMissing("error.crm.planMissing");
    return decodePlan(row);
  }

  payment(paymentId: string): CrmPaymentRecord {
    const row = databaseRow(this.db.prepare(`${CRM_PAYMENT_SELECT} WHERE p.payment_id = ?`).get(paymentId));
    if (!row) throw crmMissing("error.crm.paymentMissing");
    return decodeCrmPayment(row);
  }

  status(statusId: string): CrmStatusRecord {
    const row = databaseRow(this.db.prepare("SELECT * FROM crm_statuses WHERE status_id = ?").get(statusId));
    if (!row) throw crmMissing("error.crm.statusMissing");
    return decodeStatus(row);
  }

  tag(tagId: string): CrmTag {
    const row = databaseRow(this.db.prepare("SELECT * FROM crm_tags WHERE tag_id = ?").get(tagId));
    if (!row) throw crmMissing("error.crm.tagMissing");
    return decodeTag(row);
  }

  statuses(): CrmStatusRecord[] {
    return databaseRows(this.db.prepare("SELECT * FROM crm_statuses ORDER BY position, status_id").all()).map(
      decodeStatus,
    );
  }

  tags(): CrmTag[] {
    return databaseRows(this.db.prepare("SELECT * FROM crm_tags ORDER BY label, tag_id").all()).map(decodeTag);
  }

  privateFields(): CrmPrivateField[] {
    return databaseRows(this.db.prepare("SELECT field FROM crm_private_fields").all())
      .map((row) => checkedColumn(row, "field", CRM_PRIVATE_FIELDS))
      .sort((left, right) => CRM_PRIVATE_FIELDS.indexOf(left) - CRM_PRIVATE_FIELDS.indexOf(right));
  }

  sources(): CrmSource[] {
    return databaseRows(this.db.prepare("SELECT * FROM crm_sources ORDER BY kind").all()).map(decodeSource);
  }

  source(sourceId: string): CrmSource {
    const row = databaseRow(this.db.prepare("SELECT * FROM crm_sources WHERE source_id = ?").get(sourceId));
    if (!row) throw crmMissing("error.crm.sourceMissing");
    return decodeSource(row);
  }

  sourceOwns(change: CrmProposedChange): boolean {
    switch (change.kind) {
      case "plan-update":
      case "plan-end":
        return this.plan(change.planId).source !== null;
      case "payment-update":
      case "payment-split":
        return this.payment(change.paymentId).source !== null;
      case "payment-paid":
        return change.paymentIds.some((paymentId) => this.payment(paymentId).source !== null);
      case "customer-update": {
        const customer = this.customerRecord(change.customerId);
        return linkedIdChange(customer, change.patch);
      }
      default:
        return false;
    }
  }

  hasAgentAccess(agentId: string): boolean {
    return (
      databaseRow(this.db.prepare("SELECT 1 AS found FROM crm_agent_access WHERE agent_id = ?").get(agentId)) !== null
    );
  }

  tagIdsOf(customerId: string): string[] {
    return databaseRows(
      this.db.prepare("SELECT tag_id FROM crm_customer_tags WHERE customer_id = ?").all(customerId),
    ).map((row) => requiredStringColumn(row, "tag_id"));
  }

  overview(): CrmOverview {
    const proposals = databaseRows(
      this.db
        .prepare(
          `SELECT * FROM crm_proposals WHERE state = 'pending'
           ORDER BY created_at DESC, proposal_id DESC LIMIT ${CRM_LIMITS.pendingProposals}`,
        )
        .all(),
    ).flatMap((row): CrmProposal[] => {
      const change = JSON.parse(requiredStringColumn(row, "change_json"));
      if (!isCrmProposedChange(change)) return [];
      return [
        {
          id: requiredStringColumn(row, "proposal_id"),
          agentId: requiredStringColumn(row, "agent_id"),
          customerId: optionalStringColumn(row, "customer_id"),
          threadId: optionalStringColumn(row, "thread_id"),
          reason: requiredStringColumn(row, "reason"),
          change,
          createdAt: requiredStringColumn(row, "created_at"),
        },
      ];
    });
    return {
      statuses: this.statuses().map(({ id, label, tone }) => ({ id, label, tone })),
      tags: this.tags(),
      privateFields: this.privateFields(),
      agentIds: databaseRows(
        this.db.prepare("SELECT agent_id FROM crm_agent_access ORDER BY granted_at, agent_id").all(),
      ).map((row) => requiredStringColumn(row, "agent_id")),
      proposals,
      sources: this.sources(),
    };
  }

  customers(input: CrmCustomerPageInput): CrmCustomerPage {
    const rows = databaseRows(
      this.db
        .prepare(
          `SELECT ${CRM_CUSTOMER_COLUMNS} FROM crm_customers AS c WHERE c.number > ?2 ORDER BY c.number LIMIT ?3`,
        )
        .all(this.today(), input.after ?? 0, CRM_LIMITS.page + 1),
    );
    const customers = rows.slice(0, CRM_LIMITS.page).map(decodeCrmCustomer);
    return { customers, next: rows.length > CRM_LIMITS.page ? (customers.at(-1)?.number ?? null) : null };
  }

  payments(input: CrmPaymentPageInput): CrmPaymentPage {
    const open = input.state === "open";
    const where = [open ? "p.paid_at IS NULL" : "p.paid_at IS NOT NULL"];
    const values: SQLInputValue[] = [];
    if (input.customerId !== undefined) {
      where.push("p.customer_id = ?");
      values.push(input.customerId);
    }
    if (input.after !== undefined) {
      const [key, number] = decodeCrmNumberCursor(input.after);
      where.push(open ? "(p.due_on, p.number) > (?, ?)" : "(p.paid_at, p.number) < (?, ?)");
      values.push(key, number);
    }
    const order = open ? "p.due_on, p.number" : "p.paid_at DESC, p.number DESC";
    const rows = databaseRows(
      this.db
        .prepare(`${CRM_PAYMENT_SELECT} WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ?`)
        .all(...values, CRM_LIMITS.page + 1),
    ).map(decodeCrmPayment);
    const payments = rows.slice(0, CRM_LIMITS.page);
    const last = payments.at(-1);
    return {
      payments: payments.map(publicPayment),
      next:
        rows.length > CRM_LIMITS.page && last
          ? encodeCrmCursor([open ? last.dueOn : (last.paidAt ?? ""), last.number])
          : null,
    };
  }

  activity(input: CrmActivityPageInput): CrmActivityPage {
    this.customerRecord(input.customerId);
    const values: SQLInputValue[] = [input.customerId];
    let after = "";
    if (input.after !== undefined) {
      const [createdAt, activityId] = decodeCrmTextCursor(input.after);
      after = "AND (created_at, activity_id) < (?, ?)";
      values.push(createdAt, activityId);
    }
    const rows = databaseRows(
      this.db
        .prepare(
          `SELECT * FROM crm_activity WHERE customer_id = ? ${after}
           ORDER BY created_at DESC, activity_id DESC LIMIT ?`,
        )
        .all(...values, ACTIVITY_PAGE_SIZE + 1),
    ).map(decodeCrmActivity);
    const activity = rows.slice(0, ACTIVITY_PAGE_SIZE);
    const last = activity.at(-1);
    return {
      activity,
      next: rows.length > ACTIVITY_PAGE_SIZE && last ? encodeCrmCursor([last.createdAt, last.id]) : null,
    };
  }

  apply(change: CrmChange, actor: CrmActor): CrmApplyResult {
    if (!isCrmChange(change) || actor.kind !== "person") throw crmRefused("error.crm.invalidChange");
    const outcome = this.transaction(() =>
      change.kind === "proposal-decide"
        ? this.#decide(change.proposalId, change.approve, actor)
        : { result: new CrmWrite(this, actor, null).apply(change), error: null },
    );
    if (outcome.error) throw outcome.error;
    return outcome.result;
  }

  #decide(proposalId: string, approve: boolean, actor: CrmActor): { result: CrmApplyResult; error: CrmError | null } {
    const row = databaseRow(
      this.db.prepare("SELECT * FROM crm_proposals WHERE proposal_id = ? AND state = 'pending'").get(proposalId),
    );
    if (!row) throw crmMissing("error.crm.proposalMissing");
    const agentId = requiredStringColumn(row, "agent_id");
    const customerId = optionalStringColumn(row, "customer_id");
    const change = JSON.parse(requiredStringColumn(row, "change_json"));
    const decide = (state: "approved" | "rejected") =>
      this.db
        .prepare(
          `UPDATE crm_proposals SET state = ?, decided_at = ?, decided_by_id = ?, decided_by_name = ?
           WHERE proposal_id = ?`,
        )
        .run(state, this.timestamp(), actor.id, actor.name, proposalId);
    const reject = () => {
      decide("rejected");
      if (customerId === null) return;
      const kind = isDynamicRecord(change) && isString(change.kind) ? change.kind : null;
      new CrmWrite(this, actor, agentId).log(customerId, "proposal-rejected", {
        change: kind,
        reason: requiredStringColumn(row, "reason"),
      });
    };
    if (!approve || !isCrmProposedChange(change)) {
      reject();
      return {
        result: { ok: true, id: null },
        error: approve ? crmMissing("error.crm.proposalMissing") : null,
      };
    }
    if (this.#sourceOwnsOrGone(change)) {
      reject();
      return { result: { ok: true, id: null }, error: crmRefused("error.crm.sourceOwned") };
    }
    let result: CrmApplyResult;
    try {
      result = withTransaction(this.db, () => new CrmWrite(this, actor, agentId).apply(change));
    } catch (error) {
      if (!(error instanceof CrmError) || !this.db.isTransaction) throw error;
      if (error.code === "refused") throw error;
      reject();
      return { result: { ok: true, id: null }, error };
    }
    decide("approved");
    return { result, error: null };
  }

  #sourceOwnsOrGone(change: CrmProposedChange): boolean {
    try {
      return this.sourceOwns(change);
    } catch (error) {
      if (error instanceof CrmError) return false;
      throw error;
    }
  }

  propose(input: {
    agentId: string;
    customerId: string | null;
    threadId: string | null;
    reason: string;
    change: CrmProposedChange;
  }): string {
    return this.transaction(() => {
      const count = (where: string, ...values: SQLInputValue[]) =>
        requiredNumberColumn(
          databaseRow(
            this.db
              .prepare(`SELECT count(*) AS count FROM crm_proposals WHERE state = 'pending' ${where}`)
              .get(...values),
          ) ?? {},
          "count",
        );
      if (
        count("AND agent_id = ?", input.agentId) >= AGENT_PENDING_PROPOSALS ||
        count("") >= CRM_LIMITS.pendingProposals
      )
        throw crmRefused("error.crm.tooManyProposals");
      const proposalId = newCrmId();
      this.db
        .prepare(
          `INSERT INTO crm_proposals (proposal_id, agent_id, customer_id, thread_id, reason, change_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          proposalId,
          input.agentId,
          input.customerId,
          input.threadId,
          input.reason,
          JSON.stringify(input.change),
          this.timestamp(),
        );
      return proposalId;
    });
  }
}

function linkedIdChange(customer: CrmCustomerRecord, patch: CrmCustomerPatch): boolean {
  return (
    customer.sourceId !== null &&
    patch.stripeCustomerId !== undefined &&
    patch.stripeCustomerId !== customer.stripeCustomerId
  );
}

const AGENT_PENDING_PROPOSALS = 50;

export class CrmWrite {
  readonly #store: CrmStore;
  readonly #actor: CrmActor;
  readonly #proposedBy: string | null;
  readonly #at: string;
  readonly #touched = new Set<string>();

  constructor(store: CrmStore, actor: CrmActor, proposedBy: string | null) {
    this.#store = store;
    this.#actor = actor;
    this.#proposedBy = proposedBy;
    this.#at = store.timestamp();
  }

  get #db() {
    return this.#store.db;
  }

  apply(change: CrmChange | CrmProposedChange): CrmApplyResult {
    if (change.kind === "customer-update" && "baseRevision" in change) {
      if (this.#store.customerRecord(change.customerId).revision !== change.baseRevision)
        return { ok: false, conflict: "revision" };
    }
    const id = this.#apply(change);
    this.finish();
    return { ok: true, id };
  }

  finish(): void {
    for (const customerId of this.#touched)
      this.#db
        .prepare("UPDATE crm_customers SET revision = revision + 1, updated_at = ? WHERE customer_id = ?")
        .run(this.#at, customerId);
    this.#touched.clear();
  }

  get at(): string {
    return this.#at;
  }

  log(customerId: string, kind: string, details: CrmDetails): void {
    this.#db
      .prepare(
        `INSERT INTO crm_activity (activity_id, customer_id, actor_kind, actor_id, actor_name, kind, details_json,
           proposed_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        newCrmId(),
        customerId,
        this.#actor.kind,
        this.#actor.id,
        this.#actor.name,
        kind,
        JSON.stringify(details),
        this.#proposedBy,
        this.#at,
      );
  }

  record(customerId: string, kind: string, details: CrmDetails): void {
    this.log(customerId, kind, details);
    this.#touched.add(customerId);
  }

  nextNumber(name: "customer" | "payment"): number {
    const row = databaseRow(
      this.#db
        .prepare(
          `INSERT INTO crm_counters (name, value) VALUES (?, 1)
           ON CONFLICT(name) DO UPDATE SET value = value + 1 RETURNING value`,
        )
        .get(name),
    );
    return requiredNumberColumn(row ?? {}, "value");
  }

  #count(sql: string, ...values: SQLInputValue[]): number {
    return requiredNumberColumn(databaseRow(this.#db.prepare(sql).get(...values)) ?? {}, "count");
  }

  #apply(change: CrmChange | CrmProposedChange): string | null {
    switch (change.kind) {
      case "customer-create":
        return this.createCustomer(change.customer);
      case "customer-update":
        this.#updateCustomer(this.#store.customerRecord(change.customerId), change.patch);
        return null;
      case "customer-tags":
        this.#setTags(change.customerId, change.tagIds);
        return null;
      case "customer-delete": {
        const customer = this.#store.customerRecord(change.customerId);
        if (customer.sourceRef !== null)
          this.#db.prepare("INSERT OR IGNORE INTO crm_source_ignored (source_ref) VALUES (?)").run(customer.sourceRef);
        this.#db.prepare("DELETE FROM crm_customers WHERE customer_id = ?").run(customer.id);
        return null;
      }
      case "plan-create":
        return this.#createPlan(change.plan);
      case "plan-update":
        this.#updatePlan(change.planId, change.patch);
        return null;
      case "plan-end":
        this.#endPlan(change.planId, change.endsOn);
        return null;
      case "plan-delete":
        this.#deletePlan(change.planId);
        return null;
      case "payment-create":
        return this.#createPayment(change.payment);
      case "payment-update":
        this.#updatePayment(change.paymentId, change.patch);
        return null;
      case "payment-paid":
        for (const paymentId of change.paymentIds) this.#markPaid(paymentId, change.paidAt);
        return null;
      case "payment-split":
        this.#split(change.paymentId, change.parts);
        return null;
      case "payment-delete": {
        const payment = this.#store.payment(change.paymentId);
        editable(payment);
        this.#db.prepare("DELETE FROM crm_payments WHERE payment_id = ?").run(payment.id);
        this.record(payment.customerId, "payment-deleted", {
          number: payment.number,
          label: payment.label,
          amountMinor: payment.amountMinor,
          currency: payment.currency,
          paidAt: payment.paidAt,
        });
        return null;
      }
      case "tag-create":
        return this.#createTag(change.label);
      case "tag-delete":
        this.#deleteTag(change.tagId);
        return null;
      case "status-create":
        return this.#createStatus(change.label);
      case "status-rename":
        this.#renameStatus(change.statusId, change.label);
        return null;
      case "status-delete":
        this.#deleteStatus(change.statusId, change.replaceWith);
        return null;
      case "private-fields": {
        this.#db.exec("DELETE FROM crm_private_fields");
        const insert = this.#db.prepare("INSERT INTO crm_private_fields (field) VALUES (?)");
        for (const field of change.fields) insert.run(field);
        return null;
      }
      case "agent-access": {
        const kept = JSON.stringify(change.agentIds);
        this.#db
          .prepare("DELETE FROM crm_agent_access WHERE agent_id NOT IN (SELECT value FROM json_each(?))")
          .run(kept);
        const insert = this.#db.prepare("INSERT OR IGNORE INTO crm_agent_access (agent_id, granted_at) VALUES (?, ?)");
        for (const agentId of change.agentIds) insert.run(agentId, this.#at);
        return null;
      }
      case "proposal-decide":
        throw crmRefused("error.crm.invalidChange");
    }
  }

  createCustomer(input: CrmCustomerInput): string {
    const statusId = input.statusId ?? "lead";
    this.#store.status(statusId);
    const tagIds = input.tagIds ?? [];
    for (const tagId of tagIds) this.#store.tag(tagId);
    const text: CrmCustomerText = {
      name: input.name,
      contactName: input.contactName ?? "",
      contactEmail: input.contactEmail ?? "",
      phone: input.phone ?? "",
      billingEmail: input.billingEmail ?? "",
      domain: input.domain ?? "",
      taxId: input.taxId ?? "",
      address: input.address ?? "",
      stripeCustomerId: input.stripeCustomerId ?? "",
      notes: input.notes ?? "",
    };
    const customerId = newCrmId();
    const number = this.nextNumber("customer");
    this.#db
      .prepare(
        `INSERT INTO crm_customers (customer_id, number, name, status_id, owner_agent_id, method, currency,
           contact_name, contact_email, phone, billing_email, domain, tax_id, address, stripe_customer_id, notes,
           search_text, created_at, updated_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      )
      .run(
        customerId,
        number,
        text.name,
        statusId,
        input.ownerAgentId ?? null,
        input.method ?? null,
        input.currency,
        text.contactName,
        text.contactEmail,
        text.phone,
        text.billingEmail,
        text.domain,
        text.taxId,
        text.address,
        text.stripeCustomerId,
        text.notes,
        searchText(text),
        this.#at,
        this.#at,
      );
    const link = this.#db.prepare("INSERT INTO crm_customer_tags (customer_id, tag_id) VALUES (?, ?)");
    for (const tagId of tagIds) link.run(customerId, tagId);
    this.log(customerId, "customer-created", { number });
    return customerId;
  }

  #updateCustomer(customer: CrmCustomerRecord, patch: CrmCustomerPatch): void {
    if (linkedIdChange(customer, patch)) throw crmRefused("error.crm.sourceOwned");
    const sets: string[] = [];
    const values: SQLInputValue[] = [];
    const set = (column: string, value: SQLInputValue) => {
      sets.push(`${column} = ?`);
      values.push(value);
    };
    const text: CrmCustomerText = { ...customer };
    let textChanged = false;
    for (const field of CRM_TEXT_FIELDS) {
      const value = patch[field];
      if (value === undefined || value === customer[field]) continue;
      set(CRM_TEXT_COLUMNS[field], value);
      text[field] = value;
      textChanged = true;
      this.record(customer.id, "field-changed", { field, from: customer[field], to: value });
    }
    if (textChanged) set("search_text", searchText(text));
    if (patch.statusId !== undefined && patch.statusId !== customer.statusId) {
      const from = this.#store.status(customer.statusId);
      const to = this.#store.status(patch.statusId);
      set("status_id", to.id);
      this.#statusChanged(customer.id, from, to);
    }
    if (patch.ownerAgentId !== undefined && patch.ownerAgentId !== customer.ownerAgentId) {
      set("owner_agent_id", patch.ownerAgentId);
      this.record(customer.id, "field-changed", {
        field: "ownerAgentId",
        from: customer.ownerAgentId,
        to: patch.ownerAgentId,
      });
    }
    if (patch.method !== undefined && patch.method !== customer.method) {
      set("method", patch.method);
      this.record(customer.id, "field-changed", { field: "method", from: customer.method, to: patch.method });
    }
    if (patch.currency !== undefined && patch.currency !== customer.currency) {
      const used =
        this.#count("SELECT count(*) AS count FROM crm_plans WHERE customer_id = ?", customer.id) +
        this.#count("SELECT count(*) AS count FROM crm_payments WHERE customer_id = ?", customer.id);
      if (used > 0) throw crmRefused("error.crm.currencyInUse");
      set("currency", patch.currency);
      this.record(customer.id, "field-changed", { field: "currency", from: customer.currency, to: patch.currency });
    }
    if (sets.length === 0) return;
    this.#db.prepare(`UPDATE crm_customers SET ${sets.join(", ")} WHERE customer_id = ?`).run(...values, customer.id);
  }

  #statusChanged(customerId: string, from: CrmStatus, to: CrmStatus): void {
    this.record(customerId, "status-changed", {
      from: from.id,
      to: to.id,
      fromLabel: from.label,
      toLabel: to.label,
    });
  }

  #labels(tagIds: readonly string[]): string | null {
    return tagIds.length === 0 ? null : tagIds.map((tagId) => this.#store.tag(tagId).label).join(", ");
  }

  #setTags(customerId: string, tagIds: readonly string[]): void {
    this.#store.customerRecord(customerId);
    for (const tagId of tagIds) this.#store.tag(tagId);
    const current = new Set(this.#store.tagIdsOf(customerId));
    const wanted = new Set(tagIds);
    const added = tagIds.filter((tagId) => !current.has(tagId));
    const removed = [...current].filter((tagId) => !wanted.has(tagId));
    if (added.length === 0 && removed.length === 0) return;
    const details = { added: this.#labels(added), removed: this.#labels(removed) };
    const unlink = this.#db.prepare("DELETE FROM crm_customer_tags WHERE customer_id = ? AND tag_id = ?");
    for (const tagId of removed) unlink.run(customerId, tagId);
    const link = this.#db.prepare("INSERT INTO crm_customer_tags (customer_id, tag_id) VALUES (?, ?)");
    for (const tagId of added) link.run(customerId, tagId);
    this.record(customerId, "tags-changed", details);
  }

  insertPayment(input: {
    customerId: string;
    planId: string | null;
    label: string;
    amountMinor: number;
    dueOn: string;
    paidAt: string | null;
    method: CrmMethod | null;
    source?: { id: string; ref: string };
  }): { id: string; number: number } {
    const id = newCrmId();
    const number = this.nextNumber("payment");
    this.#db
      .prepare(
        `INSERT INTO crm_payments (payment_id, number, customer_id, plan_id, label, amount_minor, due_on, paid_at,
           method, source_id, source_ref, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        number,
        input.customerId,
        input.planId,
        input.label,
        input.amountMinor,
        input.dueOn,
        input.paidAt,
        input.method,
        input.source?.id ?? null,
        input.source?.ref ?? null,
        this.#at,
        this.#at,
      );
    return { id, number };
  }

  #createPlan(input: CrmPlanInput): string {
    const customer = this.#store.customerRecord(input.customerId);
    if (
      this.#count("SELECT count(*) AS count FROM crm_plans WHERE customer_id = ?", customer.id) >=
      CRM_LIMITS.customerPlans
    )
      throw crmRefused("error.crm.tooManyPlans");
    const planId = newCrmId();
    this.#db
      .prepare(
        `INSERT INTO crm_plans (plan_id, customer_id, name, amount_minor, every, starts_on, ends_on, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      )
      .run(planId, customer.id, input.name, input.amountMinor, input.every, input.startsOn, this.#at, this.#at);
    const payment = this.insertPayment({
      customerId: customer.id,
      planId,
      label: input.name,
      amountMinor: input.amountMinor,
      dueOn: input.startsOn,
      paidAt: null,
      method: customer.method,
    });
    this.record(customer.id, "plan-created", {
      plan: input.name,
      amountMinor: input.amountMinor,
      currency: customer.currency,
      every: input.every,
      startsOn: input.startsOn,
      payment: payment.number,
    });
    return planId;
  }

  #updatePlan(planId: string, patch: { name?: string; amountMinor?: number; every?: CrmEvery }): void {
    const plan = this.#store.plan(planId);
    editable(plan);
    const customer = this.#store.customerRecord(plan.customerId);
    const changed = (field: string, from: string | number, to: string | number) =>
      this.record(plan.customerId, "plan-changed", { plan: plan.name, field, from, to, currency: customer.currency });
    if (patch.name !== undefined && patch.name !== plan.name) {
      this.#db
        .prepare("UPDATE crm_plans SET name = ?, updated_at = ? WHERE plan_id = ?")
        .run(patch.name, this.#at, planId);
      changed("name", plan.name, patch.name);
    }
    if (patch.amountMinor !== undefined && patch.amountMinor !== plan.amountMinor) {
      this.#db
        .prepare("UPDATE crm_plans SET amount_minor = ?, updated_at = ? WHERE plan_id = ?")
        .run(patch.amountMinor, this.#at, planId);
      this.#db
        .prepare(
          `UPDATE crm_payments SET amount_minor = ?, updated_at = ?
           WHERE plan_id = ? AND paid_at IS NULL AND amount_minor = ?`,
        )
        .run(patch.amountMinor, this.#at, planId, plan.amountMinor);
      changed("amountMinor", plan.amountMinor, patch.amountMinor);
    }
    if (patch.every !== undefined && patch.every !== plan.every) {
      this.#db
        .prepare("UPDATE crm_plans SET every = ?, updated_at = ? WHERE plan_id = ?")
        .run(patch.every, this.#at, planId);
      changed("every", plan.every, patch.every);
    }
  }

  #removeOpenPayments(planId: string, after: string | null): number {
    const result = this.#db
      .prepare(
        `DELETE FROM crm_payments WHERE plan_id = ? AND paid_at IS NULL ${after === null ? "" : "AND due_on > ?"}`,
      )
      .run(...(after === null ? [planId] : [planId, after]));
    return Number(result.changes);
  }

  #endPlan(planId: string, endsOn: string): void {
    const plan = this.#store.plan(planId);
    editable(plan);
    if (endsOn < plan.startsOn) throw crmRefused("error.crm.planEndsBeforeStart");
    if (endsOn === plan.endsOn) return;
    this.#db
      .prepare("UPDATE crm_plans SET ends_on = ?, updated_at = ? WHERE plan_id = ?")
      .run(endsOn, this.#at, planId);
    const removedPayments = this.#removeOpenPayments(planId, endsOn);
    this.record(plan.customerId, "plan-ended", { plan: plan.name, endsOn, removedPayments });
  }

  #deletePlan(planId: string): void {
    const plan = this.#store.plan(planId);
    editable(plan);
    const removedPayments = this.#removeOpenPayments(planId, null);
    this.#db.prepare("DELETE FROM crm_plans WHERE plan_id = ?").run(planId);
    this.record(plan.customerId, "plan-deleted", { plan: plan.name, removedPayments });
  }

  #createPayment(input: {
    customerId: string;
    label: string;
    amountMinor: number;
    dueOn: string;
    method?: CrmMethod | null;
    paidAt?: string | null;
  }): string {
    const customer = this.#store.customerRecord(input.customerId);
    const paidAt = input.paidAt ? new Date(input.paidAt).toISOString() : null;
    const payment = this.insertPayment({
      customerId: customer.id,
      planId: null,
      label: input.label,
      amountMinor: input.amountMinor,
      dueOn: input.dueOn,
      paidAt,
      method: input.method === undefined ? customer.method : input.method,
    });
    this.record(customer.id, "payment-created", {
      number: payment.number,
      label: input.label,
      amountMinor: input.amountMinor,
      currency: customer.currency,
      dueOn: input.dueOn,
      paidAt,
    });
    return payment.id;
  }

  #updatePayment(
    paymentId: string,
    patch: { label?: string; amountMinor?: number; dueOn?: string; method?: CrmMethod | null },
  ): void {
    const payment = this.#store.payment(paymentId);
    editable(payment);
    const fields = [
      ["label", "label", payment.label, patch.label],
      ["amountMinor", "amount_minor", payment.amountMinor, patch.amountMinor],
      ["dueOn", "due_on", payment.dueOn, patch.dueOn],
      ["method", "method", payment.method, patch.method],
    ] as const;
    for (const [field, column, from, to] of fields) {
      if (to === undefined || to === from) continue;
      this.#db
        .prepare(`UPDATE crm_payments SET ${column} = ?, updated_at = ? WHERE payment_id = ?`)
        .run(to, this.#at, paymentId);
      this.record(payment.customerId, "payment-changed", {
        number: payment.number,
        field,
        from,
        to,
        currency: payment.currency,
      });
    }
  }

  #markPaid(paymentId: string, paidAt: string | null): void {
    const payment = this.#store.payment(paymentId);
    editable(payment);
    const update = this.#db.prepare("UPDATE crm_payments SET paid_at = ?, updated_at = ? WHERE payment_id = ?");
    if (paidAt === null) {
      if (payment.paidAt === null) return;
      update.run(null, this.#at, paymentId);
      this.record(payment.customerId, "payment-unpaid", { number: payment.number, label: payment.label });
      return;
    }
    const at = new Date(paidAt).toISOString();
    if (payment.paidAt !== null) {
      if (payment.paidAt === at) return;
      update.run(at, this.#at, paymentId);
      this.record(payment.customerId, "payment-changed", {
        number: payment.number,
        field: "paidAt",
        from: payment.paidAt,
        to: at,
      });
      return;
    }
    update.run(at, this.#at, paymentId);
    this.record(payment.customerId, "payment-paid", {
      number: payment.number,
      label: payment.label,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      paidAt: at,
    });
    if (payment.planId !== null) this.#nextPlanPayment(payment.planId, payment.method);
  }

  #nextPlanPayment(planId: string, paidMethod: CrmMethod | null): void {
    const plan = this.#store.plan(planId);
    if (plan.every === "once") return;
    if (this.#count("SELECT count(*) AS count FROM crm_payments WHERE plan_id = ? AND paid_at IS NULL", planId) > 0)
      return;
    const last = optionalStringColumn(
      databaseRow(this.#db.prepare("SELECT max(due_on) AS due_on FROM crm_payments WHERE plan_id = ?").get(planId)) ?? {
        due_on: null,
      },
      "due_on",
    );
    const months = PERIOD_MONTHS[plan.every];
    let dueOn: string | null = null;
    for (let step = 1; ; step += 1) {
      dueOn = addCrmMonths(plan.startsOn, step * months);
      if (dueOn === null || last === null || dueOn > last) break;
    }
    if (dueOn === null || (plan.endsOn !== null && dueOn > plan.endsOn)) return;
    const customer = this.#store.customerRecord(plan.customerId);
    const payment = this.insertPayment({
      customerId: plan.customerId,
      planId,
      label: plan.name,
      amountMinor: plan.amountMinor,
      dueOn,
      paidAt: null,
      method: paidMethod ?? customer.method,
    });
    this.record(plan.customerId, "payment-created", {
      number: payment.number,
      label: plan.name,
      amountMinor: plan.amountMinor,
      currency: customer.currency,
      dueOn,
      paidAt: null,
      plan: plan.name,
    });
  }

  #split(paymentId: string, parts: readonly { amountMinor: number; dueOn: string }[]): void {
    const payment = this.#store.payment(paymentId);
    editable(payment);
    if (payment.paidAt !== null) throw crmRefused("error.crm.paymentPaid");
    if (parts.reduce((total, part) => total + part.amountMinor, 0) !== payment.amountMinor)
      throw crmRefused("error.crm.splitTotal");
    const [first, ...rest] = parts;
    if (!first) throw crmRefused("error.crm.invalidChange");
    this.#db
      .prepare("UPDATE crm_payments SET amount_minor = ?, due_on = ?, updated_at = ? WHERE payment_id = ?")
      .run(first.amountMinor, first.dueOn, this.#at, paymentId);
    const numbers = [payment.number];
    for (const part of rest) {
      numbers.push(
        this.insertPayment({
          customerId: payment.customerId,
          planId: payment.planId,
          label: payment.label,
          amountMinor: part.amountMinor,
          dueOn: part.dueOn,
          paidAt: null,
          method: payment.method,
        }).number,
      );
    }
    this.record(payment.customerId, "payment-split", {
      number: payment.number,
      parts: parts.length,
      numbers: numbers.join(", "),
      amountMinor: payment.amountMinor,
      currency: payment.currency,
    });
  }

  #createTag(label: string): string {
    if (this.#count("SELECT count(*) AS count FROM crm_tags") >= CRM_LIMITS.tags)
      throw crmRefused("error.crm.tooManyTags");
    if (databaseRow(this.#db.prepare("SELECT 1 AS found FROM crm_tags WHERE label = ?").get(label)))
      throw crmRefused("error.crm.tagExists");
    const tagId = newCrmId();
    this.#db.prepare("INSERT INTO crm_tags (tag_id, label, created_at) VALUES (?, ?, ?)").run(tagId, label, this.#at);
    return tagId;
  }

  #deleteTag(tagId: string): void {
    const tag = this.#store.tag(tagId);
    const customers = databaseRows(
      this.#db.prepare("SELECT customer_id FROM crm_customer_tags WHERE tag_id = ?").all(tagId),
    ).map((row) => requiredStringColumn(row, "customer_id"));
    for (const customerId of customers) this.record(customerId, "tags-changed", { added: null, removed: tag.label });
    this.#db.prepare("DELETE FROM crm_tags WHERE tag_id = ?").run(tagId);
  }

  #labelTaken(label: string, exceptId: string | null): boolean {
    return (
      databaseRow(
        this.#db
          .prepare("SELECT 1 AS found FROM crm_statuses WHERE label = ? AND status_id IS NOT ?")
          .get(label, exceptId),
      ) !== null
    );
  }

  #createStatus(label: string): string {
    const count = this.#count("SELECT count(*) AS count FROM crm_statuses");
    if (count >= CRM_LIMITS.statuses) throw crmRefused("error.crm.tooManyStatuses");
    if (this.#labelTaken(label, null)) throw crmRefused("error.crm.statusExists");
    const tone: CrmTone = CRM_TONES[count % CRM_TONES.length] ?? "secondary";
    const statusId = newCrmId();
    this.#db
      .prepare(
        `INSERT INTO crm_statuses (status_id, label, tone, position, created_at)
         VALUES (?, ?, ?, (SELECT coalesce(max(position), -1) + 1 FROM crm_statuses), ?)`,
      )
      .run(statusId, label, tone, this.#at);
    return statusId;
  }

  #customStatus(statusId: string): CrmStatusRecord {
    if (isOneOf(CRM_BUILTIN_STATUS_IDS, statusId)) throw crmRefused("error.crm.builtinStatus");
    return this.#store.status(statusId);
  }

  #renameStatus(statusId: string, label: string): void {
    this.#customStatus(statusId);
    if (this.#labelTaken(label, statusId)) throw crmRefused("error.crm.statusExists");
    this.#db.prepare("UPDATE crm_statuses SET label = ? WHERE status_id = ?").run(label, statusId);
  }

  #deleteStatus(statusId: string, replaceWith: string): void {
    const from = this.#customStatus(statusId);
    const to = this.#store.status(replaceWith);
    const customers = databaseRows(
      this.#db.prepare("SELECT customer_id FROM crm_customers WHERE status_id = ?").all(statusId),
    ).map((row) => requiredStringColumn(row, "customer_id"));
    this.#db.prepare("UPDATE crm_customers SET status_id = ? WHERE status_id = ?").run(to.id, statusId);
    for (const customerId of customers) this.#statusChanged(customerId, from, to);
    this.#db.prepare("DELETE FROM crm_statuses WHERE status_id = ?").run(statusId);
  }
}
