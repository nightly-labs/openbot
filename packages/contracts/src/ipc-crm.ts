import { integerInRange, isBoundedString, isIdentifier } from "./ipc-bounded-values";
import { type DynamicRecord, isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "./runtime-values";

/**
 * CRM: the leads and customers of a server, the plans they bought, and their payments. The data is in
 * the host's `openbot.db`. Only an owner or admin reads and changes it. An agent that an owner or
 * admin lets in reads it through its tools, with private fields hidden, and only proposes changes;
 * an owner or admin approves each one. A connected payment source (Stripe) adds and updates the
 * rows that it owns; people and agents only read them. These IPC types also cross the Team API
 * through the `crm-v1` codec (`team-protocol/crm-v1.ts`), so change both together.
 */

export const CRM_LIMITS = {
  name: 200,
  text: 500,
  notes: 4_000,
  label: 80,
  tag: 40,
  reason: 1_000,
  statuses: 50,
  tags: 500,
  customerTags: 50,
  customerPlans: 50,
  agents: 500,
  /** The most rows in one page of customers, payments or activity. */
  page: 500,
  /** The most payments that one change marks as paid. */
  paymentIds: 500,
  splitParts: 24,
  pendingProposals: 500,
  /** The largest amount, in minor units (one trillion). */
  amountMinor: 1_000_000_000_000,
} as const;

export const CRM_BUILTIN_STATUS_IDS = ["lead", "customer", "former"] as const;
export type CrmBuiltinStatusId = (typeof CRM_BUILTIN_STATUS_IDS)[number];

export const CRM_TONES = [
  "info-light",
  "secondary",
  "outline",
  "warning-light",
  "success-light",
  "primary-light",
] as const;
export type CrmTone = (typeof CRM_TONES)[number];

/** How a customer pays. OpenBot keeps no card numbers: Stripe holds the card. */
export const CRM_METHODS = ["stripe", "transfer", "crypto", "paypal", "cash"] as const;
export type CrmMethod = (typeof CRM_METHODS)[number];

export const CRM_EVERY = ["month", "quarter", "year", "once"] as const;
export type CrmEvery = (typeof CRM_EVERY)[number];

/** The payment sources that the host can sync from. */
export const CRM_SOURCE_KINDS = ["stripe"] as const;
export type CrmSourceKind = (typeof CRM_SOURCE_KINDS)[number];

export const CRM_SOURCE_STATES = ["syncing", "ok", "error"] as const;
export type CrmSourceSyncState = (typeof CRM_SOURCE_STATES)[number];

/** Why the last sync failed. The source's own error text never crosses. */
export const CRM_SOURCE_ERRORS = ["invalid-key", "permission", "rate-limited", "network", "stripe"] as const;
export type CrmSourceError = (typeof CRM_SOURCE_ERRORS)[number];

/** A connected payment source. The key never crosses: only its last 4 characters. */
export interface CrmSource {
  id: string;
  kind: CrmSourceKind;
  /** A test-mode key: the rows are test data. */
  testMode: boolean;
  /** The account name at the source, or "" when the key cannot read it. */
  accountLabel: string;
  keyHint: string;
  state: CrmSourceSyncState;
  errorCode: CrmSourceError | null;
  syncedAt: string | null;
  connectedAt: string;
  /** Rows that the last full sync did not import: another currency, an interval the CRM has not, or a limit. */
  skipped: { currency: number; interval: number; limit: number };
}

export interface CrmSourceConnectInput {
  kind: CrmSourceKind;
  /** A restricted read-only key. */
  key: string;
}

export interface CrmSourceInput {
  sourceId: string;
}

/**
 * The CRM switch of a server, in Server Settings > Experimental. Off by default. While it is off, the
 * clients show no CRM, agents cannot use it and the payment sources do not sync. The data stays.
 */
export interface CrmSettings {
  enabled: boolean;
}

export const DEFAULT_CRM_SETTINGS: CrmSettings = { enabled: false };

/** The customer text fields. Each one can be private: agents then do not see its value. */
export const CRM_TEXT_FIELDS = [
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
export type CrmTextField = (typeof CRM_TEXT_FIELDS)[number];

/**
 * What an owner or admin can hide from agents: each text field, and these parts of a customer. One
 * part covers each sheet column that shows it, so "amounts" hides the amount, owed and paid columns.
 */
export const CRM_PRIVATE_PARTS = ["amounts", "dates", "status", "tags", "plans", "method", "owner"] as const;
export const CRM_PRIVATE_FIELDS = [...CRM_TEXT_FIELDS, ...CRM_PRIVATE_PARTS] as const;
export type CrmPrivateField = (typeof CRM_PRIVATE_FIELDS)[number];

export type CrmCustomerText = Record<CrmTextField, string>;

export interface CrmStatus {
  id: string;
  /** null for a built-in status: the client shows its catalog name. */
  label: string | null;
  tone: CrmTone;
}

export interface CrmTag {
  id: string;
  label: string;
}

export interface CrmPlan {
  id: string;
  customerId: string;
  name: string;
  amountMinor: number;
  every: CrmEvery;
  /** The due date of the first payment, `YYYY-MM-DD`. */
  startsOn: string;
  /** The last day of the plan, `YYYY-MM-DD`. No payment is due after it. */
  endsOn: string | null;
  /** The connected source that owns the plan: then it is read-only. */
  source: CrmSourceKind | null;
}

export interface CrmCustomer extends CrmCustomerText {
  id: string;
  /** Stable and unique on the host. Agents see `Customer <number>` when the name is private. */
  number: number;
  statusId: string;
  /** The agent that looks after the customer. null: the people of the server. */
  ownerAgentId: string | null;
  method: CrmMethod | null;
  /** ISO 4217, such as "EUR". Plans and payments of the customer use it. */
  currency: string;
  tagIds: string[];
  plans: CrmPlan[];
  createdAt: string;
  updatedAt: string;
  /** Goes up with each change; an update names the revision it read. */
  revision: number;
  paidMinor: number;
  openMinor: number;
  lateMinor: number;
  /** The earliest due date of an open payment. */
  nextDueOn: string | null;
  lastPaidAt: string | null;
  /** The connected source that links the customer: then `stripeCustomerId` is read-only. */
  source: CrmSourceKind | null;
}

export interface CrmPayment {
  id: string;
  /** The invoice number, unique on the host. */
  number: number;
  customerId: string;
  planId: string | null;
  label: string;
  amountMinor: number;
  currency: string;
  dueOn: string;
  paidAt: string | null;
  method: CrmMethod | null;
  /** The connected source that owns the payment: then it is read-only. */
  source: CrmSourceKind | null;
}

export const CRM_ACTOR_KINDS = ["person", "agent", "source"] as const;
export type CrmActorKind = (typeof CRM_ACTOR_KINDS)[number];

export interface CrmActor {
  kind: CrmActorKind;
  /**
   * The agent id, the member id of a person on a joined server, or the source kind. null: the owner on
   * this computer.
   */
  id: string | null;
  /** The person's name when the change came over the Team API. */
  name: string | null;
}

/** What happened to a customer. The client writes the sentence from `kind` and `details`. */
export interface CrmActivity {
  id: string;
  customerId: string;
  actor: CrmActor;
  /** A short name such as "payment-paid". A newer host can add kinds; a client shows an unknown one plainly. */
  kind: string;
  details: Record<string, string | number | null>;
  /** The agent whose proposal the person approved. */
  proposedBy: string | null;
  createdAt: string;
}

export interface CrmProposal {
  id: string;
  agentId: string;
  /** null when the agent proposes a new customer. */
  customerId: string | null;
  /** The chat the agent proposed it from. */
  threadId: string | null;
  reason: string;
  change: CrmProposedChange;
  createdAt: string;
}

export interface CrmOverview {
  statuses: CrmStatus[];
  tags: CrmTag[];
  privateFields: CrmPrivateField[];
  /** The agents that may read the CRM and propose changes. */
  agentIds: string[];
  proposals: CrmProposal[];
  sources: CrmSource[];
}

export interface CrmCustomerPageInput {
  /** The `number` of the last customer of the previous page. */
  after?: number;
}

export interface CrmCustomerPage {
  customers: CrmCustomer[];
  next: number | null;
}

export const CRM_PAYMENT_STATES = ["open", "paid"] as const;
export type CrmPaymentState = (typeof CRM_PAYMENT_STATES)[number];

export interface CrmPaymentPageInput {
  state: CrmPaymentState;
  customerId?: string;
  /** The cursor of the previous page. */
  after?: string;
}

export interface CrmPaymentPage {
  payments: CrmPayment[];
  next: string | null;
}

export interface CrmActivityPageInput {
  customerId: string;
  after?: string;
}

export interface CrmActivityPage {
  activity: CrmActivity[];
  next: string | null;
}

export type CrmCustomerInput = Partial<CrmCustomerText> & {
  name: string;
  statusId?: string;
  ownerAgentId?: string | null;
  method?: CrmMethod | null;
  currency: string;
  tagIds?: string[];
};

export type CrmCustomerPatch = Partial<CrmCustomerText> & {
  statusId?: string;
  ownerAgentId?: string | null;
  method?: CrmMethod | null;
  currency?: string;
};

export interface CrmPlanInput {
  customerId: string;
  name: string;
  amountMinor: number;
  every: CrmEvery;
  startsOn: string;
}

export interface CrmPlanPatch {
  name?: string;
  /** Also changes the open payments of the plan. */
  amountMinor?: number;
  every?: CrmEvery;
}

export interface CrmPaymentInput {
  customerId: string;
  label: string;
  amountMinor: number;
  dueOn: string;
  method?: CrmMethod | null;
  /** Set to record a payment that is already paid. */
  paidAt?: string | null;
}

export interface CrmPaymentPatch {
  label?: string;
  amountMinor?: number;
  dueOn?: string;
  method?: CrmMethod | null;
}

export interface CrmSplitPart {
  amountMinor: number;
  dueOn: string;
}

/** A change that an agent can propose. A person applies the same kinds directly. */
export type CrmProposedChange =
  | { kind: "customer-create"; customer: CrmCustomerInput }
  | { kind: "customer-update"; customerId: string; patch: CrmCustomerPatch }
  | { kind: "customer-tags"; customerId: string; tagIds: string[] }
  | { kind: "plan-create"; plan: CrmPlanInput }
  | { kind: "plan-update"; planId: string; patch: CrmPlanPatch }
  | { kind: "plan-end"; planId: string; endsOn: string }
  | { kind: "payment-create"; payment: CrmPaymentInput }
  | { kind: "payment-update"; paymentId: string; patch: CrmPaymentPatch }
  | { kind: "payment-paid"; paymentIds: string[]; paidAt: string | null }
  | { kind: "payment-split"; paymentId: string; parts: CrmSplitPart[] };

export const CRM_PROPOSED_KINDS = [
  "customer-create",
  "customer-update",
  "customer-tags",
  "plan-create",
  "plan-update",
  "plan-end",
  "payment-create",
  "payment-update",
  "payment-paid",
  "payment-split",
] as const satisfies readonly CrmProposedChange["kind"][];

/** A change by an owner or admin. */
export type CrmChange =
  | Exclude<CrmProposedChange, { kind: "customer-update" }>
  | { kind: "customer-update"; customerId: string; patch: CrmCustomerPatch; baseRevision: number }
  | { kind: "customer-delete"; customerId: string }
  | { kind: "tag-create"; label: string }
  | { kind: "tag-delete"; tagId: string }
  | { kind: "status-create"; label: string }
  | { kind: "status-rename"; statusId: string; label: string }
  /** The customers with the status move to `replaceWith`. */
  | { kind: "status-delete"; statusId: string; replaceWith: string }
  | { kind: "plan-delete"; planId: string }
  | { kind: "payment-delete"; paymentId: string }
  | { kind: "private-fields"; fields: CrmPrivateField[] }
  | { kind: "agent-access"; agentIds: string[] }
  | { kind: "proposal-decide"; proposalId: string; approve: boolean };

export const CRM_CHANGE_KINDS = [
  ...CRM_PROPOSED_KINDS,
  "customer-delete",
  "tag-create",
  "tag-delete",
  "status-create",
  "status-rename",
  "status-delete",
  "plan-delete",
  "payment-delete",
  "private-fields",
  "agent-access",
  "proposal-decide",
] as const satisfies readonly CrmChange["kind"][];

export type CrmApplyResult =
  | { ok: true /** The id of a new customer, tag, status, plan or payment. */; id: string | null }
  /** The customer changed after `baseRevision`; the client reads it again. */
  | { ok: false; conflict: "revision" };

// --- Values ------------------------------------------------------------------------------------

const DATE = /^\d{4}-\d{2}-\d{2}$/u;

/** A real calendar date as `YYYY-MM-DD`. */
export function isCrmDate(value: unknown): value is string {
  if (!isString(value) || !DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isCrmTimestamp(value: unknown): value is string {
  return isString(value) && value.length <= 64 && !Number.isNaN(Date.parse(value));
}

export function isCrmCurrency(value: unknown): value is string {
  return isString(value) && /^[A-Z]{3}$/u.test(value);
}

export function isCrmAmount(value: unknown): value is number {
  return integerInRange(value, 0, CRM_LIMITS.amountMinor);
}

function isLabel(value: unknown, maximum: number): value is string {
  return isBoundedString(value, maximum) && value.trim().length > 0 && value.trim() === value;
}

function isText(field: CrmTextField, value: unknown): value is string {
  if (field === "name") return isLabel(value, CRM_LIMITS.name);
  return isBoundedString(value, field === "notes" ? CRM_LIMITS.notes : CRM_LIMITS.text);
}

function isIdList(value: unknown, maximum: number): value is string[] {
  return (
    Array.isArray(value) && value.length <= maximum && value.every(isIdentifier) && new Set(value).size === value.length
  );
}

function isNullable<T>(value: unknown, guard: (value: unknown) => value is T): value is T | null {
  return value === null || guard(value);
}

function isMethod(value: unknown): value is CrmMethod {
  return isOneOf(CRM_METHODS, value);
}

function hasOnly(value: DynamicRecord, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

const CUSTOMER_KEYS = [...CRM_TEXT_FIELDS, "statusId", "ownerAgentId", "method", "currency", "tagIds"] as const;

function isCustomerFields(value: DynamicRecord): boolean {
  return (
    CRM_TEXT_FIELDS.every((field) => value[field] === undefined || isText(field, value[field])) &&
    (value.statusId === undefined || isIdentifier(value.statusId)) &&
    (value.ownerAgentId === undefined || isNullable(value.ownerAgentId, isIdentifier)) &&
    (value.method === undefined || isNullable(value.method, isMethod)) &&
    (value.currency === undefined || isCrmCurrency(value.currency))
  );
}

function isCustomerInput(value: unknown): value is CrmCustomerInput {
  return (
    isDynamicRecord(value) &&
    hasOnly(value, CUSTOMER_KEYS) &&
    isText("name", value.name) &&
    isCrmCurrency(value.currency) &&
    isCustomerFields(value) &&
    (value.tagIds === undefined || isIdList(value.tagIds, CRM_LIMITS.customerTags))
  );
}

function isCustomerPatch(value: unknown): value is CrmCustomerPatch {
  return (
    isDynamicRecord(value) &&
    Object.keys(value).length > 0 &&
    hasOnly(
      value,
      CUSTOMER_KEYS.filter((key) => key !== "tagIds"),
    ) &&
    isCustomerFields(value)
  );
}

function isPlanInput(value: unknown): value is CrmPlanInput {
  return (
    isDynamicRecord(value) &&
    hasOnly(value, ["customerId", "name", "amountMinor", "every", "startsOn"]) &&
    isIdentifier(value.customerId) &&
    isLabel(value.name, CRM_LIMITS.label) &&
    isCrmAmount(value.amountMinor) &&
    isOneOf(CRM_EVERY, value.every) &&
    isCrmDate(value.startsOn)
  );
}

function isPlanPatch(value: unknown): value is CrmPlanPatch {
  return (
    isDynamicRecord(value) &&
    Object.keys(value).length > 0 &&
    hasOnly(value, ["name", "amountMinor", "every"]) &&
    (value.name === undefined || isLabel(value.name, CRM_LIMITS.label)) &&
    (value.amountMinor === undefined || isCrmAmount(value.amountMinor)) &&
    (value.every === undefined || isOneOf(CRM_EVERY, value.every))
  );
}

function isPaymentInput(value: unknown): value is CrmPaymentInput {
  return (
    isDynamicRecord(value) &&
    hasOnly(value, ["customerId", "label", "amountMinor", "dueOn", "method", "paidAt"]) &&
    isIdentifier(value.customerId) &&
    isLabel(value.label, CRM_LIMITS.label) &&
    isCrmAmount(value.amountMinor) &&
    isCrmDate(value.dueOn) &&
    (value.method === undefined || isNullable(value.method, isMethod)) &&
    (value.paidAt === undefined || isNullable(value.paidAt, isCrmTimestamp))
  );
}

function isPaymentPatch(value: unknown): value is CrmPaymentPatch {
  return (
    isDynamicRecord(value) &&
    Object.keys(value).length > 0 &&
    hasOnly(value, ["label", "amountMinor", "dueOn", "method"]) &&
    (value.label === undefined || isLabel(value.label, CRM_LIMITS.label)) &&
    (value.amountMinor === undefined || isCrmAmount(value.amountMinor)) &&
    (value.dueOn === undefined || isCrmDate(value.dueOn)) &&
    (value.method === undefined || isNullable(value.method, isMethod))
  );
}

function isSplitParts(value: unknown): value is CrmSplitPart[] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.length <= CRM_LIMITS.splitParts &&
    value.every(
      (part) =>
        isDynamicRecord(part) &&
        hasOnly(part, ["amountMinor", "dueOn"]) &&
        isCrmAmount(part.amountMinor) &&
        part.amountMinor > 0 &&
        isCrmDate(part.dueOn),
    )
  );
}

function isProposedFields(value: DynamicRecord): boolean {
  switch (value.kind) {
    case "customer-create":
      return hasOnly(value, ["kind", "customer"]) && isCustomerInput(value.customer);
    case "customer-update":
      return (
        hasOnly(value, ["kind", "customerId", "patch"]) &&
        isIdentifier(value.customerId) &&
        isCustomerPatch(value.patch)
      );
    case "customer-tags":
      return (
        hasOnly(value, ["kind", "customerId", "tagIds"]) &&
        isIdentifier(value.customerId) &&
        isIdList(value.tagIds, CRM_LIMITS.customerTags)
      );
    case "plan-create":
      return hasOnly(value, ["kind", "plan"]) && isPlanInput(value.plan);
    case "plan-update":
      return hasOnly(value, ["kind", "planId", "patch"]) && isIdentifier(value.planId) && isPlanPatch(value.patch);
    case "plan-end":
      return hasOnly(value, ["kind", "planId", "endsOn"]) && isIdentifier(value.planId) && isCrmDate(value.endsOn);
    case "payment-create":
      return hasOnly(value, ["kind", "payment"]) && isPaymentInput(value.payment);
    case "payment-update":
      return (
        hasOnly(value, ["kind", "paymentId", "patch"]) && isIdentifier(value.paymentId) && isPaymentPatch(value.patch)
      );
    case "payment-paid":
      return (
        hasOnly(value, ["kind", "paymentIds", "paidAt"]) &&
        isIdList(value.paymentIds, CRM_LIMITS.paymentIds) &&
        value.paymentIds.length > 0 &&
        isNullable(value.paidAt, isCrmTimestamp)
      );
    case "payment-split":
      return (
        hasOnly(value, ["kind", "paymentId", "parts"]) && isIdentifier(value.paymentId) && isSplitParts(value.parts)
      );
    default:
      return false;
  }
}

export function isCrmProposedChange(value: unknown): value is CrmProposedChange {
  return isDynamicRecord(value) && isOneOf(CRM_PROPOSED_KINDS, value.kind) && isProposedFields(value);
}

export function isCrmChange(value: unknown): value is CrmChange {
  if (!isDynamicRecord(value) || !isString(value.kind)) return false;
  switch (value.kind) {
    case "customer-update":
      return (
        hasOnly(value, ["kind", "customerId", "patch", "baseRevision"]) &&
        isIdentifier(value.customerId) &&
        isCustomerPatch(value.patch) &&
        integerInRange(value.baseRevision, 1, Number.MAX_SAFE_INTEGER)
      );
    case "customer-delete":
      return hasOnly(value, ["kind", "customerId"]) && isIdentifier(value.customerId);
    case "tag-create":
      return hasOnly(value, ["kind", "label"]) && isLabel(value.label, CRM_LIMITS.tag);
    case "tag-delete":
      return hasOnly(value, ["kind", "tagId"]) && isIdentifier(value.tagId);
    case "status-create":
      return hasOnly(value, ["kind", "label"]) && isLabel(value.label, CRM_LIMITS.label);
    case "status-rename":
      return (
        hasOnly(value, ["kind", "statusId", "label"]) &&
        isIdentifier(value.statusId) &&
        isLabel(value.label, CRM_LIMITS.label)
      );
    case "status-delete":
      return (
        hasOnly(value, ["kind", "statusId", "replaceWith"]) &&
        isIdentifier(value.statusId) &&
        isIdentifier(value.replaceWith) &&
        value.statusId !== value.replaceWith
      );
    case "plan-delete":
      return hasOnly(value, ["kind", "planId"]) && isIdentifier(value.planId);
    case "payment-delete":
      return hasOnly(value, ["kind", "paymentId"]) && isIdentifier(value.paymentId);
    case "private-fields":
      return (
        hasOnly(value, ["kind", "fields"]) &&
        Array.isArray(value.fields) &&
        value.fields.every((field) => isOneOf(CRM_PRIVATE_FIELDS, field)) &&
        new Set(value.fields).size === value.fields.length
      );
    case "agent-access":
      return hasOnly(value, ["kind", "agentIds"]) && isIdList(value.agentIds, CRM_LIMITS.agents);
    case "proposal-decide":
      return (
        hasOnly(value, ["kind", "proposalId", "approve"]) && isIdentifier(value.proposalId) && isBoolean(value.approve)
      );
    default:
      return isOneOf(CRM_PROPOSED_KINDS, value.kind) && isProposedFields(value);
  }
}

// --- Responses ---------------------------------------------------------------------------------

function isStatus(value: unknown): value is CrmStatus {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isNullable(value.label, (label): label is string => isLabel(label, CRM_LIMITS.label)) &&
    isOneOf(CRM_TONES, value.tone)
  );
}

function isTag(value: unknown): value is CrmTag {
  return isDynamicRecord(value) && isIdentifier(value.id) && isLabel(value.label, CRM_LIMITS.tag);
}

function isPlan(value: unknown): value is CrmPlan {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isIdentifier(value.customerId) &&
    isLabel(value.name, CRM_LIMITS.label) &&
    isCrmAmount(value.amountMinor) &&
    isOneOf(CRM_EVERY, value.every) &&
    isCrmDate(value.startsOn) &&
    isNullable(value.endsOn, isCrmDate) &&
    isSourceKind(value.source)
  );
}

function isSourceKind(value: unknown): value is CrmSourceKind | null {
  return value === null || isOneOf(CRM_SOURCE_KINDS, value);
}

function isMoney(value: unknown): value is number {
  return isNumber(value) && Number.isSafeInteger(value) && value >= 0;
}

export function isCrmCustomer(value: unknown): value is CrmCustomer {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    integerInRange(value.number, 1, Number.MAX_SAFE_INTEGER) &&
    CRM_TEXT_FIELDS.every((field) => isText(field, value[field])) &&
    isIdentifier(value.statusId) &&
    isNullable(value.ownerAgentId, isIdentifier) &&
    isNullable(value.method, isMethod) &&
    isCrmCurrency(value.currency) &&
    isIdList(value.tagIds, CRM_LIMITS.customerTags) &&
    Array.isArray(value.plans) &&
    value.plans.length <= CRM_LIMITS.customerPlans &&
    value.plans.every(isPlan) &&
    isCrmTimestamp(value.createdAt) &&
    isCrmTimestamp(value.updatedAt) &&
    integerInRange(value.revision, 1, Number.MAX_SAFE_INTEGER) &&
    isMoney(value.paidMinor) &&
    isMoney(value.openMinor) &&
    isMoney(value.lateMinor) &&
    isNullable(value.nextDueOn, isCrmDate) &&
    isNullable(value.lastPaidAt, isCrmTimestamp) &&
    isSourceKind(value.source)
  );
}

