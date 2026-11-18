// Frozen optional instance-transfer-full-copy-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server, never a member, can start an export in parts of `instance-transfer-chunks-v1` with each
// part of the file chosen on its own. `export/begin` takes every field as required:
//
// - `includeHistory`: the agents' chats and side threads, with the files of their messages.
// - `includeChannelMessages`: the messages of the exported channels. In `instance-transfer-chunks-v1`
//   they follow `includeHistory`.
// - `includeServerPreferences`: the host-wide preferences (time zone, personality, busy-message
//   mode, agent defaults, memory and skill settings, prompt cache) and the server notification level
//   of the person who exports, when that person is the owner.
//
// The answer is the `export/begin` answer of `instance-transfer-chunks-v1`, and the client reads the
// parts and ends the export with that capability's `export/chunk` and `export/done`.
//
// `apply` is the `instance-transfer-v1` apply with one more required field,
// `includeServerPreferences`: only then does the import replace this server's preferences, name, logo
// and the members' choices with the file's. The `instance-transfer-v1` apply never does, so a released
// client's "Import server settings" keeps its meaning. A host offers this capability only with
// `instance-transfer-v1` and `instance-transfer-chunks-v1`. Widening any of it needs another
// capability string.
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

/** A SHA-256 as 64 lower-case hexadecimal digits, as `instance-transfer-chunks-v1` writes it. */
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
      // 2 GiB - 1 byte in parts of 8 MiB, as in `instance-transfer-chunks-v1`.
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
