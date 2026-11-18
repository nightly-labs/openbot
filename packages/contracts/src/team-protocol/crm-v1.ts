// Optional crm-v1 wire contract. Not released yet; freeze it with the first release that ships it.
// Keep IPC types and limits out of this file.
//
// What it grants: an owner or admin of a
// server reads and changes its CRM: the statuses, tags, customers with their plans, payments,
// activity and the changes that agents propose. A member gets 403 on every route, and the host sends
// the `crm-changed` event only to clients that may read the CRM. Customers cross in pages of at most
// 500, ordered by their `number`; payments and activity cross in pages of at most 500, with an
// opaque cursor. Amounts are whole minor units of the customer's ISO 4217 currency, and due dates are
// calendar dates (`YYYY-MM-DD`). `apply` takes one change; a customer update names the revision it
// read, and the host answers a conflict instead of writing over a newer change. An approved proposal
// applies its change as the person who approved it. Activity kinds cross as open names, so a newer
// host can add one; a client shows an unknown kind plainly. The event names no customer; the client
// reads the CRM again. An owner or admin also connects a payment source (Stripe) with a read-only
// key, starts a sync, and disconnects it. The key crosses only in the connect request; no response
// holds it. Rows that a connected source owns cross with `source` set. An owner or admin reads and
// sets the CRM switch (`settings`, `set-settings`); while it is off, the client shows no CRM, but the
// other routes still answer. After the release, widening any
// of it needs a second capability string.
import { isDynamicRecord, isString } from "../runtime-values";
import {
  type AdminDecoder,
  adminRoute,
  boolean,
  count,
  empty,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
  variant,
} from "./admin-wire";

export const CRM_CAPABILITY = "crm-v1";

export const CRM_ROUTES = {
  overview: "/v1/crm/overview",
  customers: "/v1/crm/customers",
  payments: "/v1/crm/payments",
  activity: "/v1/crm/activity",
  apply: "/v1/crm/apply",
  sourceConnect: "/v1/crm/source-connect",
  sourceDisconnect: "/v1/crm/source-disconnect",
  sourceSync: "/v1/crm/source-sync",
  settings: "/v1/crm/settings",
  setSettings: "/v1/crm/set-settings",
} as const;

export type CrmEvent = { type: "crm-changed" };

/** The CRM event in `value`, or null for any other event. */
export function crmEvent(value: unknown): CrmEvent | null {
  if (!isDynamicRecord(value) || value.type !== "crm-changed") return null;
  return { type: "crm-changed" };
}

const PAGE = 500;
const TEXT_FIELDS = [
  "name",
  "contactName",
  "contactEmail",
  "phone",
  "billingEmail",
  "domain",
  "taxId",
  "address",
  "stripeCustomerId",
  "notes",
] as const;
const PRIVATE_FIELDS = [...TEXT_FIELDS, "amounts", "dates", "status", "tags", "plans", "method", "owner"] as const;
const METHODS = ["stripe", "transfer", "crypto", "paypal", "cash"] as const;
const EVERY = ["month", "quarter", "year", "once"] as const;
const SOURCE_KINDS = ["stripe"] as const;
const TONES = ["info-light", "secondary", "outline", "warning-light", "success-light", "primary-light"] as const;

const text = string(500);
const notes = string(4_000);
const label = string(80);
const timestamp = string(64);
const cursor = string(128);
const date: AdminDecoder = (value) => {
  if (!isString(value) || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new Error("Invalid CRM date.");
  return value;
};
const currency: AdminDecoder = (value) => {
  if (!isString(value) || !/^[A-Z]{3}$/u.test(value)) throw new Error("Invalid CRM currency.");
  return value;
};
const amount: AdminDecoder = (value) => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000_000)
    throw new Error("Invalid CRM amount.");
  return value;
};
const ordinal: AdminDecoder = (value) => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new Error("Invalid CRM number.");
  return value;
};
const kindName: AdminDecoder = (value) => {
  if (!isString(value) || !/^[a-z][a-z0-9-]{0,47}$/u.test(value)) throw new Error("Invalid CRM kind.");
  return value;
};
const details: AdminDecoder = (value) => {
  if (!isDynamicRecord(value) || Object.keys(value).length > 16) throw new Error("Invalid CRM details.");
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (key.length > 48) throw new Error("Invalid CRM details.");
      if (item === null || (typeof item === "number" && Number.isFinite(item))) return [key, item];
      if (isString(item) && item.length <= 4_000) return [key, item];
      throw new Error("Invalid CRM details.");
    }),
  );
};
const method = nullable(oneOf(...METHODS));
const source = nullable(oneOf(...SOURCE_KINDS));
const privateField = oneOf(...PRIVATE_FIELDS);
const ids = (maximum: number) => list(identifier, maximum);