export function isCrmPayment(value: unknown): value is CrmPayment {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    integerInRange(value.number, 1, Number.MAX_SAFE_INTEGER) &&
    isIdentifier(value.customerId) &&
    isNullable(value.planId, isIdentifier) &&
    isLabel(value.label, CRM_LIMITS.label) &&
    isCrmAmount(value.amountMinor) &&
    isCrmCurrency(value.currency) &&
    isCrmDate(value.dueOn) &&
    isNullable(value.paidAt, isCrmTimestamp) &&
    isNullable(value.method, isMethod) &&
    isSourceKind(value.source)
  );
}

function isDetailValue(value: unknown): value is string | number | null {
  return value === null || isBoundedString(value, CRM_LIMITS.notes) || (isNumber(value) && Number.isFinite(value));
}

export function isCrmActivity(value: unknown): value is CrmActivity {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isIdentifier(value.customerId) &&
    isDynamicRecord(value.actor) &&
    isOneOf(CRM_ACTOR_KINDS, value.actor.kind) &&
    isNullable(value.actor.id, isIdentifier) &&
    isNullable(value.actor.name, (name): name is string => isBoundedString(name, CRM_LIMITS.name)) &&
    isString(value.kind) &&
    /^[a-z][a-z0-9-]{0,47}$/u.test(value.kind) &&
    isDynamicRecord(value.details) &&
    Object.keys(value.details).length <= 16 &&
    Object.values(value.details).every(isDetailValue) &&
    isNullable(value.proposedBy, isIdentifier) &&
    isCrmTimestamp(value.createdAt)
  );
}

