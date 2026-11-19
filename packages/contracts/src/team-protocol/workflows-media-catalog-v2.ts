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
