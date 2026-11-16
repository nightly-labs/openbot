// Frozen optional workflows-media-v1 wire contract. Keep IPC types and limits out of this file.
//
// What it grants, recorded here because freezing it makes it permanent: a host that advertises it
// runs the `image` node of `workflows-v1`, whose routes, grants and node codec stay as they are. The
// node fields cross in the open node fields of `workflows-v1`: `media` ("image" or "video", "image"
// when absent), `prompt`, `aspect`, `model` (an id of `WORKFLOW_MEDIA_MODELS`), `duration` and
// `resolution`. The host makes the image or the video with the subscription of the model's provider
// and keeps it as a generated attachment. The output of the step is the id of that attachment, which a
// client fetches through `GET /v1/attachments/:id`. An `asset` node's `fileId` names a picture of the
// host: an image step and a video step use it as an input picture.
//
// It adds one route. `keep-picture` keeps an attachment draft that the member sent through
// `POST /v1/attachments` as a picture of the host, with no owner agent, as a generated file is kept,
// and answers its file id. The draft goes away. Only a PNG, JPEG or WebP draft is kept. Each member
// who can use workflows can keep a picture, as each member can send a draft. A host without it keeps
// these nodes and refuses to run them, and a client does not offer them. Widening any of it needs a
// second capability string.
import { adminRoute, fields, identifier, type OptionalRouteCodec } from "./admin-wire";

export const WORKFLOWS_MEDIA_CAPABILITY = "workflows-media-v1";

export const WORKFLOWS_MEDIA_ROUTES = {
  keepPicture: "/v1/workflows/media/keep-picture",
} as const;

export const WORKFLOWS_MEDIA_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [WORKFLOWS_MEDIA_ROUTES.keepPicture, adminRoute(fields({ draftId: identifier }), fields({ fileId: identifier }))],
]);