export function isCrmProposal(value: unknown): value is CrmProposal {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isIdentifier(value.agentId) &&
    isNullable(value.customerId, isIdentifier) &&
    isNullable(value.threadId, isIdentifier) &&
    isBoundedString(value.reason, CRM_LIMITS.reason) &&
    isCrmProposedChange(value.change) &&
    isCrmTimestamp(value.createdAt)
  );
}

function isSkipCount(value: unknown): boolean {
  return integerInRange(value, 0, Number.MAX_SAFE_INTEGER);
}

export function isCrmSource(value: unknown): value is CrmSource {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isOneOf(CRM_SOURCE_KINDS, value.kind) &&
    isBoolean(value.testMode) &&
    isBoundedString(value.accountLabel, CRM_LIMITS.name) &&
    isBoundedString(value.keyHint, 8) &&
    isOneOf(CRM_SOURCE_STATES, value.state) &&
    isNullable(value.errorCode, (code): code is CrmSourceError => isOneOf(CRM_SOURCE_ERRORS, code)) &&
    isNullable(value.syncedAt, isCrmTimestamp) &&
    isCrmTimestamp(value.connectedAt) &&
    isDynamicRecord(value.skipped) &&
    isSkipCount(value.skipped.currency) &&
    isSkipCount(value.skipped.interval) &&
    isSkipCount(value.skipped.limit)
  );
}

