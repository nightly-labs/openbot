// Frozen optional provider-model-source-v1 wire contract. Keep IPC types and limits out of this file.
//
// What it grants, recorded here because freezing it makes it permanent: every member reads, for each
// provider of the host whose own settings give its models from another source than the provider's own,
// which source that is. `provider` is a model provider that the settings name, by its name, such as
// Ollama; `catalog` is a model list file that the settings name. The file path, the address and any key
// of the source stay on the host. Today only Codex reports it (#9956). The route lists only those
// providers. A provider that is not listed gives its own models. It holds no more than the model list
// that the member reads. Widening any of it needs a second capability string.
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
