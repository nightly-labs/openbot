import { isAvatarMimeType, isValidAvatarImage } from "@openbot/contracts/avatar-images";
import { AVATAR_IMAGE_LIMITS } from "@openbot/contracts/input-limits";
import { isUuidV4 } from "@openbot/contracts/validation";
import { Effect, Result, Schema } from "effect";
import { AuthOperationError, type AuthService, AuthServiceError } from "./auth-service";
import type { AuthUser } from "./types";

export interface StoredAvatarUpload {
  bytes: Uint8Array;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
}

export class AvatarStorageError extends Schema.TaggedError<AvatarStorageError>()("AvatarStorageError", {
  message: Schema.String,
}) {}

function avatarCall<A>(operation: () => Promise<A>): Effect.Effect<A, AvatarStorageError> {
  return Effect.tryPromise({
    try: operation,
    catch: () => new AvatarStorageError({ message: "Account avatar operation failed." }),
  });
}

export const readAvatarUpload = Effect.fn("AvatarStorage.readAvatarUpload")(function* (request: Request) {
  const mimeType = request.headers.get("Content-Type")?.split(";", 1)[0]?.trim() ?? "";
  if (!isAvatarMimeType(mimeType)) return yield* new AvatarUploadError(415, "unsupported_avatar_type");
  const declaredLength = Number(request.headers.get("Content-Length") ?? 0);
  if (declaredLength > AVATAR_IMAGE_LIMITS.storedBytes) return yield* new AvatarUploadError(413, "avatar_too_large");
  const reader = request.body?.getReader();
  if (!reader) return yield* new AvatarUploadError(400, "invalid_avatar");
  return yield* Effect.acquireUseRelease(
    Effect.succeed(reader),
    (reader) =>
      Effect.gen(function* () {
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
          const chunk = yield* avatarCall(() => reader.read());
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > AVATAR_IMAGE_LIMITS.storedBytes) {
            yield* avatarCall(() => reader.cancel()).pipe(Effect.catch(() => Effect.void));
            return yield* new AvatarUploadError(413, "avatar_too_large");
          }
          chunks.push(chunk.value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        if (!isValidAvatarImage(mimeType, bytes)) return yield* new AvatarUploadError(400, "invalid_avatar");
        return { bytes, mimeType };
      }),
    (reader) => Effect.sync(() => reader.releaseLock()),
  );
});

function updateAvatar(
  service: Pick<AuthService, "updateAvatar">,
  token: string,
  avatarUrl: string | null,
  previousUrl: string | null,
) {
  return service
    .updateAvatar(token, avatarUrl, previousUrl)
    .pipe(
      Effect.mapError((error) =>
        error instanceof AuthServiceError || error instanceof AuthOperationError
          ? error
          : new AvatarStorageError({ message: "Account avatar operation failed." }),
      ),
    );
}

export const storeAccountAvatar = Effect.fn("AvatarStorage.store")(function* (
  service: Pick<AuthService, "updateAvatar">,
  bucket: R2Bucket,
  token: string,
  user: AuthUser,
  upload: StoredAvatarUpload,
) {
  const version = crypto.randomUUID();
  const key = avatarObjectKey(user.id, version);
  yield* avatarCall(() =>
    bucket.put(key, upload.bytes, {
      httpMetadata: { contentType: upload.mimeType, cacheControl: "public, max-age=31536000, immutable" },
    }),
  );
  const avatarUrl = `/v1/avatars/${encodeURIComponent(user.id)}?v=${version}`;
  const updated = yield* Effect.result(updateAvatar(service, token, avatarUrl, user.avatarUrl));
  if (Result.isFailure(updated)) {
    yield* avatarCall(() => bucket.delete(key));
    return yield* updated.failure;
  }
  yield* deletePreviousAvatar(bucket, user);
  return updated.success;
});

/** Keep the new object only when the account still has the expected avatar. */

export const removeAccountAvatar = Effect.fn("AvatarStorage.remove")(function* (
  service: Pick<AuthService, "updateAvatar">,
  bucket: R2Bucket,
  token: string,
  user: AuthUser,
) {
  const updated = yield* updateAvatar(service, token, null, user.avatarUrl);
  yield* deletePreviousAvatar(bucket, user);
  return updated;
});

const deletePreviousAvatar = Effect.fn("AvatarStorage.deletePrevious")(function* (bucket: R2Bucket, user: AuthUser) {
  const previousVersion = avatarVersion(user.avatarUrl, user.id);
  if (previousVersion)
    yield* avatarCall(() => bucket.delete(avatarObjectKey(user.id, previousVersion))).pipe(
      Effect.catch(() => Effect.void),
    );
});

export function avatarObjectKey(userId: string, version: string): string {
  if (!isUuidV4(userId) || !isUuidV4(version)) throw new Error("Invalid avatar identifier.");
  return `users/${userId}/${version}`;
}

export function avatarVersion(avatarUrl: string | null, expectedUserId: string): string | null {
  if (!avatarUrl) return null;
  try {
    const url = new URL(avatarUrl, "https://api.openbot.run");
    const match = url.pathname.match(/^\/v1\/avatars\/([^/]+)$/u);
    const userId = decodeURIComponent(match?.[1] ?? "");
    const version = url.searchParams.get("v") ?? "";
    return userId === expectedUserId && isUuidV4(version) ? version : null;
  } catch {
    return null;
  }
}

export class AvatarUploadError extends Schema.TaggedError<AvatarUploadError>()("AvatarUploadError", {
  status: Schema.Literals([400, 413, 415]),
  code: Schema.Literals(["invalid_avatar", "avatar_too_large", "unsupported_avatar_type"]),
  message: Schema.String,
}) {
  constructor(status: 400 | 413 | 415, code: "invalid_avatar" | "avatar_too_large" | "unsupported_avatar_type") {
    super({
      status,
      code,
      message:
        code === "avatar_too_large"
          ? "The avatar image is too large."
          : code === "unsupported_avatar_type"
            ? "Choose a PNG, JPEG, or WebP image."
            : "The avatar image is invalid.",
    });
  }
}
