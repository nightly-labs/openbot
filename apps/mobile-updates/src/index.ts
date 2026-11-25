import { Context, Effect, Layer, Schema } from "effect";
import {
  ASSET_HASH_PATTERN,
  assetKey,
  CHANNEL_PATTERN,
  decodeStoredUpdate,
  decodeUpdatePointer,
  isUpdatePlatform,
  pointerKey,
  RUNTIME_VERSION_PATTERN,
  rolloutBucket,
  type StoredDirective,
  type StoredUpdate,
  UPDATE_ID_PATTERN,
  updateKey,
} from "./protocol";

export interface UpdateObject {
  readonly body: ReadableStream;
  readonly size: number;
  readonly httpEtag: string;
  readonly httpMetadata?: { contentType?: string };
  text(): Promise<string>;
}

interface UpdateBucket {
  get(key: string): Promise<UpdateObject | null>;
}

interface MobileUpdatesEnv {
  UPDATES: UpdateBucket;
}

export interface MobileUpdatesRuntime {
  cache: Pick<Cache, "match" | "put">;
  schedule(work: Effect.Effect<void>): void;
}

const POINTER_CACHE_SECONDS = 30;
const UPDATE_CACHE_SECONDS = 24 * 60 * 60;
const ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";

export default {
  async fetch(request: Request, env: MobileUpdatesEnv, ctx: ExecutionContext): Promise<Response> {
    try {
      return await Effect.runPromise(
        Effect.gen(function* () {
          const cache = yield* openCache();
          return yield* routeRequest(
            request,
            env,
            cache ? { cache, schedule: (work) => ctx.waitUntil(Effect.runPromise(work)) } : undefined,
          );
        }),
      );
    } catch (error) {
      console.error(JSON.stringify({ event: "mobile_updates_error", message: errorMessage(error) }));
      return textResponse(500, "The update server failed.");
    }
  },
} satisfies ExportedHandler<MobileUpdatesEnv>;

class UpdateStorageError extends Schema.TaggedError<UpdateStorageError>()("UpdateStorageError", {
  message: Schema.String,
}) {}

const storageCall = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({
    try: operation,
    catch: (error) => new UpdateStorageError({ message: errorMessage(error) }),
  });

class UpdateStorage extends Context.Service<
  UpdateStorage,
  {
    get(key: string): Effect.Effect<UpdateObject | null, UpdateStorageError>;
  }
>()("@openbot/mobile-updates/UpdateStorage") {
  static layer(bucket: UpdateBucket) {
    return Layer.succeed(
      UpdateStorage,
      UpdateStorage.of({
        get: Effect.fn("UpdateStorage.get")((key: string) => storageCall(() => bucket.get(key))),
      }),
    );
  }
}

const openCache = Effect.fn("MobileUpdates.openCache")(() =>
  storageCall(() => caches.open("openbot-mobile-updates-v1")).pipe(
    Effect.catch((error) => {
      console.error(JSON.stringify({ event: "mobile_updates_cache_open_error", message: error.message }));
      return Effect.succeed(undefined);
    }),
  ),
);

export const routeRequest = Effect.fn("MobileUpdates.routeRequest")(
  function* (request: Request, _env: MobileUpdatesEnv, runtime?: MobileUpdatesRuntime) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      const response = textResponse(405, "Use GET.");
      response.headers.set("Allow", "GET, HEAD");
      return response;
    }
    const url = new URL(request.url);
    const response = yield* routeGet(request, url, runtime);
    return request.method === "HEAD" ? new Response(null, response) : response;
  },
  (operation, _request, env, _runtime?: MobileUpdatesRuntime) =>
    operation.pipe(Effect.provide(UpdateStorage.layer(env.UPDATES))),
);

