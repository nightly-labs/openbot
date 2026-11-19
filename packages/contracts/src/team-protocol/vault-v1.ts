import { isDynamicRecord } from "../runtime-values";
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

export const VAULT_CAPABILITY = "vault-v1";

export const VAULT_ROUTES = {
  list: "/v1/admin/vault/list",
  save: "/v1/admin/vault/save",
  delete: "/v1/admin/vault/delete",
  reveal: "/v1/admin/vault/reveal",
  reset: "/v1/admin/vault/reset",
} as const;

export const VAULT_WIRE_ITEM_LIMIT = 5_000;
export const VAULT_WIRE_NAME_LIMIT = 512;

export type VaultEvent = { type: "vault-changed" };

export function vaultEvent(value: unknown): VaultEvent | null {
  if (!isDynamicRecord(value) || value.type !== "vault-changed") return null;
  return { type: "vault-changed" };
}

const id = string(64);
const text = string(512);
const origin = { addedBy: string(VAULT_WIRE_NAME_LIMIT) };
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
    { id, kind: oneOf("login"), website: text, username: text, notes: string(4_096), hasPassword: boolean },
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
});

const state = fields({
  status: oneOf("ready", "unavailable", "unreadable"),
  items: list(item, VAULT_WIRE_ITEM_LIMIT),
});

const saveInput = variant({
  login: fields({
    kind: oneOf("login"),
    id: nullable(id),
    website: text,
    username: text,
    notes: string(4_096),
    password: nullable(string(1_024)),
  }),
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
});

const secretRequest = fields({ id, field: oneOf("password", "number", "securityCode") });

export const VAULT_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [VAULT_ROUTES.list, adminRoute(empty, state)],
  [VAULT_ROUTES.save, adminRoute(saveInput, state)],
  [VAULT_ROUTES.delete, adminRoute(fields({ id }), state)],
  [VAULT_ROUTES.reveal, adminRoute(secretRequest, fields({ value: string(1_024) }))],
  [VAULT_ROUTES.reset, adminRoute(empty, state)],
]);
