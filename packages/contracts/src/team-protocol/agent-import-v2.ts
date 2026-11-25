import { adminRoute, count, empty, fields, identifier, type OptionalRouteCodec } from "./admin-wire";
import { AGENT_IMPORT_PREVIEW } from "./agent-import-v1";

export const AGENT_IMPORT_V2_CAPABILITY = "agent-import-v2";

export const AGENT_IMPORT_V2_CHUNK_BYTES = 8 * 1024 * 1024;

export const AGENT_IMPORT_V2_ROUTES = {
  open: "/v1/agent-import/v2/open",
  chunk: "/v1/agent-import/v2/chunk",
  stage: "/v1/agent-import/v2/stage",
} as const;

export function agentImportV2ChunkPath(uploadId: string, offset: number): string {
  return `${AGENT_IMPORT_V2_ROUTES.chunk}?${new URLSearchParams({ upload: uploadId, offset: String(offset) })}`;
}

export const AGENT_IMPORT_V2_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [AGENT_IMPORT_V2_ROUTES.open, adminRoute(fields({ size: count }), fields({ uploadId: identifier }))],
  [AGENT_IMPORT_V2_ROUTES.chunk, adminRoute(empty, fields({ received: count }))],
  [AGENT_IMPORT_V2_ROUTES.stage, adminRoute(fields({ uploadId: identifier }), AGENT_IMPORT_PREVIEW)],
]);