const routeGet = Effect.fn("MobileUpdates.routeGet")(function* (
  request: Request,
  url: URL,
  runtime: MobileUpdatesRuntime | undefined,
) {
  if (url.pathname === "/manifest") return yield* manifestResponse(request, url, runtime);
  if (url.pathname.startsWith("/assets/")) {
    return yield* assetResponse(url, url.pathname.slice("/assets/".length), runtime);
  }
  if (url.pathname === "/") return textResponse(200, "OpenBot mobile updates.");
  return textResponse(404, "Not found.");
});

const manifestResponse = Effect.fn("MobileUpdates.manifestResponse")(function* (
  request: Request,
  url: URL,
  runtime: MobileUpdatesRuntime | undefined,
) {
  const headers = request.headers;
  const platform = headers.get("expo-platform");
  const runtimeVersion = headers.get("expo-runtime-version") ?? "";
  const channel = headers.get("expo-channel-name") ?? "";
  if (!isUpdatePlatform(platform)) return textResponse(400, "The expo-platform header must be ios or android.");
  if (!RUNTIME_VERSION_PATTERN.test(runtimeVersion)) {
    return textResponse(400, "The expo-runtime-version header is missing or not valid.");
  }
  if (!CHANNEL_PATTERN.test(channel)) return textResponse(400, "The expo-channel-name header is missing or not valid.");
  if (headers.get("expo-protocol-version") !== "1") return textResponse(400, "Use expo-protocol-version 1.");

  const pointer = yield* readJson(
    url,
    pointerKey(channel, platform, runtimeVersion),
    POINTER_CACHE_SECONDS,
    decodeUpdatePointer,
    runtime,
  );
  if (!pointer) return noUpdateResponse();

  const signed = headers.has("expo-expect-signature");
  const currentId = headers.get("expo-current-update-id")?.toLowerCase() ?? null;
  const target = pointer.target;
  if (target.kind === "embedded") {
    const embeddedId = headers.get("expo-embedded-update-id")?.toLowerCase() ?? null;
    if (!embeddedId || embeddedId === currentId) return noUpdateResponse();
    return partResponse("directive", target.directive, signed) ?? unsignedResponse("directive", channel, platform);
  }

  const inRollout =
    target.rollout === 100 || (yield* isInRollout(headers.get("eas-client-id"), target.id, target.rollout));
  const id = inRollout ? target.id : target.baseId;
  if (!id || id === currentId || failedUpdateIds(headers.get("expo-recent-failed-update-ids")).has(id)) {
    return noUpdateResponse();
  }
  const update = yield* readJson(url, updateKey(id), UPDATE_CACHE_SECONDS, decodeStoredUpdate, runtime);
  if (!update || !matches(update, channel, platform, runtimeVersion)) {
    console.error(JSON.stringify({ event: "mobile_updates_update_missing", id, channel, platform, runtimeVersion }));
    return noUpdateResponse();
  }
  return (
    partResponse("manifest", { body: update.manifest, signature: update.signature }, signed) ??
    unsignedResponse("manifest", channel, platform)
  );
});

function matches(update: StoredUpdate, channel: string, platform: string, runtimeVersion: string): boolean {
  return update.channel === channel && update.platform === platform && update.runtimeVersion === runtimeVersion;
}

const isInRollout = Effect.fn("MobileUpdates.isInRollout")(function* (
  clientId: string | null,
  updateId: string,
  rollout: number,
) {
  if (!clientId) return false;
  const bucket = yield* Effect.promise(() => rolloutBucket(clientId.toLowerCase(), updateId));
  return bucket < rollout;
});

function failedUpdateIds(header: string | null): Set<string> {
  const ids = new Set<string>();
  for (const part of header?.toLowerCase().split(",") ?? []) {
    const id = part.trim().replace(/^"|"$/gu, "");
    if (UPDATE_ID_PATTERN.test(id)) ids.add(id);
  }
  return ids;
}

