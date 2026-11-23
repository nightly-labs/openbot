import type {
  CrmActivity,
  CrmBuiltinStatusId,
  CrmChange,
  CrmCustomer,
  CrmEvery,
  CrmMethod,
  CrmPayment,
  CrmPlan,
  CrmSourceError,
  CrmSourceKind,
  CrmStatus,
  CrmTextField,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import type { AppFormat, AppMessages, AppTextKey, AppTranslate } from "@openbot/i18n";
import type { AgentProfile } from "../../data";

export type CrmAgent = Pick<AgentProfile, "id" | "name" | "avatarSeed" | "avatarHue" | "avatarColor" | "avatarUrl">;

export type CrmTab = "customers" | "payments";
export type CrmPayView = "upcoming" | "late" | "history" | "all";
export type CrmPayState = "paid" | "late" | "upcoming";
export type CrmFilterField = "status" | "payment" | "tags" | "method" | "plan" | "owner";

export const CRM_TABS = ["customers", "payments"] as const satisfies readonly CrmTab[];
export const CRM_PAY_VIEWS = ["upcoming", "late", "history", "all"] as const satisfies readonly CrmPayView[];
const FILTER_FIELDS = ["status", "payment", "tags", "method", "plan", "owner"] as const satisfies CrmFilterField[];

export interface CrmFilterRule {
  field: CrmFilterField;
  values: string[];
}

export interface SheetSort {
  column: string;
  descending: boolean;
}

export interface SheetState {
  sort: SheetSort | null;
  hidden: string[];
  order: string[];
  widths: Record<string, number>;
  find: Record<string, string>;
  range: Record<string, SheetRange>;
}

export interface SheetRange {
  min: number | null;
  max: number | null;
}

export interface CrmLayout {
  tab: CrmTab;
  pay: CrmPayView;
  customers: SheetState;
  payments: SheetState;
  filters: CrmFilterRule[];
}

export const COLUMN_MIN_WIDTH = 64;
export const COLUMN_MAX_WIDTH = 640;

export const PAY_SORT: Record<CrmPayView, SheetSort> = {
  upcoming: { column: "due", descending: false },
  late: { column: "due", descending: false },
  history: { column: "paidOn", descending: true },
  all: { column: "due", descending: true },
};

const DEFAULT_HIDDEN_CUSTOMER_COLUMNS = ["phone", "billingEmail", "taxId", "address", "stripeCustomerId", "notes"];

export function defaultCrmLayout(): CrmLayout {
  return {
    tab: "customers",
    pay: "upcoming",
    customers: {
      sort: { column: "next", descending: false },
      hidden: [...DEFAULT_HIDDEN_CUSTOMER_COLUMNS],
      order: [],
      widths: {},
      find: {},
      range: {},
    },
    payments: { sort: { ...PAY_SORT.upcoming }, hidden: [], order: [], widths: {}, find: {}, range: {} },
    filters: [],
  };
}

function record(value: unknown): DynamicRecord | null {
  return isDynamicRecord(value) ? value : null;
}

function strings(value: unknown, maximum: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length <= 200).slice(0, maximum);
}

function limit(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sheetState(value: unknown, fallback: SheetState): SheetState {
  const saved = record(value);
  if (!saved) return fallback;
  const sort = record(saved.sort);
  const widths = record(saved.widths) ?? {};
  return {
    sort:
      sort && typeof sort.column === "string" && typeof sort.descending === "boolean"
        ? { column: sort.column, descending: sort.descending }
        : saved.sort === null
          ? null
          : fallback.sort,
    hidden: strings(saved.hidden, 50),
    order: strings(saved.order, 50),
    widths: Object.fromEntries(
      Object.entries(widths)
        .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))
        .map(([id, width]) => [id, Math.min(COLUMN_MAX_WIDTH, Math.max(COLUMN_MIN_WIDTH, Math.round(width)))]),
    ),
    find: Object.fromEntries(
      Object.entries(record(saved.find) ?? {})
        .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim() !== "")
        .map(([id, text]) => [id, text.slice(0, 200)])
        .slice(0, 50),
    ),
    range: Object.fromEntries(
      Object.entries(record(saved.range) ?? {})
        .map(([id, item]): [string, SheetRange] => {
          const bounds = record(item);
          return [id, { min: limit(bounds?.min), max: limit(bounds?.max) }];
        })
        .filter(([, item]) => item.min !== null || item.max !== null)
        .slice(0, 50),
    ),
  };
}

