// Frozen optional hermes-import-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a server
// can read the Hermes Agent folder of the host (`~/.hermes`, or the folder that `HERMES_HOME` sets on
// the host) and import its profiles as agents of the host, item by item, as the user of the host's
// computer does in Server settings > Import. The client cannot name a folder: the folder dialog is on
// the client's computer, and the host does not read the client's files. `read` keeps the profiles under
// a token and answers what each one holds; a new `read` on the host, by any user, closes the earlier
// one. The preview shows the host's home folder as `~` and carries no value from `.env` or `auth.json`.
// `apply` names the token, the profiles, and the items that need approval and that the caller allows.
// The response names the new and updated agents only; the client reads them with the agent list.
// Widening any of it needs a second capability string.
import { INPUT_LIMITS } from "../input-limits";
import { AGENT_IMPORT_LIMITS } from "../ipc-agent-import";
import {
  HERMES_IMPORT_ITEM_KINDS,
  HERMES_IMPORT_ITEM_STATUSES,
  HERMES_IMPORT_LIMITS,
  HERMES_IMPORT_REASONS,
  type HermesImportItem,
  type HermesImportPreview,
  type HermesImportProfile,
} from "../ipc-hermes-import";
import { isDynamicRecord, isNumber, isOneOf, isString } from "../runtime-values";
import {
  adminRoute,
  count,
  empty,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";

export const HERMES_IMPORT_CAPABILITY = "hermes-import-v1";

export const HERMES_IMPORT_ROUTES = {
  read: "/v1/hermes-import/read",
  apply: "/v1/hermes-import/apply",
  discard: "/v1/hermes-import/discard",
} as const;

const profileKey = string(64);
const itemId = string(HERMES_IMPORT_LIMITS.name + 16);
const agentName = string(INPUT_LIMITS.agentName);

const preview = fields({
  token: identifier,
  home: string(HERMES_IMPORT_LIMITS.path),
  profiles: list(
    fields({
      key: profileKey,
      name: agentName,
      path: string(HERMES_IMPORT_LIMITS.path),
      model: nullable(string(HERMES_IMPORT_LIMITS.model)),
      agent: nullable(fields({ id: identifier, name: agentName })),
      items: list(
        fields({
          id: itemId,
          kind: oneOf(...HERMES_IMPORT_ITEM_KINDS),
          status: oneOf(...HERMES_IMPORT_ITEM_STATUSES),
          names: list(string(HERMES_IMPORT_LIMITS.name), HERMES_IMPORT_LIMITS.names),
          count,
          reason: nullable(oneOf(...HERMES_IMPORT_REASONS)),
        }),
        HERMES_IMPORT_LIMITS.items,
      ),
    }),
    HERMES_IMPORT_LIMITS.profiles,
  ),
});

const message = string(AGENT_IMPORT_LIMITS.message);

// Hermes makes no channels, so both channel lists are always empty. The shape is the shape of the
// `agent-import-v1` result, so a client reads both with one decoder.
const result = fields({
  agents: list(fields({ agentId: identifier, name: agentName }), HERMES_IMPORT_LIMITS.profiles),
  skipped: list(fields({ key: profileKey, name: agentName, reason: message }), HERMES_IMPORT_LIMITS.profiles),
  channels: list(empty, 0),
  skippedChannels: list(empty, 0),
  warnings: list(message, AGENT_IMPORT_LIMITS.warnings),
});

export const HERMES_IMPORT_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  // Null: the host's Hermes folder has no profiles.
  [HERMES_IMPORT_ROUTES.read, adminRoute(empty, nullable(preview))],
  [
    HERMES_IMPORT_ROUTES.apply,
    adminRoute(
      fields({
        token: identifier,
        profiles: list(
          fields({ key: profileKey, allow: list(itemId, HERMES_IMPORT_LIMITS.items) }),
          HERMES_IMPORT_LIMITS.profiles,
        ),
      }),
      result,
    ),
  ],
  [HERMES_IMPORT_ROUTES.discard, adminRoute(fields({ token: identifier }), empty)],
]);

// The client decoder of the read answer. It is not the preload decoder: the two check different
// senders. The codec above checks the bounds; the functions below only give the checked value its type.
const readResponse = nullable(preview);

function invalidPreview(): never {
  throw new Error("Invalid Hermes preview.");
}

function previewRecord(value: unknown) {
  if (!isDynamicRecord(value)) invalidPreview();
  return value;
}

function previewText(value: unknown): string {
  if (!isString(value)) invalidPreview();
  return value;
}

function previewList(value: unknown): unknown[] {
  if (!Array.isArray(value)) invalidPreview();
  return value;
}

function previewChoice<T extends string>(choices: readonly T[], value: unknown): T {
  if (!isOneOf(choices, value)) invalidPreview();
  return value;
}

function previewItem(value: unknown): HermesImportItem {
  const item = previewRecord(value);
  if (!isNumber(item.count)) invalidPreview();
  return {
    id: previewText(item.id),
    kind: previewChoice(HERMES_IMPORT_ITEM_KINDS, item.kind),
    status: previewChoice(HERMES_IMPORT_ITEM_STATUSES, item.status),
    names: previewList(item.names).map(previewText),
    count: item.count,
    reason: item.reason === null ? null : previewChoice(HERMES_IMPORT_REASONS, item.reason),
  };
}

function previewProfile(value: unknown): HermesImportProfile {
  const profile = previewRecord(value);
  const agent = profile.agent === null ? null : previewRecord(profile.agent);
  return {
    key: previewText(profile.key),
    name: previewText(profile.name),
    path: previewText(profile.path),
    model: profile.model === null ? null : previewText(profile.model),
    agent: agent === null ? null : { id: previewText(agent.id), name: previewText(agent.name) },
    items: previewList(profile.items).map(previewItem),
  };
}

/** The preview that a host answers, or null when the host's Hermes folder has no profiles. */
export function decodeHermesImportReadResponse(value: unknown): HermesImportPreview | null {
  const decoded = readResponse(value);
  if (decoded === null) return null;
  const read = previewRecord(decoded);
  return {
    token: previewText(read.token),
    home: previewText(read.home),
    profiles: previewList(read.profiles).map(previewProfile),
  };
}
