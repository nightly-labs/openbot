// Frozen optional vault-v4 wire contract. Keep IPC types and limits out of this file.
//
// What it grants, recorded here because freezing it makes it permanent: all that `vault-v3` grants, and
// the agents of each item. An owner or admin of a joined server sees which agents can use each host
// item, and gives an item to every agent or to chosen agents. A member cannot use any route;
// `requireAdmin` on the host is the only gate. `vault-v1`, `vault-v2` and `vault-v3` stay as they are:
// their list items do not carry `agents`, and their save keeps the saved agents.
//
// A list item carries `agents` only when the item is for chosen agents; it is absent when every agent
// can use the item. On save, an absent `agents` keeps the saved choice, null gives the item to every
// agent, and a list of agent ids gives it to those agents. The host refuses an empty list.
//
// No route answers with a two-step key: the host keeps it, and `codes` sends only the codes, which a
// site accepts for one period. A list item never carries a password, a card number, a security code or
// an API key. Only `reveal` answers with one. Changes are announced by the `vault-changed` event of
// `vault-v1`. Widening any of it needs a fifth capability.
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

export const VAULT_V4_CAPABILITY = "vault-v4";

export const VAULT_V4_ROUTES = {
  list: "/v1/admin/vault/v4/list",
  save: "/v1/admin/vault/v4/save",
  delete: "/v1/admin/vault/v4/delete",
  reveal: "/v1/admin/vault/v4/reveal",
  reset: "/v1/admin/vault/v4/reset",
  codes: "/v1/admin/vault/v4/codes",
} as const;

/** The most items that one list carries. The host sends the first ones. */
export const VAULT_V4_WIRE_ITEM_LIMIT = 5_000;
/** The longest agent name in `addedBy`. The host cuts a longer one. */
export const VAULT_V4_WIRE_NAME_LIMIT = 512;
/** The most agents that one item names. */
export const VAULT_V4_WIRE_AGENT_LIMIT = 1_000;
/** The longest agent id in `agents`. */
export const VAULT_V4_WIRE_AGENT_ID_LIMIT = 128;

const id = string(64);
const text = string(512);
const notes = string(4_096);
/** An environment variable name: A-Z, 0-9 and _, up to 64 characters. The host checks the pattern. */
const apiKeyName = string(64);
/** The ids of the agents that can use an item. */
const agents = list(string(VAULT_V4_WIRE_AGENT_ID_LIMIT), VAULT_V4_WIRE_AGENT_LIMIT);
const origin = { addedBy: string(VAULT_V4_WIRE_NAME_LIMIT), agents };
/** Absent keeps the saved agents, and null is every agent. */
const scope = { agents: nullable(agents) };
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
  items: list(item, VAULT_V4_WIRE_ITEM_LIMIT),
});

/**
 * A new item when `id` is null. A null secret keeps the saved value. An absent `twoStepKey` keeps the
 * saved key, an empty one removes it, and any other text is a setup key or an `otpauth://totp/` link
 * that the host checks.
 */
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
    { twoStepKey: string(1_024), ...scope },
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
    { fillSites, ...scope },
  ),
  contact: fields({ kind: oneOf("contact"), id: nullable(id), ...contact }, scope),
  apiKey: fields(
    { kind: oneOf("apiKey"), id: nullable(id), name: apiKeyName, notes, key: nullable(string(8_192)) },
    scope,
  ),
});

const secretRequest = fields({ id, field: oneOf("password", "number", "securityCode", "key") });

/** The code of each login with a key, `period` in seconds, and the milliseconds that it stays valid. */
const codes = fields({
  codes: list(fields({ id, code: string(8), period: count, remainingMs: count }), VAULT_V4_WIRE_ITEM_LIMIT),
});

export const VAULT_V4_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [VAULT_V4_ROUTES.list, adminRoute(empty, state)],
  [VAULT_V4_ROUTES.save, adminRoute(saveInput, state)],
  [VAULT_V4_ROUTES.delete, adminRoute(fields({ id }), state)],
  [VAULT_V4_ROUTES.reveal, adminRoute(secretRequest, fields({ value: string(8_192) }))],
  [VAULT_V4_ROUTES.reset, adminRoute(empty, state)],
  [VAULT_V4_ROUTES.codes, adminRoute(empty, codes)],
]);
