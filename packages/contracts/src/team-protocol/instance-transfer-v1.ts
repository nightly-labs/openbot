// Frozen optional instance-transfer-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server, never a member, can move the server's agents and server settings to or from an OpenBot
// transfer file. `summary` lists the host's agents with their counts. `export` answers the transfer
// file as an attachment, at most 100 MB, with no secret in it. `stage` takes such a file, at most
// 100 MB, as the raw body, keeps it under a token that only the caller can apply or discard, and
// answers a preview with no avatars. `apply` creates the chosen agents and, when asked, adds the MCP
// servers (turned off), custom providers, sidebar sections and routine flows that the host does not
// have. The response names the new agents only; the client reads them with the agent list. Widening
// any of it needs a second capability string.
import {
  adminRoute,
  boolean,
  count,
  empty,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  string,
} from "./admin-wire";

export const INSTANCE_TRANSFER_CAPABILITY = "instance-transfer-v1";

/** The largest transfer file that goes to or from a host: one WebRTC file transfer. */
export const INSTANCE_TRANSFER_REMOTE_BYTES = 100 * 1024 * 1024;

export const INSTANCE_TRANSFER_ROUTES = {
  summary: "/v1/instance-transfer/summary",
  export: "/v1/instance-transfer/export",
  stage: "/v1/instance-transfer/stage",
  apply: "/v1/instance-transfer/apply",
  discard: "/v1/instance-transfer/discard",
} as const;

const key = string(64);
const name = string(80);
const messages = list(string(500), 200);

const summary = fields({
  agents: list(
    fields({
      id: identifier,
      name,
      title: string(120),
      avatarSeed: string(128),
      avatarHue: nullable(count),
      skillCount: count,
      routineCount: count,
      memoryCount: count,
      fileCount: count,
      fileBytes: count,
    }),
    100,
  ),
});

/** The stage preview. `instance-transfer-chunks-v1` finish answers the same shape. */
export const INSTANCE_TRANSFER_PREVIEW = fields({
  token: identifier,
  appVersion: string(64),
  exportedAt: nullable(string(64)),
  agents: list(
    fields({
      key,
      name,
      title: string(120),
      description: string(2_000),
      skillCount: count,
      routineCount: count,
      memoryCount: count,
      fileCount: count,
      fileBytes: count,
      nameExists: boolean,
    }),
    100,
  ),
  hasSettings: boolean,
  warnings: messages,
});

const result = fields({
  agents: list(fields({ agentId: identifier, name }), 100),
  skipped: list(fields({ key, name, reason: string(500) }), 100),
  signIn: list(string(32), 32),
  warnings: messages,
});

export const INSTANCE_TRANSFER_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [INSTANCE_TRANSFER_ROUTES.summary, adminRoute(empty, summary)],
  // The response is the `.zip` itself, sent as an attachment; only an error envelope is JSON.
  [
    INSTANCE_TRANSFER_ROUTES.export,
    adminRoute(fields({ agentIds: list(identifier, 100), includeFiles: boolean, includeSettings: boolean }), empty),
  ],
  // The request body is the raw `.zip`, so its decoder never reads it.
  [INSTANCE_TRANSFER_ROUTES.stage, adminRoute(empty, INSTANCE_TRANSFER_PREVIEW)],
  [
    INSTANCE_TRANSFER_ROUTES.apply,
    adminRoute(
      fields({ token: identifier, keys: list(key, 100), includeSettings: boolean, timezone: string(255) }),
      result,
    ),
  ],
  [INSTANCE_TRANSFER_ROUTES.discard, adminRoute(fields({ token: identifier }), empty)],
]);
