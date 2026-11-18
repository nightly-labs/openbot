// Frozen optional storage-channel-v1 wire contract: the files of one channel, for the Files pane of
// the channel side panel (#4135).
//
// What it grants, recorded here because freezing it makes it permanent: every member who can see a
// channel can read the names, sizes and messages of the files sent in that channel's messages. That
// is no more than `storage-v1` already gives on the host scope, and less: the host refuses a channel
// that the member cannot see, as `POST /v1/channels/read` does. Rows never carry a path. Deleting a
// file stays on `POST /v1/storage/delete-file`, for an owner or an admin only.
//
// The file row is the `storage-v1` row, written again as literals so this contract does not move with
// it. Bounds and meaning do not follow IPC changes; widening any of it needs a second capability string.

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
