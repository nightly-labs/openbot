import { isString } from "../runtime-values";
import {
  type AdminDecoder,
  adminRoute,
  boolean,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  string,
} from "./admin-wire";
import { OPEN_PROVIDER_ID } from "./provider-aware-codec";

export const AGENT_BACKUP_MODELS_CAPABILITY = "agent-backup-models-v1";

export const AGENT_BACKUP_MODELS_ROUTES = {
  settings: "/v1/admin/agents/backup-models",
  update: "/v1/admin/agents/backup-models/update",
} as const;

const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/[\],=-]{0,159}$/u;
const ACCOUNT_ID = /^(?:default|a[0-9a-f]{16})$/u;

const pattern =
  (expression: RegExp): AdminDecoder =>
  (value) => {
    if (!isString(value) || !expression.test(value)) throw new Error("Invalid backup model.");
    return value;
  };
const choice = fields(
  { provider: pattern(OPEN_PROVIDER_ID), model: pattern(MODEL) },
  { providerAccountId: pattern(ACCOUNT_ID) },
);
const backupModels = nullable(fields({ automatic: boolean, order: list(choice, 8) }));
const usageLimitReturn = nullable(
  fields(
    { provider: pattern(OPEN_PROVIDER_ID), model: pattern(MODEL), reasoningEffort: string(32) },
    { providerAccountId: pattern(ACCOUNT_ID) },
  ),
);
const settings: AdminDecoder = fields({ backupModels, usageLimitReturn });

export const AGENT_BACKUP_MODELS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [AGENT_BACKUP_MODELS_ROUTES.settings, adminRoute(fields({ agentId: identifier }), settings)],
  [AGENT_BACKUP_MODELS_ROUTES.update, adminRoute(fields({ agentId: identifier, backupModels }), settings)],
]);
