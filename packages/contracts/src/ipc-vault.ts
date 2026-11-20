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

export interface VaultItemOrigin {
  addedBy?: string;
}

export interface VaultItemScope {
  agents?: string[];
}

export interface VaultSaveScope {
  agents?: string[] | null | undefined;
}

export const VAULT_AGENT_SCOPE_LIMIT = 1_000;
export const VAULT_AGENT_ID_LIMIT = 128;

export function vaultItemAllows(item: { readonly agents?: readonly string[] | undefined }, agentId: string): boolean {
  return item.agents === undefined || item.agents.includes(agentId);
}

export type VaultCardBrand = "visa" | "mastercard" | "amex" | "discover";
export const VAULT_CARD_BRANDS: readonly VaultCardBrand[] = ["visa", "mastercard", "amex", "discover"];

export function vaultExpiryText(month: number, year: number): string {
  return `${String(month).padStart(2, "0")}/${String(year % 100).padStart(2, "0")}`;
}

export function cardBrand(number: string): VaultCardBrand | null {
  if (/^4/u.test(number)) return "visa";
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/u.test(number)) return "mastercard";
  if (/^3[47]/u.test(number)) return "amex";
  if (/^(6011|65|64[4-9])/u.test(number)) return "discover";
  return null;
}

export type VaultSecretField = "password" | "number" | "securityCode" | "key";

export interface VaultLoginSummary extends VaultItemOrigin, VaultItemScope {
  id: string;
  kind: "login";
  website: string;
  username: string;
  notes: string;
  hasPassword: boolean;
  hasTwoStep: boolean;
}

export interface VaultCardSummary extends VaultItemOrigin, VaultItemScope {
  id: string;
  kind: "card";
  label: string;
  nameOnCard: string;
  brand: VaultCardBrand | null;
  last4: string;
  expMonth: number;
  expYear: number;
  billingContactId: string | null;
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
  country: string;
  phone: string;
  email: string;
}

export interface VaultContactSummary extends VaultContactFields, VaultItemOrigin, VaultItemScope {
  id: string;
  kind: "contact";
}

export interface VaultApiKeySummary extends VaultItemOrigin, VaultItemScope {
  id: string;
  kind: "apiKey";
  name: string;
  notes: string;
  hasKey: boolean;
}

export type VaultItemSummary = VaultLoginSummary | VaultCardSummary | VaultContactSummary | VaultApiKeySummary;

export type VaultStatus = "ready" | "unavailable" | "unreadable";

export interface VaultState {
  status: VaultStatus;
  items: VaultItemSummary[];
  agentScope?: boolean;
}

export type VaultSaveInput = (
  | {
      kind: "login";
      id: string | null;
      website: string;
      username: string;
      notes: string;
      password: string | null;
      twoStepKey?: string | undefined;
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
      fillSites?: string[] | undefined;
    }
  | ({ kind: "contact"; id: string | null } & VaultContactFields)
  | { kind: "apiKey"; id: string | null; name: string; notes: string; key: string | null }
) &
  VaultSaveScope;

export interface VaultSecretRequest {
  id: string;
  field: VaultSecretField;
}

export interface VaultTwoStepCodes {
  codes: VaultTwoStepCode[];
}

export interface VaultTwoStepCode {
  id: string;
  code: string;
  period: number;
  remainingMs: number;
}

export type VaultImportResult = { imported: number; skipped: number; state: VaultState } | null;

export const EMPTY_VAULT: VaultState = { status: "ready", items: [] };

export const VAULT_TEXT_LIMIT = 512;
export const VAULT_FILL_SITE_LIMIT = 100;
export const VAULT_NOTES_LIMIT = 4096;
export const VAULT_PASSWORD_LIMIT = 1024;
export const VAULT_API_KEY_LIMIT = 8192;
export const API_KEY_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/u;

