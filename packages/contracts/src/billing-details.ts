import { isDynamicRecord, isString } from "./runtime-values";

/**
 * The billing country and the EU VAT ID of an account. The account server keeps them on the Stripe customer.
 * They decide the VAT of each new plan or license: the seller is in Poland and is not in the EU One Stop
 * Shop, so a buyer pays Polish VAT, a company with a VAT ID of another EU country pays no VAT (reverse
 * charge), and a buyer outside the EU pays no VAT. `country` is null until the account gives one.
 */
export interface BillingDetails {
  country: string | null;
  vatId: string | null;
  /**
   * Only while no country is saved: the country of the request's IP address (the Cloudflare `CF-IPCountry`
   * header). The form shows it as the first value, and the buyer can change it. The account server saves only
   * the country that the buyer sends.
   */
  suggestedCountry?: string;
}

/** A change of the billing details. A VAT ID is only for a country in the EU. */
export interface BillingDetailsRequest {
  country: string;
  vatId?: string;
}

/** The ISO 3166-1 alpha-2 countries that Stripe takes in an address. The UI names them in the user's language. */
export const BILLING_COUNTRIES: readonly string[] = [
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
  "CV",
  "CW",
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
  "MK",
  "ML",
  "MM",
  "MN",
  "MO",
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
  "SZ",
  "TA",
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
  "US",
  "UY",
  "UZ",
  "VA",
  "VC",
  "VE",
  "VG",
  "VN",
  "VU",
  "WF",
  "WS",
  "XK",
  "YE",
  "YT",
  "ZA",
  "ZM",
  "ZW",
];

/** The 27 EU member states. VAT applies only to a buyer in one of them. */
export const EU_VAT_COUNTRIES: readonly string[] = [
  "AT",
  "BE",
  "BG",
  "CY",
  "CZ",
  "DE",
  "DK",
  "EE",
  "ES",
  "FI",
  "FR",
  "GR",
  "HR",
  "HU",
  "IE",
  "IT",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SE",
  "SI",
  "SK",
];

/** The country of the seller. A buyer in this country pays VAT also with a VAT ID. */
export const VAT_SELLER_COUNTRY = "PL";

/**
 * The Stripe Tax Rate of the seller's VAT, which a buyer that pays VAT pays on top of the Price. The account
 * server finds the active rate by this metadata; `scripts/stripe-bootstrap.ts` makes it.
 */
export const VAT_TAX_RATE = { metadataKey: "openbot_vat", metadataValue: "pl_standard", percentage: 23 } as const;

const BILLING_COUNTRY_SET = new Set(BILLING_COUNTRIES);
const EU_VAT_COUNTRY_SET = new Set(EU_VAT_COUNTRIES);
/** The country part of an EU VAT ID. Greece uses EL, not its ISO code. */
const VAT_ID_PREFIX: Readonly<Record<string, string>> = { GR: "EL" };
/** Every EU VAT ID prefix, so an ID of another country is not read as a number with no prefix. */
const OTHER_VAT_ID_PREFIXES = new Set(EU_VAT_COUNTRIES.map((country) => VAT_ID_PREFIX[country] ?? country));
/** The longest EU VAT ID after its prefix has 12 characters (Netherlands, France). */
const VAT_NUMBER_PATTERN = /^[0-9A-Z+*]{2,12}$/u;

export function isBillingCountry(value: unknown): value is string {
  return isString(value) && BILLING_COUNTRY_SET.has(value);
}

export function isEuVatCountry(country: string): boolean {
  return EU_VAT_COUNTRY_SET.has(country);
}

/** The prefix of an EU VAT ID of `country`: its ISO code, or EL for Greece. */
export function vatIdPrefix(country: string): string {
  return VAT_ID_PREFIX[country] ?? country;
}

/**
 * The VAT ID in its stored form: upper case, with no spaces, dots or dashes, and with the prefix of
 * `country`. A user can type it without the prefix. Null when it is not a VAT ID of `country`, also
 * when it has the prefix of another country.
 */
export function normalizeVatId(country: string, value: string): string | null {
  if (!isEuVatCountry(country)) return null;
  const prefix = vatIdPrefix(country);
  const compact = value.toUpperCase().replace(/[\s.\-_/]/gu, "");
  if (!compact.startsWith(prefix) && OTHER_VAT_ID_PREFIXES.has(compact.slice(0, 2))) return null;
  const number = compact.startsWith(prefix) ? compact.slice(prefix.length) : compact;
  return VAT_NUMBER_PATTERN.test(number) ? `${prefix}${number}` : null;
}

export function parseBillingDetails(value: unknown): BillingDetails | null {
  if (!isDynamicRecord(value)) return null;
  const country = value.country === null ? null : isBillingCountry(value.country) ? value.country : undefined;
  const vatId = value.vatId === null ? null : isString(value.vatId) ? value.vatId : undefined;
  if (country === undefined || vatId === undefined) return null;
  // A suggestion is only a first value of the form: an unknown one is dropped, not an error.
  return isBillingCountry(value.suggestedCountry)
    ? { country, vatId, suggestedCountry: value.suggestedCountry }
    : { country, vatId };
}

/** Returns null for a request with no known country or with a VAT ID that is not one of that country. */
export function parseBillingDetailsRequest(value: unknown): BillingDetailsRequest | null {
  if (!isDynamicRecord(value) || !isBillingCountry(value.country)) return null;
  if (value.vatId === undefined || value.vatId === null || value.vatId === "") return { country: value.country };
  if (!isString(value.vatId)) return null;
  const vatId = normalizeVatId(value.country, value.vatId);
  return vatId ? { country: value.country, vatId } : null;
}