const readJson = Effect.fn("MobileUpdates.readJson")(function* <A>(
  url: URL,
  key: string,
  cacheSeconds: number,
  decode: (text: string) => A | null,
  runtime: MobileUpdatesRuntime | undefined,
) {
  const storage = yield* UpdateStorage;
  const cacheRequest = new Request(new URL(`/_cache/${key}`, url.origin), { method: "GET" });
  if (runtime) {
    const cached = yield* readCache(runtime.cache, cacheRequest);
    if (cached !== undefined) return decode(cached);
  }
  const object = yield* storage.get(key);
  const text = object ? yield* storageCall(() => object.text()) : "null";
  if (runtime) {
    const cacheResponse = new Response(text, {
      headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${cacheSeconds}` },
    });
    runtime.schedule(writeCache(runtime.cache, cacheRequest, cacheResponse));
  }
  return decode(text);
});

const readCache = (cache: Pick<Cache, "match">, request: Request) =>
  storageCall(async () => {
    const cached = await cache.match(request);
    return cached?.status === 200 ? await cached.text() : undefined;
  }).pipe(
    Effect.catch((error) => {
      console.error(JSON.stringify({ event: "mobile_updates_cache_read_error", message: error.message }));
      return Effect.succeed(undefined);
    }),
  );

const writeCache = (cache: Pick<Cache, "put">, request: Request, response: Response) =>
  storageCall(() => cache.put(request, response)).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        console.error(JSON.stringify({ event: "mobile_updates_cache_write_error", message: error.message }));
      }),
    ),
  );

const assetResponse = Effect.fn("MobileUpdates.assetResponse")(function* (
  url: URL,
  hash: string,
  runtime: MobileUpdatesRuntime | undefined,
) {
  if (!ASSET_HASH_PATTERN.test(hash)) return textResponse(404, "Not found.");
  const storage = yield* UpdateStorage;
  const cacheRequest = new Request(new URL(`/assets/${hash}`, url.origin), { method: "GET" });
  if (runtime) {
    const cached = yield* storageCall(() => runtime.cache.match(cacheRequest)).pipe(
      Effect.catch(() => Effect.succeed(undefined)),
    );
    if (cached?.status === 200) return cached;
  }
  const object = yield* storage.get(assetKey(hash));
  if (!object) return textResponse(404, "Not found.");
  const response = new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "Content-Length": String(object.size),
      "Cache-Control": ASSET_CACHE_CONTROL,
      ETag: object.httpEtag,
      "X-Content-Type-Options": "nosniff",
    },
  });
  if (runtime) runtime.schedule(writeCache(runtime.cache, cacheRequest, response.clone()));
  return response;
});

function protocolHeaders(): Headers {
  return new Headers({
    "expo-protocol-version": "1",
    "expo-sfv-version": "0",
    "Cache-Control": "private, max-age=0",
    "X-Content-Type-Options": "nosniff",
  });
}

function noUpdateResponse(): Response {
  return new Response(null, { status: 204, headers: protocolHeaders() });
}

function partResponse(name: "manifest" | "directive", part: StoredDirective, signed: boolean): Response | null {
  if (signed && part.signature === null) return null;
  const boundary = `openbot-${crypto.randomUUID()}`;
  const lines = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="${name}"`,
    "Content-Type: application/json; charset=utf-8",
    ...(signed && part.signature !== null ? [`expo-signature: ${part.signature}`] : []),
    "",
    part.body,
  ];
  if (name === "manifest") {
    lines.push(
      `--${boundary}`,
      'Content-Disposition: form-data; name="extensions"',
      "Content-Type: application/json",
      "",
      '{"assetRequestHeaders":{}}',
    );
  }
  lines.push(`--${boundary}--`, "");
  const headers = protocolHeaders();
  headers.set("Content-Type", `multipart/mixed; boundary=${boundary}`);
  return new Response(lines.join("\r\n"), { status: 200, headers });
}

function unsignedResponse(name: string, channel: string, platform: string): Response {
  console.error(JSON.stringify({ event: "mobile_updates_unsigned_part", part: name, channel, platform }));
  return noUpdateResponse();
}

function textResponse(status: number, text: string): Response {
  return new Response(`${text}\n`, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
}
