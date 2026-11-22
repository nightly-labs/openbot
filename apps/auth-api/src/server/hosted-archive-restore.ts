import { Effect, Schema } from "effect";
import { decodeBase64Url } from "./crypto";

export const ARCHIVE_DOWNLOAD_SECONDS = 60 * 60;
const WRAP_VERSION = "v1";
const ARCHIVE_ENDPOINTS: Readonly<Record<string, { host: string; region: string }>> = {
  eu: { host: "s3.eu-central-003.backblazeb2.com", region: "eu-central-003" },
};

export class HostedArchiveRestoreError extends Schema.TaggedError<HostedArchiveRestoreError>()(
  "HostedArchiveRestoreError",
  { reason: Schema.Literals(["not_configured", "unknown_region", "wrapped_key_invalid"]) },
) {}

export interface HostedArchiveKeys {
  wrapSecret: Uint8Array<ArrayBuffer>;
  keyId: string;
  applicationKey: string;
}

export interface StoredArchive {
  server_id: string;
  object_key: string;
  region: string;
  bucket: string;
  version_id: string;
  size_bytes: number;
  sha256: string;
  wrapped_key: string;
}

export interface HostedArchiveRestore {
  url: string;
  key: string;
  sha256: string;
  bytes: number;
}

export function hostedArchiveKeys(bindings: {
  HOSTED_ARCHIVE_KEY_SECRET?: string | undefined;
  B2_WORKER_KEY_ID_EU?: string | undefined;
  B2_WORKER_APPLICATION_KEY_EU?: string | undefined;
}): HostedArchiveKeys | null {
  const secret = bindings.HOSTED_ARCHIVE_KEY_SECRET?.trim() ?? "";
  const keyId = bindings.B2_WORKER_KEY_ID_EU?.trim() ?? "";
  const applicationKey = bindings.B2_WORKER_APPLICATION_KEY_EU?.trim() ?? "";
  if (!secret || !keyId || !applicationKey) return null;
  const wrapSecret = decodeSecret(secret);
  return wrapSecret?.length === 32 ? { wrapSecret, keyId, applicationKey } : null;
}

function decodeSecret(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function restoreCall<A>(
  reason: HostedArchiveRestoreError["reason"],
  operation: () => Promise<A>,
): Effect.Effect<A, HostedArchiveRestoreError> {
  return Effect.tryPromise({ try: operation, catch: () => new HostedArchiveRestoreError({ reason }) });
}

export const unwrapArchiveKey = Effect.fn("HostedArchiveRestore.unwrapKey")(function* (
  wrapSecret: Uint8Array<ArrayBuffer>,
  archive: Pick<StoredArchive, "server_id" | "object_key" | "wrapped_key">,
) {
  const [version, iv, sealed] = archive.wrapped_key.split(".");
  if (version !== WRAP_VERSION || !iv || !sealed) {
    return yield* new HostedArchiveRestoreError({ reason: "wrapped_key_invalid" });
  }
  const key = yield* restoreCall("wrapped_key_invalid", () =>
    crypto.subtle.importKey("raw", wrapSecret, "AES-GCM", false, ["decrypt"]),
  );
  const identity = yield* restoreCall("wrapped_key_invalid", () =>
    crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: decodeBase64Url(iv),
        additionalData: new TextEncoder().encode(`${archive.server_id}\n${archive.object_key}`),
      },
      key,
      decodeBase64Url(sealed),
    ),
  );
  const text = new TextDecoder().decode(identity);
  if (!/^AGE-SECRET-KEY-1[0-9A-Z]{58}$/u.test(text)) {
    return yield* new HostedArchiveRestoreError({ reason: "wrapped_key_invalid" });
  }
  return text;
});

function uriPart(value: string) {
  return encodeURIComponent(value).replace(
    /[!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const hmac = (key: Uint8Array<ArrayBuffer>, value: string) =>
  restoreCall("not_configured", async () => {
    const imported = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return new Uint8Array(await crypto.subtle.sign("HMAC", imported, new TextEncoder().encode(value)));
  });

export const presignArchiveDownload = Effect.fn("HostedArchiveRestore.presignDownload")(function* (
  keys: Pick<HostedArchiveKeys, "keyId" | "applicationKey">,
  archive: Pick<StoredArchive, "region" | "bucket" | "object_key" | "version_id">,
  now: number,
) {
  const endpoint = ARCHIVE_ENDPOINTS[archive.region];
  if (!endpoint) return yield* new HostedArchiveRestoreError({ reason: "unknown_region" });
  const time = new Date(now).toISOString().replace(/[-:]|\.\d{3}/gu, "");
  const day = time.slice(0, 8);
  const scope = `${day}/${endpoint.region}/s3/aws4_request`;
  const query = Object.entries({
    ...(archive.version_id ? { versionId: archive.version_id } : {}),
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${keys.keyId}/${scope}`,
    "X-Amz-Date": time,
    "X-Amz-Expires": String(ARCHIVE_DOWNLOAD_SECONDS),
    "X-Amz-SignedHeaders": "host",
  })
    .map(([name, value]) => `${uriPart(name)}=${uriPart(value)}`)
    .sort()
    .join("&");
  const path = `/${archive.bucket}/${archive.object_key.split("/").map(uriPart).join("/")}`;
  const request = ["GET", path, query, `host:${endpoint.host}`, "", "host", "UNSIGNED-PAYLOAD"].join("\n");
  const requestHash = yield* restoreCall("not_configured", () =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(request)),
  );
  const text = ["AWS4-HMAC-SHA256", time, scope, hex(requestHash)].join("\n");
  let signingKey = new TextEncoder().encode(`AWS4${keys.applicationKey}`);
  for (const part of [day, endpoint.region, "s3", "aws4_request"]) signingKey = yield* hmac(signingKey, part);
  const signature = yield* hmac(signingKey, text);
  return `https://${endpoint.host}${path}?${query}&X-Amz-Signature=${hex(signature.buffer)}`;
});

export const archiveRestore = Effect.fn("HostedArchiveRestore.restore")(function* (
  keys: HostedArchiveKeys | null,
  archive: StoredArchive,
  now: number,
) {
  if (!keys) return yield* new HostedArchiveRestoreError({ reason: "not_configured" });
  const key = yield* unwrapArchiveKey(keys.wrapSecret, archive);
  const url = yield* presignArchiveDownload(keys, archive, now);
  return { url, key, sha256: archive.sha256, bytes: archive.size_bytes } satisfies HostedArchiveRestore;
});
