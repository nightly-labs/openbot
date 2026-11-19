// Frozen optional workflows-media-catalog-v2 wire contract. Keep IPC types and limits out of this file.
//
// What it grants, recorded here because freezing it makes it permanent: everything that
// `workflows-media-catalog-v1` grants, and four additions for the catalog models.
//
// 1. The aspect ratios "21:9" and "3:4". The `image` node of `workflows-media-v1` reads them as an
//    `aspect`, and the host asks the model for that ratio. A model sends them in `aspects` only when
//    the service lists them for it.
// 2. `options`: the other settings of a model that the service lists, such as sound or bitrate. Each
//    has a `name` (the parameter name at the service), a `kind` and its `values`, the first value not
//    always the `default`. A `switch` has the values "off" and "on". A `choice` has 2 to 16 values.
//    The host sends no option that sets the prompt, the pictures, the model, the count, the aspect
//    ratio, the length, the resolution or the background.
// 3. The `options` node field: a JSON text of an object, an option name to one of its values. The host
//    reads only the names and values that the model's `options` has, and sends each one to the service
//    when it makes the file. It ignores a name or a value that the model does not have.
// 4. The inputs of a video model. `inputs` lists what the model takes: "frames" (the `firstFrame` and
//    `lastFrame` pictures), "references" (the other pictures), "videos" and "audios". A model without
//    `inputs` takes frames and references, as in v1. The video and audio files of the nodes with a
//    `file` edge into an `image` node of a video are its video and audio references; the host sends
//    them only to a model with "videos" or "audios". `modes` lists the values of the model's `mode`
//    option, a `choice` option named "mode" with the same values, and the inputs that the model takes
//    in each. With a `mode` in the node field, the host sends that mode and only its inputs. Without
//    one, the host chooses the mode from the inputs that the step has, as in v1.
//
// It adds two routes, which each member who can use workflows can call. Both are reads only; they
// never give a token or an account, and they never start a job.
//
// `catalog` answers `{ models }` as the `catalog` route of `workflows-media-catalog-v1` does, with the
// aspect ratios above and `options`. `price` answers `{ credits }` as the v1 `price` route does; its
// request can also have `options`, a list of `{ name, value }`, which the quote reads as the node field
// does. The v1 routes keep their answers: a host never sends "21:9", "3:4" or `options` on them.
// A client lets a person choose these only for a model of the v2 `catalog` answer. Widening any of it
// needs a second capability string.
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

export const WORKFLOWS_MEDIA_CATALOG_V2_CAPABILITY = "workflows-media-catalog-v2";

export const WORKFLOWS_MEDIA_CATALOG_V2_ROUTES = {
  catalog: "/v1/workflows/media/v2/catalog",
  price: "/v1/workflows/media/v2/price",
} as const;

const kind = oneOf("image", "video");
const aspect = oneOf("1:1", "4:3", "16:9", "9:16", "4:5", "5:4", "21:9", "3:4");
const optionText = string(64);
const input = oneOf("frames", "references", "videos", "audios");

/** A price in credits: a finite number that is not negative, with a fraction or not. */
const credits: AdminDecoder = (value) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000_000)
    throw new Error("Invalid admin price.");
  return value;
};

const option = fields({
  name: identifier,
  kind: oneOf("switch", "choice"),
  values: list(optionText, 16),
  default: optionText,
});

const model = fields(
  {
    id: identifier,
    provider: oneOf("sunra", "higgsfield"),
    providerModel: identifier,
    name: string(160),
    maker: string(120),
    kinds: list(kind, 2),
    aspects: list(aspect, 8),
    durations: list(count, 64),
    resolutions: list(string(16), 16),
    transparent: boolean,
  },
  {
    options: list(option, 16),
    inputs: list(input, 4),
    modes: list(fields({ value: optionText, inputs: list(input, 4) }), 16),
  },
);

export const WORKFLOWS_MEDIA_CATALOG_V2_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [WORKFLOWS_MEDIA_CATALOG_V2_ROUTES.catalog, adminRoute(empty, fields({ models: list(model, 1000) }))],
  [
    WORKFLOWS_MEDIA_CATALOG_V2_ROUTES.price,
    adminRoute(
      fields(
        {
          model: identifier,
          kind,
          aspect,
          duration: count,
          resolution: nullable(string(16)),
          transparent: boolean,
        },
        { options: list(fields({ name: identifier, value: optionText }), 16) },
      ),
      fields({ credits: nullable(credits) }),
    ),
  ],
]);
