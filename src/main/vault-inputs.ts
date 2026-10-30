// Decodes what the settings page sends to the Vault. A malformed payload is refused with a plain
// message; a value that the user typed wrong is refused with text that the page shows.

import {
  API_KEY_NAME_PATTERN,
  VAULT_API_KEY_LIMIT,
  VAULT_FILL_SITE_LIMIT,
  VAULT_NOTES_LIMIT,
  VAULT_PASSWORD_LIMIT,
  VAULT_TEXT_LIMIT,
  type VaultContactFields,
  type VaultSaveInput,
  type VaultSecretField,
  type VaultSecretRequest,
} from "@openbot/contracts/ipc";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { type SourceMessages, sourceText } from "@openbot/i18n/source";
import { websiteUrl } from "../backend/password-vault";
import { isObject } from "./ipc/validation";

const SECRET_FIELDS: readonly VaultSecretField[] = ["password", "number", "securityCode", "key"];

function isSecretField(value: unknown): value is VaultSecretField {
  return SECRET_FIELDS.some((field) => field === value);
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function userError(key: Extract<keyof SourceMessages, `error.vault.${string}`>): Error {
  return new Error(sourceText(key));
}

function rawText(value: unknown, field: string, limit: number): string {
  if (typeof value !== "string") throw new Error(`${field} must be a string.`);
  if (value.length > limit) throw userError("error.vault.valueTooLong");
  return value;
}

function text(value: unknown, field: string, limit = VAULT_TEXT_LIMIT): string {
  return rawText(value, field, limit).trim();
}

function nullableText(value: unknown, field: string, limit: number): string | null {
  return value === null ? null : text(value, field, limit);
}

function id(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !value || value.length > 64) throw new Error("id is invalid.");
  return value;
}

/** An `https:` address or a bare host name. Any other scheme is refused, so a login never fills on `http:`. */
export function vaultWebsite(value: string): string | null {
  const trimmed = value.trim();
  const url = websiteUrl(trimmed);
  if (url?.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
  return trimmed;
}

/** Digits only, with spaces and dashes removed, or null when the number fails the Luhn check. */
function cardNumber(value: string): string | null {
  const digits = value.replace(/[\s-]/gu, "");
  if (!/^\d{12,19}$/u.test(digits)) return null;
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    let digit = Number(digits[digits.length - 1 - index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0 ? digits : null;
}

function expiry(month: unknown, year: unknown): { expMonth: number; expYear: number } {
  if (!isInteger(month) || !isInteger(year) || month < 1 || month > 12 || year < 2000 || year > 2099)
    throw userError("error.vault.expiryInvalid");
  return { expMonth: month, expYear: year };
}

function contactFields(value: DynamicRecord): VaultContactFields {
  const fields: VaultContactFields = {
    label: text(value.label, "label"),
    fullName: text(value.fullName, "fullName"),
    address: text(value.address, "address"),
    address2: text(value.address2, "address2"),
    city: text(value.city, "city"),
    region: text(value.region, "region"),
    postalCode: text(value.postalCode, "postalCode"),
    country: text(value.country, "country").toUpperCase(),
    phone: text(value.phone, "phone"),
    email: text(value.email, "email"),
  };
  if (fields.country && !/^[A-Z]{2}$/u.test(fields.country)) throw new Error("country is invalid.");
  if (!fields.fullName && !fields.address && !fields.phone && !fields.email)
    throw userError("error.vault.contactEmpty");
  return fields;
}

/** The approved sites that a card keeps. The service keeps only those that it saved itself. */
function siteList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > VAULT_FILL_SITE_LIMIT) throw new Error("fillSites is invalid.");
  return value.map((site) => rawText(site, "fillSites", VAULT_TEXT_LIMIT));
}

/**
 * The item to save. A login's website must be HTTPS; a card number must pass the Luhn check, and its
 * security code has 3 or 4 digits. An API key's name is an environment variable name. A null secret
 * keeps the saved value.
 */
export function decodeVaultSaveInput(value: unknown): VaultSaveInput {
  if (!isObject(value)) throw new Error("Invalid Vault item.");
  const itemId = id(value.id);
  switch (value.kind) {
    case "login": {
      const website = vaultWebsite(text(value.website, "website"));
      if (!website) throw userError("error.vault.websiteInvalid");
      // A password keeps its spaces; only an empty one is refused.
      const password = value.password === null ? null : rawText(value.password, "password", VAULT_PASSWORD_LIMIT);
      if (password !== null && !password.trim()) throw userError("error.vault.passwordRequired");
      return {
        kind: "login",
        id: itemId,
        website,
        username: text(value.username, "username"),
        notes: text(value.notes, "notes", VAULT_NOTES_LIMIT),
        password,
      };
    }
    case "card": {
      const rawNumber = nullableText(value.number, "number", 32);
      const number = rawNumber === null ? null : cardNumber(rawNumber);
      if (rawNumber !== null && number === null) throw userError("error.vault.cardNumberInvalid");
      const securityCode = nullableText(value.securityCode, "securityCode", 8);
      if (securityCode && !/^\d{3,4}$/u.test(securityCode)) throw userError("error.vault.securityCodeInvalid");
      const billingContactId = value.billingContactId === null ? null : id(value.billingContactId);
      const fillSites = value.fillSites === undefined ? undefined : siteList(value.fillSites);
      return {
        kind: "card",
        id: itemId,
        label: text(value.label, "label"),
        nameOnCard: text(value.nameOnCard, "nameOnCard"),
        ...expiry(value.expMonth, value.expYear),
        billingContactId,
        number,
        securityCode,
        ...(fillSites === undefined ? {} : { fillSites }),
      };
    }
    case "contact":
      return { kind: "contact", id: itemId, ...contactFields(value) };
    case "apiKey": {
      const name = text(value.name, "name");
      if (!API_KEY_NAME_PATTERN.test(name)) throw userError("error.vault.apiKeyNameInvalid");
      // The ends are trimmed: a program reads the whole file, and a pasted key often has a line break.
      const key = nullableText(value.key, "key", VAULT_API_KEY_LIMIT);
      if (key === "") throw userError("error.vault.apiKeyRequired");
      return { kind: "apiKey", id: itemId, name, notes: text(value.notes, "notes", VAULT_NOTES_LIMIT), key };
    }
    default:
      throw new Error("Invalid Vault item kind.");
  }
}

export function decodeVaultSecretRequest(value: unknown): VaultSecretRequest {
  if (!isObject(value)) throw new Error("Invalid Vault secret request.");
  const itemId = id(value.id);
  if (itemId === null) throw new Error("id is invalid.");
  if (!isSecretField(value.field)) throw new Error("field is invalid.");
  return { id: itemId, field: value.field };
}
