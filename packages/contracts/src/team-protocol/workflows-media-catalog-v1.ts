// Frozen optional workflows-media-catalog-v1 wire contract. Keep IPC types and limits out of this file.
//
// What it grants, recorded here because freezing it makes it permanent: a host that advertises it
// runs the `image` node of `workflows-media-v1` with each model of its `catalog` answer, in addition
// to the models of `WORKFLOW_MEDIA_MODELS`. The host reads the live model lists of Sunra
// (`list_models`) and Higgsfield (`models_explore`) on the sign-ins of the enabled Sunra and
// Higgsfield rows in its Apps, and keeps only the models that make an image or a video from a
// description, with optional pictures. The node fields and the step output stay as
// `workflows-media-v1` sets them; the `model` field of the node is the `id` of the catalog entry.
// `workflows-sunra-v1` and `workflows-higgsfield-v1` set who pays and how a step reads the credits.
//
// It adds two routes, which each member who can use workflows can call. Both are reads only; they
// never give a token or an account, and they never start a job.
//
// `catalog` answers `{ models }`: the models of each signed-in service. `id` is "sunra-" or
// "higgsfield-" and `providerModel`, the id of the model at the service. `kinds` has one kind.
// `aspects`, `durations` (a video only, in seconds) and `resolutions` (the default first) are the
// choices that the host sends; an empty `resolutions` has no resolution choice. `transparent` is true
// when an image can have a transparent background. A service that did not answer gives its models of
// `WORKFLOW_MEDIA_MODELS`. A client shows a service's models only while `workflows-sunra-v1` or
// `workflows-higgsfield-v1` says that the host can use it.
//
// `price` answers `{ credits }`: what one file of a model costs with the choices of the request, as
// the service quotes it, or null when the service gives no quote. Credits can have a fraction. The
// quote never sends a picture. Widening any of it needs a second capability string.
import {
  type AdminDecoder,
  adminRoute,
  boolean,
  count,
  empty,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";

export const WORKFLOWS_MEDIA_CATALOG_CAPABILITY = "workflows-media-catalog-v1";

export const WORKFLOWS_MEDIA_CATALOG_ROUTES = {
  catalog: "/v1/workflows/media/catalog",
  price: "/v1/workflows/media/price",
} as const;

const kind = oneOf("image", "video");
const aspect = oneOf("1:1", "4:3", "16:9", "9:16", "4:5", "5:4");

/** A price in credits: a finite number that is not negative, with a fraction or not. */
const credits: AdminDecoder = (value) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000_000)
    throw new Error("Invalid admin price.");
  return value;
};

const model = fields({
  id: identifier,
  provider: oneOf("sunra", "higgsfield"),
  providerModel: identifier,
  name: string(160),
  maker: string(120),
  kinds: list(kind, 2),
  aspects: list(aspect, 6),
  durations: list(count, 64),
  resolutions: list(string(16), 16),
  transparent: boolean,
});

export const WORKFLOWS_MEDIA_CATALOG_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [WORKFLOWS_MEDIA_CATALOG_ROUTES.catalog, adminRoute(empty, fields({ models: list(model, 1000) }))],
  [
    WORKFLOWS_MEDIA_CATALOG_ROUTES.price,
    adminRoute(
      fields({
        model: identifier,
        kind,
        aspect,
        duration: count,
        resolution: nullable(string(16)),
        transparent: boolean,
      }),
      fields({ credits: nullable(credits) }),
    ),
  ],
]);
