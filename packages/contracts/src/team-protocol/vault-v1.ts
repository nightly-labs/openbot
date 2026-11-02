// Frozen optional vault-v1 wire contract. Keep IPC types and limits out of this file.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a joined
// server manages the host's Vault from their own computer or browser. They list its items, add, change
// and delete them, see one saved password, card number or security code when they ask for it, and
// start again with no items when the host cannot read the file; the host refuses a reset of a Vault
// that it can read. A member cannot use any route;
// `requireAdmin` on the host is the only gate. A CSV import is not here: it reads a file on the host.
//
// A list item never carries a password, a card number or a security code. Only `reveal` answers with
// one, and the client asks for it each time the user shows or copies it. `vault-changed` carries no
// data, as every client with the capability gets it, a member too: an admin client reads the list
// again. Widening any of it needs a second capability.
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

/** The most items that one list carries. The host sends the first ones. */
export const VAULT_WIRE_ITEM_LIMIT = 5_000;
/** The longest agent name in `addedBy`. The host cuts a longer one. */
export const VAULT_WIRE_NAME_LIMIT = 512;

export type VaultEvent = { type: "vault-changed" };

/** The Vault event in `value`, or null for any other event. */
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

/** A new item when `id` is null. A null secret keeps the saved value. */
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