export function isCrmOverview(value: unknown): value is CrmOverview {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.statuses) &&
    value.statuses.length <= CRM_LIMITS.statuses &&
    value.statuses.every(isStatus) &&
    Array.isArray(value.tags) &&
    value.tags.length <= CRM_LIMITS.tags &&
    value.tags.every(isTag) &&
    Array.isArray(value.privateFields) &&
    value.privateFields.every((field) => isOneOf(CRM_PRIVATE_FIELDS, field)) &&
    isIdList(value.agentIds, CRM_LIMITS.agents) &&
    Array.isArray(value.proposals) &&
    value.proposals.length <= CRM_LIMITS.pendingProposals &&
    value.proposals.every(isCrmProposal) &&
    Array.isArray(value.sources) &&
    value.sources.length <= CRM_SOURCE_KINDS.length &&
    value.sources.every(isCrmSource)
  );
}

function isPage<T>(value: unknown, key: string, guard: (item: unknown) => item is T): boolean {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value[key]) &&
    value[key].length <= CRM_LIMITS.page &&
    value[key].every(guard)
  );
}

export function isCrmCustomerPage(value: unknown): value is CrmCustomerPage {
  return (
    isPage(value, "customers", isCrmCustomer) &&
    isDynamicRecord(value) &&
    isNullable(value.next, (next): next is number => integerInRange(next, 1, Number.MAX_SAFE_INTEGER))
  );
}

