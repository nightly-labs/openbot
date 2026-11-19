import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AVATAR_MIME_TYPES,
  avatarFileExtension,
  isAvatarMimeType,
  isValidAvatarImage,
} from "@openbot/contracts/avatar-images";
import { Effect, Semaphore } from "effect";

const REMOTE_PICTURES_PER_SERVER = 400;

export interface RemotePicture {
  bytes: Uint8Array;
  mimeType: string;
}

interface RemotePictureKey {
  account: string;
  serverId: string;
  kind: "agent" | "channel";
  id: string;
  version: string;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

export class RemotePictureCache {
  readonly #root: string;
  readonly #changes = Semaphore.makeUnsafe(1);
  readonly #generations = new Map<string, number>();
  #epoch = 0;
  #account: string | null = null;

  constructor(root: string) {
    this.#root = root;
  }

  token(serverId: string): string {
    return `${this.#epoch}:${this.#generations.get(serverId) ?? 0}`;
  }

  readonly read = Effect.fn("RemotePictures.read")(function* (this: RemotePictureCache, key: RemotePictureKey) {
    const directory = this.#serverDirectory(hash(key.account), key.serverId);
    for (const mimeType of AVATAR_MIME_TYPES) {
      const bytes = yield* Effect.tryPromise(() => readFile(join(directory, fileName(key, mimeType)))).pipe(
        Effect.catch(() => Effect.succeed(null)),
      );
      if (bytes && isValidAvatarImage(mimeType, bytes)) return { bytes: new Uint8Array(bytes), mimeType };
    }
    return null;
  });

  readonly write = Effect.fn("RemotePictures.write")(function* (
    this: RemotePictureCache,
    key: RemotePictureKey,
    picture: RemotePicture,
    token: string,
  ) {
    const { mimeType, bytes } = picture;
    if (!isAvatarMimeType(mimeType) || !isValidAvatarImage(mimeType, bytes)) return;
    yield* this.#changes.withPermit(
      Effect.tryPromise(async () => {
        if (this.token(key.serverId) !== token) return;
        const account = hash(key.account);
        await this.#keepOnly(account);
        const directory = this.#serverDirectory(account, key.serverId);
        await mkdir(directory, { recursive: true });
        const name = fileName(key, mimeType);
        const temporary = join(directory, `${randomUUID()}.tmp`);
        try {
          await writeFile(temporary, bytes);
          await rename(temporary, join(directory, name));
        } finally {
          await rm(temporary, { force: true });
        }
        const names = (await readdir(directory)).filter((entry) => entry !== name);
        const picturePrefix = `${pictureHash(key)}.`;
        const older = names.filter((entry) => entry.startsWith(picturePrefix));
        const others = names.filter((entry) => !entry.startsWith(picturePrefix));
        const extra = others.length + 1 - REMOTE_PICTURES_PER_SERVER;
        const oldest = extra > 0 ? (await byAge(directory, others)).slice(0, extra) : [];
        for (const entry of [...older, ...oldest]) await rm(join(directory, entry), { force: true });
      }).pipe(Effect.ignore),
    );
  });

  forget(serverId: string): Effect.Effect<void> {
    this.#generations.set(serverId, (this.#generations.get(serverId) ?? 0) + 1);
    return this.#changes.withPermit(
      Effect.tryPromise(async () => {
        for (const account of await readdir(this.#root))
          await rm(this.#serverDirectory(account, serverId), { recursive: true, force: true });
      }).pipe(Effect.ignore),
    );
  }

  clear(): Effect.Effect<void> {
    this.#epoch += 1;
    this.#account = null;
    return this.#changes.withPermit(
      Effect.tryPromise(() => rm(this.#root, { recursive: true, force: true })).pipe(Effect.ignore),
    );
  }

  #serverDirectory(account: string, serverId: string): string {
    return join(this.#root, account, hash(serverId));
  }

  async #keepOnly(account: string): Promise<void> {
    if (this.#account === account) return;
    const entries = await readdir(this.#root).catch(() => []);
    for (const entry of entries)
      if (entry !== account) await rm(join(this.#root, entry), { recursive: true, force: true });
    this.#account = account;
  }
}

function pictureHash(key: RemotePictureKey): string {
  return hash(JSON.stringify([key.kind, key.id]));
}

function fileName(key: RemotePictureKey, mimeType: (typeof AVATAR_MIME_TYPES)[number]): string {
  return `${pictureHash(key)}.${hash(key.version)}.${avatarFileExtension(mimeType)}`;
}

async function byAge(directory: string, names: readonly string[]): Promise<string[]> {
  const aged = await Promise.all(
    names.map(async (name) => ({
      name,
      time: await stat(join(directory, name)).then(
        (file) => file.mtimeMs,
        () => 0,
      ),
    })),
  );
  return aged.sort((left, right) => left.time - right.time).map((entry) => entry.name);
}