const textFields = (required: boolean): Record<string, AdminDecoder> =>
  Object.fromEntries(
    TEXT_FIELDS.filter((field) => required || field !== "name").map((field) => [
      field,
      field === "notes" ? notes : field === "name" ? string(200) : text,
    ]),
  );
const customerOptional = {
  ...textFields(false),
  statusId: identifier,
  ownerAgentId: nullable(identifier),
  method,
  currency,
};

const customerInput = fields({ name: string(200), currency }, { ...customerOptional, tagIds: ids(50) });
const customerPatch = fields({}, { ...customerOptional, name: string(200) });
const planInput = fields({
  customerId: identifier,
  name: label,
  amountMinor: amount,
  every: oneOf(...EVERY),
  startsOn: date,
});
const planPatch = fields({}, { name: label, amountMinor: amount, every: oneOf(...EVERY) });
const paymentInput = fields(
  { customerId: identifier, label, amountMinor: amount, dueOn: date },
  { method, paidAt: nullable(timestamp) },
);
const paymentPatch = fields({}, { label, amountMinor: amount, dueOn: date, method });

const proposedCases: Record<string, AdminDecoder> = {
  "customer-create": fields({ kind: oneOf("customer-create"), customer: customerInput }),
  "customer-update": fields({ kind: oneOf("customer-update"), customerId: identifier, patch: customerPatch }),
  "customer-tags": fields({ kind: oneOf("customer-tags"), customerId: identifier, tagIds: ids(50) }),
  "plan-create": fields({ kind: oneOf("plan-create"), plan: planInput }),
  "plan-update": fields({ kind: oneOf("plan-update"), planId: identifier, patch: planPatch }),
  "plan-end": fields({ kind: oneOf("plan-end"), planId: identifier, endsOn: date }),
  "payment-create": fields({ kind: oneOf("payment-create"), payment: paymentInput }),
  "payment-update": fields({ kind: oneOf("payment-update"), paymentId: identifier, patch: paymentPatch }),
  "payment-paid": fields({ kind: oneOf("payment-paid"), paymentIds: ids(500), paidAt: nullable(timestamp) }),
  "payment-split": fields({
    kind: oneOf("payment-split"),
    paymentId: identifier,
    parts: list(fields({ amountMinor: amount, dueOn: date }), 24),
  }),
};
const proposedChange = variant(proposedCases);

const change = variant({
  ...proposedCases,
  "customer-update": fields({
    kind: oneOf("customer-update"),
    customerId: identifier,
    patch: customerPatch,
    baseRevision: ordinal,
  }),
  "customer-delete": fields({ kind: oneOf("customer-delete"), customerId: identifier }),
  "tag-create": fields({ kind: oneOf("tag-create"), label: string(40) }),
  "tag-delete": fields({ kind: oneOf("tag-delete"), tagId: identifier }),
  "status-create": fields({ kind: oneOf("status-create"), label }),
  "status-rename": fields({ kind: oneOf("status-rename"), statusId: identifier, label }),
  "status-delete": fields({ kind: oneOf("status-delete"), statusId: identifier, replaceWith: identifier }),
  "plan-delete": fields({ kind: oneOf("plan-delete"), planId: identifier }),
  "payment-delete": fields({ kind: oneOf("payment-delete"), paymentId: identifier }),
  "private-fields": fields({ kind: oneOf("private-fields"), fields: list(privateField, PRIVATE_FIELDS.length) }),
  "agent-access": fields({ kind: oneOf("agent-access"), agentIds: ids(500) }),
  "proposal-decide": fields({ kind: oneOf("proposal-decide"), proposalId: identifier, approve: boolean }),
});

