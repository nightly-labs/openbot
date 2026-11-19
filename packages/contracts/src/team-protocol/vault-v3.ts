import {
  type AdminDecoder,
  adminRoute,
  boolean,
  count,
  empty,
  fields,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
  variant,
} from "./admin-wire";

export const VAULT_V3_CAPABILITY = "vault-v3";

export const VAULT_V3_ROUTES = {
  list: "/v1/admin/vault/v3/list",
  save: "/v1/admin/vault/v3/save",
  delete: "/v1/admin/vault/v3/delete",
  reveal: "/v1/admin/vault/v3/reveal",
  reset: "/v1/admin/vault/v3/reset",
  codes: "/v1/admin/vault/v3/codes",
} as const;

export const VAULT_V3_WIRE_ITEM_LIMIT = 5_000;
export const VAULT_V3_WIRE_NAME_LIMIT = 512;

const id = string(64);
const text = string(512);
const notes = string(4_096);
const apiKeyName = string(64);
const origin = { addedBy: string(VAULT_V3_WIRE_NAME_LIMIT) };
const month: AdminDecoder = (value) => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 12)
    throw new Error("Invalid admin month.");
  return value;
};
const fillSites = list(text, 100);
const contact = {
  label: text,
  fullName: text,
  address: text,
  address2: text,
  city: text,
  region: text,
  postalCode: text,
  country: text,
  phone: text,
  email: text,
};

const item = variant({
  login: fields(
    { id, kind: oneOf("login"), website: text, username: text, notes, hasPassword: boolean, hasTwoStep: boolean },
    origin,
  ),
  card: fields(
    {
      id,
      kind: oneOf("card"),
      label: text,
      nameOnCard: text,
      brand: nullable(oneOf("visa", "mastercard", "amex", "discover")),
      last4: string(4),
      expMonth: month,
      expYear: count,
      billingContactId: nullable(id),
      fillSites,
    },
    origin,
  ),
  contact: fields({ id, kind: oneOf("contact"), ...contact }, origin),
  apiKey: fields({ id, kind: oneOf("apiKey"), name: apiKeyName, notes, hasKey: boolean }, origin),
});

const state = fields({
  status: oneOf("ready", "unavailable", "unreadable"),
  items: list(item, VAULT_V3_WIRE_ITEM_LIMIT),
});

const saveInput = variant({
  login: fields(
    {
      kind: oneOf("login"),
      id: nullable(id),
      website: text,
      username: text,
      notes,
      password: nullable(string(1_024)),
    },
    { twoStepKey: string(1_024) },
  ),
  card: fields(
    {
      kind: oneOf("card"),
      id: nullable(id),
      label: text,
      nameOnCard: text,
      expMonth: month,
      expYear: count,
      billingContactId: nullable(id),
      number: nullable(string(32)),
      securityCode: nullable(string(8)),
    },
    { fillSites },
  ),
  contact: fields({ kind: oneOf("contact"), id: nullable(id), ...contact }),
  apiKey: fields({ kind: oneOf("apiKey"), id: nullable(id), name: apiKeyName, notes, key: nullable(string(8_192)) }),
});

const secretRequest = fields({ id, field: oneOf("password", "number", "securityCode", "key") });

const codes = fields({
  codes: list(fields({ id, code: string(8), period: count, remainingMs: count }), VAULT_V3_WIRE_ITEM_LIMIT),
});

export const VAULT_V3_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [VAULT_V3_ROUTES.list, adminRoute(empty, state)],
  [VAULT_V3_ROUTES.save, adminRoute(saveInput, state)],
  [VAULT_V3_ROUTES.delete, adminRoute(fields({ id }), state)],
  [VAULT_V3_ROUTES.reveal, adminRoute(secretRequest, fields({ value: string(8_192) }))],
  [VAULT_V3_ROUTES.reset, adminRoute(empty, state)],
  [VAULT_V3_ROUTES.codes, adminRoute(empty, codes)],
]);
