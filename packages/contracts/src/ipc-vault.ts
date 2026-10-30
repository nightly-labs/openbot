// The Vault of a server: logins, payment cards and contact info that every agent can fill into a
// page, and API keys that every agent reads from a file. A list answer never carries a password, a card
// number, a security code or an API key: the renderer gets one of them only from `vault:reveal`, when
// the user asks for it. A joined server answers through `vault-v2`, or `vault-v1` without API keys, to
// an owner or admin only.

import {
  decodeList,
  decodeRecord,
  nullableString,
  requiredBoolean,
  requiredNumber,
  requiredString,
} from "./ipc-decoding";
import { type DynamicRecord, isOneOf, isString } from "./runtime-values";

export type VaultItemKind = "login" | "card" | "contact" | "apiKey";

/** The name of the agent that added an item, as it was then. Absent when the user added it. */
export interface VaultItemOrigin {
  addedBy?: string;
}

export type VaultCardBrand = "visa" | "mastercard" | "amex" | "discover";

/** The brand of a card number, from its first digits. */
export function cardBrand(number: string): VaultCardBrand | null {
  if (/^4/u.test(number)) return "visa";
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/u.test(number)) return "mastercard";
  if (/^3[47]/u.test(number)) return "amex";
  if (/^(6011|65|64[4-9])/u.test(number)) return "discover";
  return null;
}

/** A value that the list never returns. */
export type VaultSecretField = "password" | "number" | "securityCode" | "key";

export interface VaultLoginSummary extends VaultItemOrigin {
  id: string;
  kind: "login";
  /** An `https:` address or a host name, as the user typed it. */
  website: string;
  username: string;
  notes: string;
  hasPassword: boolean;
}

export interface VaultCardSummary extends VaultItemOrigin {
  id: string;
  kind: "card";
  label: string;
  nameOnCard: string;
  brand: VaultCardBrand | null;
  last4: string;
  /** 1–12. */
  expMonth: number;
  /** Four digits. */
  expYear: number;
  billingContactId: string | null;
  /** The HTTPS page origins where the owner let agents fill this card with no approval. */
  fillSites: string[];
}

export interface VaultContactFields {
  label: string;
  fullName: string;
  address: string;
  address2: string;
  city: string;
  region: string;
  postalCode: string;
  /** An ISO 3166-1 alpha-2 code, or "" when not set. */
  country: string;
  phone: string;
  email: string;
}

export interface VaultContactSummary extends VaultContactFields, VaultItemOrigin {
  id: string;
  kind: "contact";
}

export interface VaultApiKeySummary extends VaultItemOrigin {
  id: string;
  kind: "apiKey";
  /** The environment variable that a program reads, such as `OPENAI_API_KEY`. Unique in the Vault. */
  name: string;
  notes: string;
  hasKey: boolean;
}

export type VaultItemSummary = VaultLoginSummary | VaultCardSummary | VaultContactSummary | VaultApiKeySummary;

/**
 * - `ready`: the items can be read and changed.
 * - `unavailable`: this computer has no secret storage (Linux without a keyring), so nothing can be saved.
 * - `unreadable`: the file is there but cannot be decrypted. It is kept until the user resets the Vault.
 */
export type VaultStatus = "ready" | "unavailable" | "unreadable";

export interface VaultState {
  status: VaultStatus;
  items: VaultItemSummary[];
}

/** A new item when `id` is null. A null secret keeps the saved value. */
export type VaultSaveInput =
  | {
      kind: "login";
      id: string | null;
      website: string;
      username: string;
      notes: string;
      password: string | null;
    }
  | {
      kind: "card";
      id: string | null;
      label: string;
      nameOnCard: string;
      expMonth: number;
      expYear: number;
      billingContactId: string | null;
      number: string | null;
      securityCode: string | null;
      /** The approved sites to keep. A site can only be removed here; omitted keeps them all. */
      fillSites?: string[] | undefined;
    }
  | ({ kind: "contact"; id: string | null } & VaultContactFields)
  | { kind: "apiKey"; id: string | null; name: string; notes: string; key: string | null };

export interface VaultSecretRequest {
  id: string;
  field: VaultSecretField;
}

/** Null when the user closed the file dialog. */
export type VaultImportResult = { imported: number; skipped: number; state: VaultState } | null;

export const EMPTY_VAULT: VaultState = { status: "ready", items: [] };

