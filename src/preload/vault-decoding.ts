// What main answers for the Vault in Server settings. A list item never carries a password, a card
// number, a security code or an API key: a summary that has one of those keys is refused, so a main-process bug
// cannot put a secret in renderer state. Only `reveal` answers with a secret.

import type {
  VaultCardBrand,
  VaultImportResult,
  VaultItemSummary,
  VaultState,
  VaultStatus,
} from "@openbot/contracts/ipc";
import {
  decodeList,
  decodeRecord,
  guardedListDecoder,
  nullableString,
  requiredBoolean,
  requiredNumber,
  requiredString,
} from "@openbot/contracts/ipc-decoding";
import { type DynamicRecord, isOneOf, isString } from "@openbot/contracts/runtime-values";

const STATUSES: readonly VaultStatus[] = ["ready", "unavailable", "unreadable"];
const BRANDS: readonly VaultCardBrand[] = ["visa", "mastercard", "amex", "discover"];
const SECRET_KEYS = ["password", "number", "securityCode", "key"] as const;
const decodeFillSites = guardedListDecoder(isString, "fillSites");

function contactFields(item: DynamicRecord) {
  return {
    label: requiredString(item, "label"),
    fullName: requiredString(item, "fullName"),
    address: requiredString(item, "address"),
    address2: requiredString(item, "address2"),
    city: requiredString(item, "city"),
    region: requiredString(item, "region"),
    postalCode: requiredString(item, "postalCode"),
    country: requiredString(item, "country"),
    phone: requiredString(item, "phone"),
    email: requiredString(item, "email"),
  };
}

function addedBy(item: DynamicRecord): { addedBy?: string } {
  if (item.addedBy === undefined) return {};
  if (!isString(item.addedBy)) throw new Error("Invalid addedBy.");
  return { addedBy: item.addedBy };
}

function vaultItem(item: DynamicRecord): VaultItemSummary {
  if (SECRET_KEYS.some((key) => key in item)) throw new Error("Invalid Vault item.");
  const id = requiredString(item, "id");
  switch (item.kind) {
    case "login":
      return {
        id,
        ...addedBy(item),
        kind: "login",
        website: requiredString(item, "website"),
        username: requiredString(item, "username"),
        notes: requiredString(item, "notes"),
        hasPassword: requiredBoolean(item, "hasPassword"),
      };
    case "card": {
      const brand = item.brand;
      if (brand !== null && !isOneOf(BRANDS, brand)) throw new Error("Invalid brand.");
      const last4 = requiredString(item, "last4");
      if (!/^\d{4}$/u.test(last4)) throw new Error("Invalid last4.");
      return {
        id,
        ...addedBy(item),
        kind: "card",
        label: requiredString(item, "label"),
        nameOnCard: requiredString(item, "nameOnCard"),
        brand,
        last4,
        expMonth: requiredNumber(item, "expMonth"),
        expYear: requiredNumber(item, "expYear"),
        billingContactId: nullableString(item, "billingContactId"),
        fillSites: decodeFillSites(item.fillSites),
      };
    }
    case "contact":
      return { id, ...addedBy(item), kind: "contact", ...contactFields(item) };
    case "apiKey":
      return {
        id,
        ...addedBy(item),
        kind: "apiKey",
        name: requiredString(item, "name"),
        notes: requiredString(item, "notes"),
        hasKey: requiredBoolean(item, "hasKey"),
      };
    default:
      throw new Error("Invalid Vault item kind.");
  }
}

export function decodeVaultState(value: unknown): VaultState {
  const state = decodeRecord(value, "Vault state");
  if (!isOneOf(STATUSES, state.status)) throw new Error("Invalid Vault status.");
  return { status: state.status, items: decodeList(state.items, "Vault item", vaultItem) };
}

export function decodeVaultImportResult(value: unknown): VaultImportResult {
  if (value === null) return null;
  const result = decodeRecord(value, "Vault import result");
  return {
    imported: requiredNumber(result, "imported"),
    skipped: requiredNumber(result, "skipped"),
    state: decodeVaultState(result.state),
  };
}

export function decodeVaultSecret(value: unknown): string {
  if (!isString(value)) throw new Error("Invalid Vault secret.");
  return value;
}
