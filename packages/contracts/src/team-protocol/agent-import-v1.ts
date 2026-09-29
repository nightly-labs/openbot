// Frozen optional agent-import-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: any member of a server, not
// only an owner or admin, can import agents from a Grok Bot export into the host. The member sends
// the export `.zip`, at most 100 MB, as the raw body of `stage`. The host reads it and keeps it under
// a token that only that member can apply or discard; a new `stage` by the same member releases the
// member's earlier one. The preview carries no avatars. `apply` creates the chosen agents with their
// skills, routines, memories and files, and the chosen group chats as channels created by the calling
// member. A skill whose name is already in the host's skill library is installed as it is: a member
// never adds a revision to a skill of the host. The response names the new agents only; the client
// reads them with the agent list. Widening any of it needs a second capability string.
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

export const AGENT_IMPORT_CAPABILITY = "agent-import-v1";

/** The largest export a member can send to a host. */
export const AGENT_IMPORT_UPLOAD_BYTES = 100 * 1024 * 1024;

export const AGENT_IMPORT_ROUTES = {
  stage: "/v1/agent-import/stage",
  apply: "/v1/agent-import/apply",
  discard: "/v1/agent-import/discard",
} as const;

const key = string(64);
const name = string(80);
const messages = list(string(500), 200);
const skipped = list(fields({ key, name, reason: string(500) }), 200);

const preview = fields({
  token: identifier,
  sourceApp: string(64),
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
  channels: list(
    fields({
      key,
      name,
      title: string(120),
      memberKeys: list(key, 100),
      leadKey: nullable(key),
      memoryCount: count,
      routineCount: count,
    }),
    100,
  ),
  warnings: messages,
});

const result = fields({
  agents: list(fields({ agentId: identifier, name }), 100),
  skipped,
  channels: list(fields({ id: identifier, name }), 100),
  skippedChannels: skipped,
  warnings: messages,
});

export const AGENT_IMPORT_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  // The request body is the raw `.zip`, so its decoder never reads it.
  [AGENT_IMPORT_ROUTES.stage, adminRoute(empty, preview)],
  [
    AGENT_IMPORT_ROUTES.apply,
    adminRoute(
      fields({ token: identifier, keys: list(key, 100), channelKeys: list(key, 100), timezone: string(255) }),
      result,
    ),
  ],
  [AGENT_IMPORT_ROUTES.discard, adminRoute(fields({ token: identifier }), empty)],
]);
