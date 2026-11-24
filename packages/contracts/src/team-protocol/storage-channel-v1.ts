import type { OptionalRouteCodec } from "./admin-wire";
import { adminRoute, boolean, count, fields, identifier, list, nullable, oneOf, string } from "./admin-wire";

export const STORAGE_CHANNEL_CAPABILITY = "storage-channel-v1";
export const STORAGE_CHANNEL_ROUTES = { files: "/v1/storage/channel-files" } as const;

const file = fields({
  id: identifier,
  name: string(255),
  size: count,
  kind: oneOf("image", "file"),
  mimeType: string(255),
  previewKind: oneOf("image", "pdf", "text", "none"),
  previewUrl: nullable(string(2_048)),
  source: oneOf("attachment", "generated"),
  agentId: nullable(identifier),
  conversation: nullable(fields({ id: identifier, title: string(255) })),
  messageId: nullable(identifier),
  createdAt: string(64),
  status: oneOf("available", "missing"),
  deletable: boolean,
});

export const STORAGE_CHANNEL_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    STORAGE_CHANNEL_ROUTES.files,
    adminRoute(
      fields({ channelId: identifier }, { force: boolean }),
      fields({
        channelId: identifier,
        scannedAt: string(64),
        files: list(file, 2_000),
        truncated: boolean,
      }),
    ),
  ],
]);
