import { CRM_TEXT_FIELDS, type CrmChange, type CrmCustomer } from "@openbot/contracts/ipc";

const CUSTOMER_EDIT_KEYS = [
  ...CRM_TEXT_FIELDS,
  "statusId",
  "ownerAgentId",
  "method",
  "currency",
  "tagIds",
] as const satisfies readonly (keyof CrmCustomer)[];

type CustomerEditKey = (typeof CUSTOMER_EDIT_KEYS)[number];

export interface CrmCustomerEdit {
  customerId: string;
  keys: readonly CustomerEditKey[];
  before: CrmCustomer;
  after: CrmCustomer;
}

function sameValue<T>(left: T, right: T): boolean {
  if (Array.isArray(left) && Array.isArray(right))
    return left.length === right.length && left.every((item, index) => item === right[index]);
  return left === right;
}

function sameTagSet(left: readonly string[], right: readonly string[]): boolean {
  const wanted = new Set(right);
  return new Set(left).size === wanted.size && left.every((tagId) => wanted.has(tagId));
}

function copyKey<K extends keyof CrmCustomer>(target: CrmCustomer, key: K, source: CrmCustomer): void {
  target[key] = source[key];
}

function restoreKey<K extends keyof CrmCustomer>(target: CrmCustomer, key: K, edit: CrmCustomerEdit): void {
  if (sameValue(target[key], edit.after[key])) target[key] = edit.before[key];
}

function editedCustomer(change: CrmChange, before: CrmCustomer): CrmCustomer | null {
  if (change.kind === "customer-update") return { ...before, ...change.patch };
  if (change.kind === "customer-tags" && !sameTagSet(before.tagIds, change.tagIds))
    return { ...before, tagIds: [...change.tagIds] };
  return null;
}

export function customerEdit(change: CrmChange, customers: readonly CrmCustomer[]): CrmCustomerEdit | null {
  if (change.kind !== "customer-update" && change.kind !== "customer-tags") return null;
  const found = customers.find((customer) => customer.id === change.customerId);
  if (found === undefined) return null;
  const before: CrmCustomer = { ...found, tagIds: [...found.tagIds] };
  const edited = editedCustomer(change, before);
  if (edited === null) return null;
  const keys = CUSTOMER_EDIT_KEYS.filter((key) => !sameValue(before[key], edited[key]));
  if (keys.length === 0) return null;
  return { customerId: before.id, keys, before, after: { ...edited, revision: before.revision + 1 } };
}

export function applyCustomerEdit(customer: CrmCustomer, edit: CrmCustomerEdit): void {
  if (customer.id !== edit.customerId || customer.revision !== edit.before.revision) return;
  for (const key of edit.keys) copyKey(customer, key, edit.after);
  customer.revision = edit.after.revision;
}

export function rollBackCustomerEdit(customer: CrmCustomer, edit: CrmCustomerEdit): void {
  for (const key of edit.keys) restoreKey(customer, key, edit);
  if (customer.revision === edit.after.revision) customer.revision = edit.before.revision;
}