export const VAULT_COUNTRY_CODES = [
  "AD",
  "AE",
  "AF",
  "AG",
  "AI",
  "AL",
  "AM",
  "AO",
  "AQ",
  "AR",
  "AS",
  "AT",
  "AU",
  "AW",
  "AX",
  "AZ",
  "BA",
  "BB",
  "BD",
  "BE",
  "BF",
  "BG",
  "BH",
  "BI",
  "BJ",
  "BL",
  "BM",
  "BN",
  "BO",
  "BQ",
  "BR",
  "BS",
  "BT",
  "BV",
  "BW",
  "BY",
  "BZ",
  "CA",
  "CC",
  "CD",
  "CF",
  "CG",
  "CH",
  "CI",
  "CK",
  "CL",
  "CM",
  "CN",
  "CO",
  "CR",
  "CU",
  "CV",
  "CW",
  "CX",
  "CY",
  "CZ",
  "DE",
  "DJ",
  "DK",
  "DM",
  "DO",
  "DZ",
  "EC",
  "EE",
  "EG",
  "EH",
  "ER",
  "ES",
  "ET",
  "FI",
  "FJ",
  "FK",
  "FM",
  "FO",
  "FR",
  "GA",
  "GB",
  "GD",
  "GE",
  "GF",
  "GG",
  "GH",
  "GI",
  "GL",
  "GM",
  "GN",
  "GP",
  "GQ",
  "GR",
  "GS",
  "GT",
  "GU",
  "GW",
  "GY",
  "HK",
  "HM",
  "HN",
  "HR",
  "HT",
  "HU",
  "ID",
  "IE",
  "IL",
  "IM",
  "IN",
  "IO",
  "IQ",
  "IR",
  "IS",
  "IT",
  "JE",
  "JM",
  "JO",
  "JP",
  "KE",
  "KG",
  "KH",
  "KI",
  "KM",
  "KN",
  "KP",
  "KR",
  "KW",
  "KY",
  "KZ",
  "LA",
  "LB",
  "LC",
  "LI",
  "LK",
  "LR",
  "LS",
  "LT",
  "LU",
  "LV",
  "LY",
  "MA",
  "MC",
  "MD",
  "ME",
  "MF",
  "MG",
  "MH",
  "MK",
  "ML",
  "MM",
  "MN",
  "MO",
  "MP",
  "MQ",
  "MR",
  "MS",
  "MT",
  "MU",
  "MV",
  "MW",
  "MX",
  "MY",
  "MZ",
  "NA",
  "NC",
  "NE",
  "NF",
  "NG",
  "NI",
  "NL",
  "NO",
  "NP",
  "NR",
  "NU",
  "NZ",
  "OM",
  "PA",
  "PE",
  "PF",
  "PG",
  "PH",
  "PK",
  "PL",
  "PM",
  "PN",
  "PR",
  "PS",
  "PT",
  "PW",
  "PY",
  "QA",
  "RE",
  "RO",
  "RS",
  "RU",
  "RW",
  "SA",
  "SB",
  "SC",
  "SD",
  "SE",
  "SG",
  "SH",
  "SI",
  "SJ",
  "SK",
  "SL",
  "SM",
  "SN",
  "SO",
  "SR",
  "SS",
  "ST",
  "SV",
  "SX",
  "SY",
  "SZ",
  "TC",
  "TD",
  "TF",
  "TG",
  "TH",
  "TJ",
  "TK",
  "TL",
  "TM",
  "TN",
  "TO",
  "TR",
  "TT",
  "TV",
  "TW",
  "TZ",
  "UA",
  "UG",
  "UM",
  "US",
  "UY",
  "UZ",
  "VA",
  "VC",
  "VE",
  "VG",
  "VI",
  "VN",
  "VU",
  "WF",
  "WS",
  "YE",
  "YT",
  "ZA",
  "ZM",
  "ZW",
] as const;

export type VaultCountryCode = (typeof VAULT_COUNTRY_CODES)[number];

export interface VaultHostImportResult {
  imported: number;
  skipped: number;
}

const VAULT_STATUSES: readonly VaultStatus[] = ["ready", "unavailable", "unreadable"];
const VAULT_SECRET_KEYS = ["password", "number", "securityCode", "key", "twoStepKey"] as const;

function hostAddedBy(item: DynamicRecord): VaultItemOrigin {
  if (item.addedBy === undefined) return {};
  if (!isString(item.addedBy)) throw new Error("Invalid Vault response.");
  return { addedBy: item.addedBy };
}

function hostScope(item: DynamicRecord): VaultItemScope {
  if (item.agents === undefined) return {};
  const { agents } = item;
  if (!Array.isArray(agents) || agents.length > VAULT_AGENT_SCOPE_LIMIT || !agents.every(isString))
    throw new Error("Invalid Vault response.");
  return { agents: [...agents] };
}

function hostVaultItem(item: DynamicRecord): VaultItemSummary {
  return { ...hostVaultItemFields(item), ...hostScope(item) };
}

function hostVaultItemFields(item: DynamicRecord): VaultItemSummary {
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
        hasTwoStep: item.hasTwoStep === undefined ? false : requiredBoolean(item, "hasTwoStep"),
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

export function decodeHostVaultState(value: unknown, agentScope = false): VaultState {
  const state = decodeRecord(value, "Vault response");
  if (!isOneOf(VAULT_STATUSES, state.status)) throw new Error("Invalid Vault response.");
  return {
    status: state.status,
    items: decodeList(state.items, "Vault item", hostVaultItem),
    ...(agentScope ? { agentScope: true } : {}),
  };
}

export function decodeHostVaultImport(value: unknown): VaultHostImportResult {
  const answer = decodeRecord(value, "Vault import response");
  return { imported: requiredNumber(answer, "imported"), skipped: requiredNumber(answer, "skipped") };
}

function hostTwoStepCode(item: DynamicRecord): VaultTwoStepCode {
  const code = requiredString(item, "code");
  if (!/^\d{6,8}$/u.test(code)) throw new Error("Invalid Vault response.");
  return {
    id: requiredString(item, "id"),
    code,
    period: requiredNumber(item, "period"),
    remainingMs: requiredNumber(item, "remainingMs"),
  };
}

export function decodeHostVaultCodes(value: unknown): VaultTwoStepCodes {
  const answer = decodeRecord(value, "Vault response");
  return { codes: decodeList(answer.codes, "Vault code", hostTwoStepCode) };
}

export function decodeHostVaultSecret(value: unknown): string {
  const answer = decodeRecord(value, "Vault response");
  return requiredString(answer, "value");
}
