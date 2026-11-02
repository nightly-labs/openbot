// Frozen optional agent-backup-models-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server can read and change the backup models of each agent (`backupModels`): the models, at most
// eight, that the agent moves to when a usage limit holds its message, and whether it moves at once
// (`automatic`) or asks first. Null means the agent asks in the chat, with no saved order. Each answer
// also names the model that the agent left for a usage limit (`usageLimitReturn`, read only), or null.
// A provider id is open (`OPEN_PROVIDER_ID`); the host refuses one it does not know. An account id names one of
// the host's own provider accounts. A member cannot use either route; `requireAdmin` on the host is
// the only gate.
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
