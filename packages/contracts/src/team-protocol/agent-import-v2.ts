// Frozen optional agent-import-v2 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: all that `agent-import-v1`
// grants, with an export of any size. A member sends the export in parts instead of one body of at
// most 100 MB. `open` names the size of the export and answers an upload id that only that member can
// use; a new `open` or v1 `stage` by the same member releases the member's earlier upload and export.
// `chunk` sends the next part, at most 8 MiB, as the raw body, with the upload id and the byte offset
// of the part in the query (`?upload=<id>&offset=<n>`). The offset must be the number of bytes the
// host has. `stage` reads the complete upload and answers the v1 preview, with a token for the v1
// `apply` and `discard` routes. A host that serves this capability also serves `agent-import-v1`.
// The host refuses an export that its free disk space cannot hold, and releases an upload that gets
// no part for 10 minutes. Widening any of it needs a third capability string.
import { adminRoute, count, empty, fields, identifier, type OptionalRouteCodec } from "./admin-wire";
import { AGENT_IMPORT_PREVIEW } from "./agent-import-v1";

export const AGENT_IMPORT_V2_CAPABILITY = "agent-import-v2";

/** The largest part of an export in one `chunk` request. */
export const AGENT_IMPORT_V2_CHUNK_BYTES = 8 * 1024 * 1024;

export const AGENT_IMPORT_V2_ROUTES = {
  open: "/v1/agent-import/v2/open",
  chunk: "/v1/agent-import/v2/chunk",
  stage: "/v1/agent-import/v2/stage",
} as const;

/** The path of one part: the upload id and the byte offset go in the query. */
export function agentImportV2ChunkPath(uploadId: string, offset: number): string {
  return `${AGENT_IMPORT_V2_ROUTES.chunk}?${new URLSearchParams({ upload: uploadId, offset: String(offset) })}`;
}

export const AGENT_IMPORT_V2_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [AGENT_IMPORT_V2_ROUTES.open, adminRoute(fields({ size: count }), fields({ uploadId: identifier }))],
  // The request body is the raw part, so its decoder never reads it.
  [AGENT_IMPORT_V2_ROUTES.chunk, adminRoute(empty, fields({ received: count }))],
  [AGENT_IMPORT_V2_ROUTES.stage, adminRoute(fields({ uploadId: identifier }), AGENT_IMPORT_PREVIEW)],
]);
