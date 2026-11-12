import {
  API_KEY_NAME_PATTERN,
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
export function vaultLoginTitle(login: Pick<VaultLoginSummary, "website">): string {
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

/**
 * The countries that the mobile contact form names. Each needs a catalog key in each language, so
 * the list is shorter than the desktop list (`VAULT_COUNTRY_CODES`).
 */
const MOBILE_COUNTRY_CODES = [
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
] as const satisfies readonly VaultCountryCode[];

type MobileCountryCode = (typeof MOBILE_COUNTRY_CODES)[number];

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
} as const satisfies Record<MobileCountryCode, MobileTextKey>;

/** Example values of an address, in the format of one country. */
export interface VaultAddressExample {
  address: string;
  city: string;
  region: string;
  postalCode: string;
  phone: string;
}

/**
 * The placeholders of the contact form: a real place in the format of the chosen country, so the
 * user sees how to write each value. An address is written the same in each app language.
 */
const ADDRESS_EXAMPLES = {
  AT: { address: "Stephansplatz 1", city: "Wien", region: "Wien", postalCode: "1010", phone: "+43 1 234 5678" },
  AU: { address: "1 Martin Place", city: "Sydney", region: "NSW", postalCode: "2000", phone: "+61 2 9876 5432" },
  BE: {
    address: "Rue de la Loi 16",
    city: "Bruxelles",
    region: "Bruxelles-Capitale",
    postalCode: "1000",
    phone: "+32 2 123 45 67",
  },
  CA: { address: "111 Wellington St", city: "Ottawa", region: "ON", postalCode: "K1A 0A9", phone: "+1 613 555 0100" },
  CH: { address: "Bahnhofstrasse 1", city: "Zürich", region: "ZH", postalCode: "8001", phone: "+41 44 123 45 67" },
  DE: { address: "Unter den Linden 1", city: "Berlin", region: "Berlin", postalCode: "10117", phone: "+49 30 1234567" },
  DK: {
    address: "Rådhuspladsen 1",
    city: "København",
    region: "Hovedstaden",
    postalCode: "1550",
    phone: "+45 12 34 56 78",
  },
  ES: { address: "Calle Mayor 1", city: "Madrid", region: "Madrid", postalCode: "28013", phone: "+34 912 345 678" },
  FR: {
    address: "1 rue de Rivoli",
    city: "Paris",
    region: "Île-de-France",
    postalCode: "75001",
    phone: "+33 1 23 45 67 89",
  },
  GB: {
    address: "221B Baker Street",
    city: "London",
    region: "Greater London",
    postalCode: "NW1 6XE",
    phone: "+44 20 7946 0000",
  },
  IE: {
    address: "1 O'Connell Street",
    city: "Dublin",
    region: "Dublin",
    postalCode: "D01 F5P2",
    phone: "+353 1 234 5678",
  },
  IT: { address: "Via del Corso 1", city: "Roma", region: "RM", postalCode: "00186", phone: "+39 06 1234 5678" },
  JP: { address: "1-1 Chiyoda", city: "Chiyoda-ku", region: "Tokyo", postalCode: "100-0001", phone: "+81 3 1234 5678" },
  NL: {
    address: "Damrak 1",
    city: "Amsterdam",
    region: "Noord-Holland",
    postalCode: "1012 LG",
    phone: "+31 20 123 4567",
  },
  PL: {
    address: "ul. Marszałkowska 1",
    city: "Warszawa",
    region: "mazowieckie",
    postalCode: "00-624",
    phone: "+48 22 123 45 67",
  },
  SE: {
    address: "Drottninggatan 1",
    city: "Stockholm",
    region: "Stockholms län",
    postalCode: "111 51",
    phone: "+46 8 123 456 78",
  },
  US: {
    address: "1 Market Street",
    city: "San Francisco",
    region: "CA",
    postalCode: "94105",
    phone: "+1 415 555 0100",
  },
} as const satisfies Record<MobileCountryCode, VaultAddressExample>;

/** The address placeholders for `country`. With no country, or one outside the list, a US address. */
export function vaultAddressExample(country: string): VaultAddressExample {
  const code = MOBILE_COUNTRY_CODES.find((candidate) => candidate === country.toUpperCase());
  return ADDRESS_EXAMPLES[code ?? "US"];
}

/**
 * The country choices of the contact form, sorted by name. A saved country outside the list, such
 * as one that an agent saved, stays a choice under its code.
 */
export function vaultCountryOptions(t: MobileText["t"], current: string): { value: string; label: string }[] {
  const countries = MOBILE_COUNTRY_CODES.map((code) => ({ value: code, label: t(COUNTRY_NAMES[code]) })).sort((a, b) =>
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
  /**
   * The two-step key of a login: null keeps the saved key, "" removes it, and other text is a new
   * setup key or `otpauth://totp/` link. The host never sends a saved key.
   */
  twoStepKey: string | null;
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
    twoStepKey: null,
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
        // Only a `vault-v3` host takes the field. The form sets it only for such a host.
        ...(draft.twoStepKey === null ? {} : { twoStepKey: draft.twoStepKey }),
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
