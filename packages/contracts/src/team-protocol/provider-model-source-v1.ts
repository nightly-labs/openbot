import { adminRoute, empty, fields, identifier, list, type OptionalRouteCodec, string, variant } from "./admin-wire";

export const PROVIDER_MODEL_SOURCE_CAPABILITY = "provider-model-source-v1";

export const PROVIDER_MODEL_SOURCE_ROUTES = {
  list: "/v1/providers/model-sources",
} as const;

const source = variant({
  provider: fields({ kind: string(16), name: string(80) }),
  catalog: fields({ kind: string(16) }),
});

export const PROVIDER_MODEL_SOURCE_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    PROVIDER_MODEL_SOURCE_ROUTES.list,
    adminRoute(empty, fields({ sources: list(fields({ provider: identifier, source }), 64) })),
  ],
]);
