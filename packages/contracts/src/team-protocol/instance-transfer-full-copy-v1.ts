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
// parts and ends the export with that capability's `export/chunk` and `export/done`. A host offers
// this capability only with `instance-transfer-chunks-v1`. Widening any of it needs another
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

export const INSTANCE_TRANSFER_FULL_COPY_CAPABILITY = "instance-transfer-full-copy-v1";

export const INSTANCE_TRANSFER_FULL_COPY_ROUTES = {
  exportBegin: "/v1/instance-transfer-full-copy/export/begin",
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
]);