const status = fields({ id: identifier, label: nullable(label), tone: oneOf(...TONES) });
const tag = fields({ id: identifier, label: string(40) });
const plan = fields({
  id: identifier,
  customerId: identifier,
  name: label,
  amountMinor: amount,
  every: oneOf(...EVERY),
  startsOn: date,
  endsOn: nullable(date),
  source,
});
const customer = fields({
  ...textFields(true),
  id: identifier,
  number: ordinal,
  statusId: identifier,
  ownerAgentId: nullable(identifier),
  method,
  currency,
  tagIds: ids(50),
  plans: list(plan, 50),
  createdAt: timestamp,
  updatedAt: timestamp,
  revision: ordinal,
  paidMinor: count,
  openMinor: count,
  lateMinor: count,
  nextDueOn: nullable(date),
  lastPaidAt: nullable(timestamp),
  source,
});
const payment = fields({
  id: identifier,
  number: ordinal,
  customerId: identifier,
  planId: nullable(identifier),
  label,
  amountMinor: amount,
  currency,
  dueOn: date,
  paidAt: nullable(timestamp),
  method,
  source,
});
const activity = fields({
  id: identifier,
  customerId: identifier,
  actor: fields({ kind: oneOf("person", "agent", "source"), id: nullable(identifier), name: nullable(string(200)) }),
  kind: kindName,
  details,
  proposedBy: nullable(identifier),
  createdAt: timestamp,
});
const proposal = fields({
  id: identifier,
  agentId: identifier,
  customerId: nullable(identifier),
  threadId: nullable(identifier),
  reason: string(1_000),
  change: proposedChange,
  createdAt: timestamp,
});
const sourceState = fields({
  id: identifier,
  kind: oneOf(...SOURCE_KINDS),
  testMode: boolean,
  accountLabel: string(200),
  keyHint: string(8),
  state: oneOf("syncing", "ok", "error"),
  errorCode: nullable(oneOf("invalid-key", "permission", "rate-limited", "network", "stripe")),
  syncedAt: nullable(timestamp),
  connectedAt: timestamp,
  skipped: fields({ currency: count, interval: count, limit: count }),
});
const overview = fields({
  statuses: list(status, 50),
  tags: list(tag, 500),
  privateFields: list(privateField, PRIVATE_FIELDS.length),
  agentIds: ids(500),
  proposals: list(proposal, 500),
  sources: list(sourceState, SOURCE_KINDS.length),
});
const applyResult: AdminDecoder = (value) => {
  if (isDynamicRecord(value) && value.ok === false) return fields({ ok: boolean, conflict: oneOf("revision") })(value);
  return fields({ ok: boolean, id: nullable(identifier) })(value);
};

export const CRM_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [CRM_ROUTES.overview, adminRoute(empty, overview)],
  [
    CRM_ROUTES.customers,
    adminRoute(fields({}, { after: ordinal }), fields({ customers: list(customer, PAGE), next: nullable(ordinal) })),
  ],
  [
    CRM_ROUTES.payments,
    adminRoute(
      fields({ state: oneOf("open", "paid") }, { customerId: identifier, after: cursor }),
      fields({ payments: list(payment, PAGE), next: nullable(cursor) }),
    ),
  ],
  [
    CRM_ROUTES.activity,
    adminRoute(
      fields({ customerId: identifier }, { after: cursor }),
      fields({ activity: list(activity, PAGE), next: nullable(cursor) }),
    ),
  ],
  [CRM_ROUTES.apply, adminRoute(change, applyResult)],
  [CRM_ROUTES.sourceConnect, adminRoute(fields({ kind: oneOf(...SOURCE_KINDS), key: string(255) }), applyResult)],
  [CRM_ROUTES.sourceDisconnect, adminRoute(fields({ sourceId: identifier }), applyResult)],
  [CRM_ROUTES.sourceSync, adminRoute(fields({ sourceId: identifier }), applyResult)],
  [CRM_ROUTES.settings, adminRoute(empty, fields({ enabled: boolean }))],
  [CRM_ROUTES.setSettings, adminRoute(fields({ enabled: boolean }), fields({ enabled: boolean }))],
]);
