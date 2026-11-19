import {
  type AdminDecoder,
  adminRoute,
  boolean,
  count,
  fields,
  identifier,
  list,
  type OptionalRouteCodec,
  string,
} from "./admin-wire";
import { INSTANCE_TRANSFER_RESULT } from "./instance-transfer-v1";

export const INSTANCE_TRANSFER_FULL_COPY_CAPABILITY = "instance-transfer-full-copy-v1";

export const INSTANCE_TRANSFER_FULL_COPY_ROUTES = {
  exportBegin: "/v1/instance-transfer-full-copy/export/begin",
  apply: "/v1/instance-transfer-full-copy/apply",
} as const;

const sha256: AdminDecoder = (value) => {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) throw new Error("Invalid admin digest.");
  return value;
};

export const INSTANCE_TRANSFER_FULL_COPY_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    INSTANCE_TRANSFER_FULL_COPY_ROUTES.exportBegin,
    adminRoute(
      fields({
        agentIds: list(identifier, 100),
        includeFiles: boolean,
        includeSettings: boolean,
        includeHistory: boolean,
        includeChannelMessages: boolean,
        includeServerPreferences: boolean,
      }),
      fields({
        exportId: identifier,
        size: count,
        sha256,
        chunkBytes: count,
        chunks: list(sha256, 256),
        warnings: list(string(500), 200),
      }),
    ),
  ],
  [
    INSTANCE_TRANSFER_FULL_COPY_ROUTES.apply,
    adminRoute(
      fields({
        token: identifier,
        keys: list(string(64), 100),
        includeSettings: boolean,
        includeServerPreferences: boolean,
        timezone: string(255),
      }),
      INSTANCE_TRANSFER_RESULT,
    ),
  ],
]);