export function readCrmLayout(value: unknown): CrmLayout {
  const fallback = defaultCrmLayout();
  const saved = record(value);
  if (!saved) return fallback;
  const tab = CRM_TABS.find((item) => item === saved.tab) ?? fallback.tab;
  const pay = CRM_PAY_VIEWS.find((item) => item === saved.pay) ?? fallback.pay;
  const filters = Array.isArray(saved.filters)
    ? saved.filters.flatMap((item): CrmFilterRule[] => {
        const rule = record(item);
        const field = FILTER_FIELDS.find((name) => name === rule?.field);
        const values = strings(rule?.values, 100);
        return field && values.length > 0 ? [{ field, values }] : [];
      })
    : [];
  return {
    tab,
    pay,
    customers: sheetState(saved.customers, fallback.customers),
    payments: sheetState(saved.payments, { ...fallback.payments, sort: { ...PAY_SORT[pay] } }),
    filters,
  };
}

export const STATUS_KEY = {
  lead: "crm.status.lead",
  customer: "crm.status.customer",
  former: "crm.status.former",
} as const satisfies Record<CrmBuiltinStatusId, AppTextKey>;

export const METHOD_KEY = {
  stripe: "crm.method.stripe",
  transfer: "crm.method.transfer",
  crypto: "crm.method.crypto",
  paypal: "crm.method.paypal",
  cash: "crm.method.cash",
} as const satisfies Record<CrmMethod, AppTextKey>;

export const SOURCE_KEY = { stripe: "crm.method.stripe" } as const satisfies Record<CrmSourceKind, AppTextKey>;

export const SOURCE_KEY_PAGE = {
  stripe:
    "https://dashboard.stripe.com/apikeys/create?name=OpenBot&permissions%5B%5D=rak_customer_read&permissions%5B%5D=rak_invoice_read&permissions%5B%5D=rak_subscription_read&permissions%5B%5D=rak_product_read&permissions%5B%5D=rak_plan_read",
} as const satisfies Record<CrmSourceKind, string>;

export const SOURCE_ERROR_KEY = {
  "invalid-key": "crm.source.errorInvalidKey",
  permission: "crm.source.errorPermission",
  "rate-limited": "crm.source.errorRateLimited",
  network: "crm.source.errorNetwork",
  stripe: "crm.source.errorFailed",
} as const satisfies Record<CrmSourceError, keyof AppMessages>;

export const EVERY_KEY = {
  month: "crm.every.month",
  quarter: "crm.every.quarter",
  year: "crm.every.year",
  once: "crm.every.once",
} as const satisfies Record<CrmEvery, AppTextKey>;

export const PRICE_KEY = {
  month: "crm.price.month",
  quarter: "crm.price.quarter",
  year: "crm.price.year",
  once: "crm.price.once",
} as const satisfies Record<CrmEvery, keyof AppMessages>;

export const FIELD_KEY = {
  name: "crm.field.name",
  contactName: "crm.field.contactName",
  contactEmail: "crm.field.contactEmail",
  phone: "crm.field.phone",
  billingEmail: "crm.field.billingEmail",
  domain: "crm.field.domain",
  taxId: "crm.field.taxId",
  address: "crm.field.address",
  stripeCustomerId: "crm.field.stripeCustomerId",
  notes: "crm.field.notes",
} as const satisfies Record<CrmTextField, AppTextKey>;

export const PAY_VIEW_KEY = {
  upcoming: "crm.payments.view.upcoming",
  late: "crm.payments.view.late",
  history: "crm.payments.view.history",
  all: "crm.payments.view.all",
} as const satisfies Record<CrmPayView, AppTextKey>;

