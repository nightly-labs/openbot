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
