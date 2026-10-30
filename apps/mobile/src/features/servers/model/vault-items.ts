import {
  API_KEY_NAME_PATTERN,
  VAULT_COUNTRY_CODES,
  type VaultCardSummary,
  type VaultContactFields,
  type VaultContactSummary,
  type VaultCountryCode,
  type VaultItemKind,
  type VaultItemSummary,
  type VaultLoginSummary,
  type VaultSaveInput,
} from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import type { MobileText } from "@/shared/lib/text";

/** The host name of a login's website, as the desktop Vault lists it. */
export function vaultLoginTitle(login: VaultLoginSummary): string {
  const website = login.website.trim();
  try {
    return new URL(website.includes("://") ? website : `https://${website}`).hostname || website;
  } catch {
    return website;
  }
}

export function vaultCardTitle(card: VaultCardSummary, t: MobileText["t"]): string {
  return card.label || card.nameOnCard || t("mobile.server.vault.cardEnding", { last4: card.last4 });
}

export function vaultContactTitle(contact: VaultContactSummary, t: MobileText["t"]): string {
  return (
    contact.label || contact.fullName || contact.email || contact.phone || t("mobile.server.vault.contactUntitled")
  );
}

const COUNTRY_NAMES = {
  AT: "mobile.server.vault.countryName.AT",
  AU: "mobile.server.vault.countryName.AU",
  BE: "mobile.server.vault.countryName.BE",
  CA: "mobile.server.vault.countryName.CA",
  CH: "mobile.server.vault.countryName.CH",
  DE: "mobile.server.vault.countryName.DE",
  DK: "mobile.server.vault.countryName.DK",
  ES: "mobile.server.vault.countryName.ES",
  FR: "mobile.server.vault.countryName.FR",
  GB: "mobile.server.vault.countryName.GB",
  IE: "mobile.server.vault.countryName.IE",
  IT: "mobile.server.vault.countryName.IT",
  JP: "mobile.server.vault.countryName.JP",
  NL: "mobile.server.vault.countryName.NL",
  PL: "mobile.server.vault.countryName.PL",
  SE: "mobile.server.vault.countryName.SE",
  US: "mobile.server.vault.countryName.US",
} as const satisfies Record<VaultCountryCode, MobileTextKey>;

/**
 * The country choices of the contact form, as the desktop form offers them, sorted by name. A saved
 * country outside the list, such as one that an agent saved, stays a choice under its code.
 */
export function vaultCountryOptions(t: MobileText["t"], current: string): { value: string; label: string }[] {
  const countries = VAULT_COUNTRY_CODES.map((code) => ({ value: code, label: t(COUNTRY_NAMES[code]) })).sort((a, b) =>
    a.label.localeCompare(b.label),
  );
  const saved =
    current && !countries.some((country) => country.value === current) ? [{ value: current, label: current }] : [];
  return [{ value: "", label: t("mobile.server.vault.countryNone") }, ...saved, ...countries];
}

/**
 * The text of the item form. A secret field starts empty: the host never sends a saved secret, so an
 * empty secret of a saved item keeps the saved one.
 */
export interface VaultDraft extends VaultContactFields {
  website: string;
  username: string;
  notes: string;
  password: string;
  nameOnCard: string;
  number: string;
  expMonth: string;
  expYear: string;
  securityCode: string;
  billingContactId: string;
  fillSites: string[];
  /** The environment variable name of an API key. */
  name: string;
  key: string;
}

const EMPTY_CONTACT: VaultContactFields = {
  label: "",
  fullName: "",
  address: "",
  address2: "",
  city: "",
  region: "",
  postalCode: "",
  country: "",
  phone: "",
  email: "",
};

export function vaultDraft(item: VaultItemSummary | undefined): VaultDraft {
  const draft: VaultDraft = {
    ...EMPTY_CONTACT,
    website: "",
    username: "",
    notes: "",
    password: "",
    nameOnCard: "",
    number: "",
    expMonth: "",
    expYear: "",
    securityCode: "",
    billingContactId: "",
    fillSites: [],
    name: "",
    key: "",
  };
  switch (item?.kind) {
    case "login":
      return { ...draft, website: item.website, username: item.username, notes: item.notes };
    case "card":
      return {
        ...draft,
        label: item.label,
        nameOnCard: item.nameOnCard,
        expMonth: String(item.expMonth),
        expYear: String(item.expYear),
        billingContactId: item.billingContactId ?? "",
        fillSites: [...item.fillSites],
      };
    case "contact": {
      const { id: _id, kind: _kind, addedBy: _addedBy, ...fields } = item;
      return { ...draft, ...fields };
    }
    case "apiKey":
      return { ...draft, name: item.name, notes: item.notes };
    default:
      return draft;
  }
}

/** A whole number from the text of a field, or null. */
function whole(value: string): number | null {
  return /^\d{1,4}$/u.test(value.trim()) ? Number(value.trim()) : null;
}

/**
 * The save input of `draft`, or null while a required field is empty. The host checks every value
 * again, with the rules of its own Vault page, and answers a wrong one with that page's sentence.
 */
export function vaultSaveInput(kind: VaultItemKind, id: string | null, draft: VaultDraft): VaultSaveInput | null {
  const secret = (value: string) => (value.length === 0 ? null : value);
  switch (kind) {
    case "login": {
      if (!draft.website.trim() || (id === null && !draft.password)) return null;
      return {
        kind,
        id,
        website: draft.website.trim(),
        username: draft.username.trim(),
        notes: draft.notes.trim(),
        password: secret(draft.password),
      };
    }
    case "card": {
      const expMonth = whole(draft.expMonth);
      const expYear = whole(draft.expYear);
      if (expMonth === null || expYear === null || (id === null && !draft.number.trim())) return null;
      return {
        kind,
        id,
        label: draft.label.trim(),
        nameOnCard: draft.nameOnCard.trim(),
        expMonth,
        expYear,
        billingContactId: draft.billingContactId || null,
        number: secret(draft.number.trim()),
        securityCode: secret(draft.securityCode.trim()),
        ...(id === null ? {} : { fillSites: draft.fillSites }),
      };
    }
    case "contact": {
      const fields: VaultContactFields = {
        label: draft.label.trim(),
        fullName: draft.fullName.trim(),
        address: draft.address.trim(),
        address2: draft.address2.trim(),
        city: draft.city.trim(),
        region: draft.region.trim(),
        postalCode: draft.postalCode.trim(),
        country: draft.country.trim().toUpperCase(),
        phone: draft.phone.trim(),
        email: draft.email.trim(),
      };
      if (!fields.fullName && !fields.address && !fields.phone && !fields.email) return null;
      return { kind, id, ...fields };
    }
    case "apiKey": {
      const name = draft.name.trim();
      if (!API_KEY_NAME_PATTERN.test(name) || (id === null && !draft.key.trim())) return null;
      return { kind, id, name, notes: draft.notes.trim(), key: secret(draft.key.trim()) };
    }
  }
}
