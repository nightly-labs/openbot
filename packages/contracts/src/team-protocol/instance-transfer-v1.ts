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

export const INSTANCE_TRANSFER_RESULT = fields({
  agents: list(fields({ agentId: identifier, name }), 100),
  skipped: list(fields({ key, name, reason: string(500) }), 100),
  signIn: list(string(32), 32),
  warnings: messages,
});

export const INSTANCE_TRANSFER_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [INSTANCE_TRANSFER_ROUTES.summary, adminRoute(empty, summary)],
  [
    INSTANCE_TRANSFER_ROUTES.export,
    adminRoute(fields({ agentIds: list(identifier, 100), includeFiles: boolean, includeSettings: boolean }), empty),
  ],
  [INSTANCE_TRANSFER_ROUTES.stage, adminRoute(empty, INSTANCE_TRANSFER_PREVIEW)],
  [
    INSTANCE_TRANSFER_ROUTES.apply,
    adminRoute(
      fields({ token: identifier, keys: list(key, 100), includeSettings: boolean, timezone: string(255) }),
      INSTANCE_TRANSFER_RESULT,
    ),
  ],
  [INSTANCE_TRANSFER_ROUTES.discard, adminRoute(fields({ token: identifier }), empty)],
]);
