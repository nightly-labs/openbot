import { isDynamicRecord, isString } from "./runtime-values";

export interface BillingDetails {
  country: string | null;
  vatId: string | null;
  suggestedCountry?: string;
}

export interface BillingDetailsRequest {
  country: string;
  vatId?: string;
}

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

export const VAT_SELLER_COUNTRY = "PL";

export const VAT_TAX_RATE = { metadataKey: "openbot_vat", metadataValue: "pl_standard", percentage: 23 } as const;

const BILLING_COUNTRY_SET = new Set(BILLING_COUNTRIES);
const EU_VAT_COUNTRY_SET = new Set(EU_VAT_COUNTRIES);
const VAT_ID_PREFIX: Readonly<Record<string, string>> = { GR: "EL" };
const OTHER_VAT_ID_PREFIXES = new Set(EU_VAT_COUNTRIES.map((country) => VAT_ID_PREFIX[country] ?? country));
const VAT_NUMBER_PATTERN = /^[0-9A-Z+*]{2,12}$/u;

export function isBillingCountry(value: unknown): value is string {
  return isString(value) && BILLING_COUNTRY_SET.has(value);
}

export function isEuVatCountry(country: string): boolean {
  return EU_VAT_COUNTRY_SET.has(country);
}

const OTHER_WITHDRAWAL_COUNTRIES = new Set(["GB", "TR"]);

export function isWithdrawalConsumer(
  details: { country: string | null; vatId: string | null } | null | undefined,
): boolean {
  if (details?.country == null || details.vatId?.trim()) return false;
  return isEuVatCountry(details.country) || OTHER_WITHDRAWAL_COUNTRIES.has(details.country);
}

export function vatIdPrefix(country: string): string {
  return VAT_ID_PREFIX[country] ?? country;
}

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
  return isBillingCountry(value.suggestedCountry)
    ? { country, vatId, suggestedCountry: value.suggestedCountry }
    : { country, vatId };
}

export function parseBillingDetailsRequest(value: unknown): BillingDetailsRequest | null {
  if (!isDynamicRecord(value) || !isBillingCountry(value.country)) return null;
  if (value.vatId === undefined || value.vatId === null || value.vatId === "") return { country: value.country };
  if (!isString(value.vatId)) return null;
  const vatId = normalizeVatId(value.country, value.vatId);
  return vatId ? { country: value.country, vatId } : null;
}