export const PAY_STATE_KEY = {
  paid: "crm.payment.state.paid",
  late: "crm.payment.state.late",
  upcoming: "crm.payment.state.upcoming",
} as const satisfies Record<CrmPayState, AppTextKey>;

export function payVariant(state: CrmPayState) {
  if (state === "paid") return "success-light" as const;
  if (state === "late") return "destructive-light" as const;
  return "info-light" as const;
}

function isBuiltinStatus(id: string): id is CrmBuiltinStatusId {
  return id === "lead" || id === "customer" || id === "former";
}

export function statusLabel(t: AppTranslate, status: CrmStatus | undefined, id: string): string {
  if (status?.label) return status.label;
  return isBuiltinStatus(id) ? t(STATUS_KEY[id]) : id;
}

export function matches(query: string, ...values: (string | null | undefined)[]): boolean {
  const needle = query.trim().toLowerCase();
  return needle === "" || values.some((value) => value?.toLowerCase().includes(needle));
}

export function parseNumber(text: string): number | null {
  const plain = text.replace(/[\s\u00a0\u202f'_]/gu, "");
  const at = Math.max(plain.lastIndexOf(","), plain.lastIndexOf("."));
  let digits = plain;
  if (at !== -1) {
    const mark = plain.charAt(at);
    const other = mark === "," ? "." : ",";
    const grouping = !plain.includes(other) && (plain.indexOf(mark) !== at || plain.length - at - 1 === 3);
    digits = grouping
      ? plain.replaceAll(mark, "")
      : `${plain.slice(0, at).replaceAll(other, "").replaceAll(mark, "")}.${plain.slice(at + 1)}`;
  }
  if (!/^-?(\d+(\.\d*)?|\.\d+)$/u.test(digits)) return null;
  return Number(digits);
}

const DAY = 86_400_000;

function pad(part: number): string {
  return String(part).padStart(2, "0");
}

export function isoDate(at: Date): string {
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

export function todayIso(): string {
  return isoDate(new Date());
}

export function localDateOf(timestamp: string): string {
  return isoDate(new Date(timestamp));
}

function dayNumber(iso: string): number {
  const [year = 1970, month = 1, day = 1] = iso.split("-").map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / DAY);
}

export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

export function addDays(iso: string, days: number): string {
  const [year = 1970, month = 1, day = 1] = iso.split("-").map(Number);
  return isoDate(new Date(year, month - 1, day + days, 12));
}

export function dateOf(iso: string): Date {
  const [year = 1970, month = 1, day = 1] = iso.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

export function formatDay(format: AppFormat, iso: string): string {
  return format.date(dateOf(iso), { day: "numeric", month: "short" });
}

const relativeFormats = new Map<string, Intl.RelativeTimeFormat>();

export function timeAgo(locale: string, timestamp: string, now = Date.now()): string {
  let relative = relativeFormats.get(locale);
  if (!relative) {
    relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
    relativeFormats.set(locale, relative);
  }
  const minutes = Math.round((Date.parse(timestamp) - now) / 60_000);
  if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relative.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return relative.format(days, "day");
  return relative.format(Math.round(days / 30), "month");
}

export function formatDayWithYear(format: AppFormat, iso: string): string {
  return format.date(dateOf(iso), { day: "numeric", month: "short", year: "numeric" });
}

export function payState(payment: CrmPayment, today: string): CrmPayState {
  if (payment.paidAt !== null) return "paid";
  return daysBetween(today, payment.dueOn) < 0 ? "late" : "upcoming";
}

export function daysLate(payment: CrmPayment, today: string): number {
  const end = payment.paidAt === null ? today : localDateOf(payment.paidAt);
  return Math.max(0, daysBetween(payment.dueOn, end));
}

export function inPayView(payment: CrmPayment, view: CrmPayView, today: string): boolean {
  if (view === "all") return true;
  if (view === "history") return payment.paidAt !== null;
  return payState(payment, today) === view;
}

const fractionCache = new Map<string, number>();

export function fractionDigits(currency: string): number {
  const cached = fractionCache.get(currency);
  if (cached !== undefined) return cached;
  let digits = 2;
  try {
    digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    digits = 2;
  }
  fractionCache.set(currency, digits);
  return digits;
}

export function majorUnits(minor: number, currency: string): number {
  return minor / 10 ** fractionDigits(currency);
}

export function formatMoney(format: AppFormat, minor: number, currency: string): string {
  const digits = fractionDigits(currency);
  try {
    return format.number(minor / 10 ** digits, { style: "currency", currency });
  } catch {
    return `${format.number(minor / 10 ** digits)} ${currency}`;
  }
}

export function moneyInput(minor: number, currency: string): string {
  const digits = fractionDigits(currency);
  return (minor / 10 ** digits).toFixed(digits);
}

const AMOUNT_MAX = 1_000_000_000_000;

export function parseMoney(text: string, currency: string): number | null {
  const clean = text.trim().replace(/\s/gu, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/u.test(clean)) return null;
  const digits = fractionDigits(currency);
  const [whole = "0", fraction = ""] = clean.split(".");
  if (fraction.length > digits) return null;
  const minor = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, "0") || "0");
  return Number.isSafeInteger(minor) && minor <= AMOUNT_MAX ? minor : null;
}

export interface CurrencyTotal {
  currency: string;
  minor: number;
}

export function totalsByCurrency<R>(
  rows: readonly R[],
  amount: (row: R) => number,
  currency: (row: R) => string,
): CurrencyTotal[] {
  const sums = new Map<string, number>();
  for (const row of rows) {
    const value = amount(row);
    if (value === 0) continue;
    sums.set(currency(row), (sums.get(currency(row)) ?? 0) + value);
  }
  return [...sums.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([code, minor]) => ({ currency: code, minor }));
}

export function formatTotals(format: AppFormat, totals: readonly CurrencyTotal[]): string[] {
  return totals.map((total) => formatMoney(format, total.minor, total.currency));
}

export const CRM_CURRENCIES = ["EUR", "USD", "GBP", "PLN", "CHF", "BRL", "CAD", "AUD", "JPY"] as const;

export interface CustomerSummary {
  late: CrmPayment[];
  upcoming: CrmPayment[];
  paid: CrmPayment[];
  next: CrmPayment | undefined;
  last: CrmPayment | undefined;
  paidLate: number;
}

export function customerSummary(payments: readonly CrmPayment[], today: string): CustomerSummary {
  const late = payments
    .filter((item) => payState(item, today) === "late")
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  const upcoming = payments
    .filter((item) => payState(item, today) === "upcoming")
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  const paid = payments
    .filter((item) => item.paidAt !== null)
    .sort((a, b) => (b.paidAt ?? "").localeCompare(a.paidAt ?? ""));
  return {
    late,
    upcoming,
    paid,
    next: upcoming[0] ?? late[0],
    last: paid[0],
    paidLate: paid.filter((item) => daysLate(item, today) > 0).length,
  };
}

export function dueThisWeek(summary: CustomerSummary, today: string): boolean {
  const next = summary.upcoming[0];
  return next !== undefined && daysBetween(today, next.dueOn) <= 7;
}

export function monthlyMinor(plan: CrmPlan): number {
  if (plan.every === "month") return plan.amountMinor;
  if (plan.every === "quarter") return Math.round(plan.amountMinor / 3);
  if (plan.every === "year") return Math.round(plan.amountMinor / 12);
  return 0;
}

export function activePlans(customer: CrmCustomer, today: string) {
  return customer.plans.filter((plan) => plan.endsOn === null || daysBetween(today, plan.endsOn) >= 0);
}

export function changeCustomerId(change: CrmChange): string | null {
  switch (change.kind) {
    case "customer-update":
    case "customer-tags":
    case "customer-delete":
      return change.customerId;
    case "plan-create":
      return change.plan.customerId;
    case "payment-create":
      return change.payment.customerId;
    default:
      return null;
  }
}

export function detailText(activity: CrmActivity, key: string): string {
  const value = activity.details[key];
  return value === null || value === undefined ? "" : String(value);
}
