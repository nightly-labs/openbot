import { isCreditAmount } from "../credits";
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

export const WORKFLOWS_CREDIT_MEDIA_CAPABILITY = "workflows-credit-media-v1";

export const WORKFLOWS_CREDIT_MEDIA_ROUTES = {
  catalog: "/v1/workflows/media/credit/catalog",
  credits: "/v1/workflows/media/credit/credits",
} as const;

const creditAmount: AdminDecoder = (value) => {
  if (!isCreditAmount(value)) throw new Error("Invalid admin count.");
  return value;
};

const input = oneOf("frames", "references", "videos", "audios");
const optionText = string(64);

const option = fields({
  name: identifier,
  kind: oneOf("switch", "choice"),
  values: list(optionText, 16),
  default: optionText,
});

const model = fields(
  {
    id: identifier,
    provider: oneOf("openbot"),
    providerModel: identifier,
    name: string(160),
    maker: string(120),
    kinds: list(oneOf("image", "video"), 2),
    aspects: list(oneOf("1:1", "4:3", "16:9", "9:16", "4:5", "5:4", "21:9", "3:4"), 8),
    durations: list(count, 64),
    resolutions: list(string(16), 16),
    transparent: boolean,
  },
  { options: list(option, 16), inputs: list(input, 4) },
);

export const WORKFLOWS_CREDIT_MEDIA_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [WORKFLOWS_CREDIT_MEDIA_ROUTES.catalog, adminRoute(empty, fields({ models: list(model, 1000) }))],
  [
    WORKFLOWS_CREDIT_MEDIA_ROUTES.credits,
    adminRoute(
      empty,
      fields({ openbot: nullable(fields({ available: creditAmount, quota: nullable(creditAmount) })) }),
    ),
  ],
]);
