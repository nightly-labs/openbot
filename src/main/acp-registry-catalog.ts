import { sourceText } from "@openbot/i18n/source";
import { Effect, Schema } from "effect";
import { ProviderRuntimeFailure, runtimeIO } from "./provider-runtime-effects";

export const ACP_REGISTRY_URL = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";
const text = (limit: number) => Schema.String.check(Schema.isMaxLength(limit));
const id = text(128).check(Schema.isPattern(/^[a-z0-9][a-z0-9._-]*$/u));
const argument = text(1024).check(Schema.isPattern(/^[^\0\r\n]*$/u));
const https = text(2048).check(
  Schema.makeFilter((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch {
      return false;
    }
  }),
);
const options = {
  args: Schema.optionalKey(Schema.Array(argument).check(Schema.isMaxLength(32))),
  env: Schema.optionalKey(Schema.Record(Schema.String.check(Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_]*$/u)), argument)),
};
const binary = Schema.Struct({
  archive: https,
  cmd: argument,
  sha256: Schema.optionalKey(text(64).check(Schema.isPattern(/^[a-fA-F0-9]{64}$/u))),
  ...options,
});
const exactVersion = "v?[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?";
const npm = Schema.Struct({
  package: text(256).check(
    Schema.isPattern(new RegExp(`^(?:@[a-z0-9._-]+/[a-z0-9._-]+|[a-z0-9][a-z0-9._-]*)@${exactVersion}$`, "iu")),
  ),
  ...options,
});
const uv = Schema.Struct({
  package: text(256).check(Schema.isPattern(new RegExp(`^[a-z0-9][a-z0-9._-]*(?:@|==)${exactVersion}$`, "iu"))),
  ...options,
});
export const RegistryAgent = Schema.Struct({
  id,
  name: text(160),
  version: text(128),
  description: text(4096),
  website: Schema.optionalKey(https),
  license: Schema.optionalKey(text(128)),
  distribution: Schema.Struct({
    binary: Schema.optionalKey(Schema.Record(Schema.String, binary)),
    npx: Schema.optionalKey(npm),
    uvx: Schema.optionalKey(uv),
  }),
});
export type RegistryAgent = typeof RegistryAgent.Type;
export type RegistryBinary = typeof binary.Type;
export type RegistryPackage = typeof npm.Type;
const Catalog = Schema.Struct({ agents: Schema.Array(Schema.Unknown).check(Schema.isMaxLength(1000)) });
const decodeCatalog = Schema.decodeUnknownEffect(Catalog);
const decodeAgent = Schema.decodeUnknownOption(RegistryAgent);

/** One malformed upstream entry cannot conceal every other agent. No executable comes from the renderer. */
export const readAcpRegistry = Effect.fn("AcpRegistry.catalog")(function* () {
  const bytes = yield* registryDownload(ACP_REGISTRY_URL, 8 * 1024 * 1024);
  const raw = yield* runtimeIO(() => Promise.resolve(JSON.parse(bytes.toString("utf8"))));
  const catalog = yield* decodeCatalog(raw).pipe(
    Effect.mapError(
      () => new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.registryInvalid")) }),
    ),
  );
  const entries: RegistryAgent[] = [];
  const ids = new Set<string>();
  for (const candidate of catalog.agents) {
    const entry = decodeAgent(candidate);
    if (entry._tag !== "Some" || ids.has(entry.value.id)) continue;
    ids.add(entry.value.id);
    entries.push(entry.value);
  }
  return entries;
});

/** Bounds both network time and bytes. Redirects must still end on credential-free HTTPS. */
export const registryDownload = Effect.fn("AcpRegistry.download")(function* (url: string, maximum: number) {
  return yield* runtimeIO(async (signal) => {
    const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]) });
    const destination = new URL(response.url);
    if (
      !response.ok ||
      destination.protocol !== "https:" ||
      destination.username ||
      destination.password ||
      !response.body
    )
      throw new Error(sourceText("error.provider.registryUnavailable"));
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > maximum) {
        throw new Error(sourceText("error.provider.registryInvalid"));
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  });
});