export const VAULT_TEXT_LIMIT = 512;
/** The approved sites that one card keeps. The oldest goes when a new one is approved. */
export const VAULT_FILL_SITE_LIMIT = 100;
export const VAULT_NOTES_LIMIT = 4096;
export const VAULT_PASSWORD_LIMIT = 1024;
export const VAULT_API_KEY_LIMIT = 8192;
/** An environment variable name, which is also the file name of an API key. */
export const API_KEY_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/u;

/** The countries that the Vault's contact form offers, as ISO 3166-1 alpha-2 codes. */
export const VAULT_COUNTRY_CODES = [
  "AT",
  "AU",
  "BE",
  "CA",
  "CH",
  "DE",
  "DK",
  "ES",
  "FR",
  "GB",
  "IE",
  "IT",
  "JP",
  "NL",
  "PL",
  "SE",
  "US",
] as const;

export type VaultCountryCode = (typeof VAULT_COUNTRY_CODES)[number];

/** The counts of a CSV import on a joined server (`vault-import-v1`), which opens no file dialog. */
export interface VaultHostImportResult {
  imported: number;
  skipped: number;
}

const VAULT_STATUSES: readonly VaultStatus[] = ["ready", "unavailable", "unreadable"];
const VAULT_CARD_BRANDS: readonly VaultCardBrand[] = ["visa", "mastercard", "amex", "discover"];
const VAULT_SECRET_KEYS = ["password", "number", "securityCode", "key"] as const;

function hostAddedBy(item: DynamicRecord): VaultItemOrigin {
  if (item.addedBy === undefined) return {};
  if (!isString(item.addedBy)) throw new Error("Invalid Vault response.");
  return { addedBy: item.addedBy };
}

function hostVaultItem(item: DynamicRecord): VaultItemSummary {
  if (VAULT_SECRET_KEYS.some((key) => key in item)) throw new Error("Invalid Vault response.");
  const id = requiredString(item, "id");
  switch (item.kind) {
    case "login":
      return {
        id,
        ...hostAddedBy(item),
        kind: "login",
        website: requiredString(item, "website"),
        username: requiredString(item, "username"),
        notes: requiredString(item, "notes"),
        hasPassword: requiredBoolean(item, "hasPassword"),
      };
    case "card": {
      const { brand, fillSites } = item;
      if (brand !== null && !isOneOf(VAULT_CARD_BRANDS, brand)) throw new Error("Invalid Vault response.");
      const last4 = requiredString(item, "last4");
      if (!/^\d{4}$/u.test(last4)) throw new Error("Invalid Vault response.");
      if (!Array.isArray(fillSites) || !fillSites.every(isString)) throw new Error("Invalid Vault response.");
      return {
        id,
        ...hostAddedBy(item),
        kind: "card",
        label: requiredString(item, "label"),
        nameOnCard: requiredString(item, "nameOnCard"),
        brand,
        last4,
        expMonth: requiredNumber(item, "expMonth"),
        expYear: requiredNumber(item, "expYear"),
        billingContactId: nullableString(item, "billingContactId"),
        fillSites: [...fillSites],
      };
    }
    case "contact":
      return {
        id,
        ...hostAddedBy(item),
        kind: "contact",
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
    case "apiKey":
      return {
        id,
        ...hostAddedBy(item),
        kind: "apiKey",
        name: requiredString(item, "name"),
        notes: requiredString(item, "notes"),
        hasKey: requiredBoolean(item, "hasKey"),
      };
    default:
      throw new Error("Invalid Vault response.");
  }
}

/** The Vault of a joined server (`vault-v2` or `vault-v1`). Throws for an item that carries a secret. */
export function decodeHostVaultState(value: unknown): VaultState {
  const state = decodeRecord(value, "Vault response");
  if (!isOneOf(VAULT_STATUSES, state.status)) throw new Error("Invalid Vault response.");
  return { status: state.status, items: decodeList(state.items, "Vault item", hostVaultItem) };
}

/** The counts that a joined server answers to a CSV import (`vault-import-v1`). */
export function decodeHostVaultImport(value: unknown): VaultHostImportResult {
  const answer = decodeRecord(value, "Vault import response");
  return { imported: requiredNumber(answer, "imported"), skipped: requiredNumber(answer, "skipped") };
}

/** The secret that a joined server answers to `reveal` (`vault-v2` or `vault-v1`). */
export function decodeHostVaultSecret(value: unknown): string {
  const answer = decodeRecord(value, "Vault response");
  return requiredString(answer, "value");
}