function isCursor(value: unknown): value is string {
  return isBoundedString(value, 128) && value.length > 0;
}

export function isCrmPaymentPage(value: unknown): value is CrmPaymentPage {
  return isPage(value, "payments", isCrmPayment) && isDynamicRecord(value) && isNullable(value.next, isCursor);
}

export function isCrmActivityPage(value: unknown): value is CrmActivityPage {
  return isPage(value, "activity", isCrmActivity) && isDynamicRecord(value) && isNullable(value.next, isCursor);
}

export function isCrmApplyResult(value: unknown): value is CrmApplyResult {
  if (!isDynamicRecord(value)) return false;
  return value.ok === true ? isNullable(value.id, isIdentifier) : value.ok === false && value.conflict === "revision";
}

// --- Requests ----------------------------------------------------------------------------------

export function isCrmCustomerPageInput(value: unknown): value is CrmCustomerPageInput {
  return (
    isDynamicRecord(value) &&
    hasOnly(value, ["after"]) &&
    (value.after === undefined || integerInRange(value.after, 1, Number.MAX_SAFE_INTEGER))
  );
}

export function isCrmPaymentPageInput(value: unknown): value is CrmPaymentPageInput {
  return (
    isDynamicRecord(value) &&
    hasOnly(value, ["state", "customerId", "after"]) &&
    isOneOf(CRM_PAYMENT_STATES, value.state) &&
    (value.customerId === undefined || isIdentifier(value.customerId)) &&
    (value.after === undefined || isCursor(value.after))
  );
}

export function isCrmActivityPageInput(value: unknown): value is CrmActivityPageInput {
  return (
    isDynamicRecord(value) &&
    hasOnly(value, ["customerId", "after"]) &&
    isIdentifier(value.customerId) &&
    (value.after === undefined || isCursor(value.after))
  );
}

/** A source key is at most 255 characters; the host checks its form and its permissions. */
export function isCrmSourceConnectInput(value: unknown): value is CrmSourceConnectInput {
  return (
    isDynamicRecord(value) &&
    hasOnly(value, ["kind", "key"]) &&
    isOneOf(CRM_SOURCE_KINDS, value.kind) &&
    isBoundedString(value.key, 255) &&
    value.key.length > 0
  );
}

export function isCrmSourceInput(value: unknown): value is CrmSourceInput {
  return isDynamicRecord(value) && hasOnly(value, ["sourceId"]) && isIdentifier(value.sourceId);
}

export function isCrmSettings(value: unknown): value is CrmSettings {
  return isDynamicRecord(value) && hasOnly(value, ["enabled"]) && isBoolean(value.enabled);
}
