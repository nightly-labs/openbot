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

// The pictures of the agents and channels of joined servers that this computer already downloaded,
// kept on disk.
//
// A picture reaches the renderer through `openbot-remote-avatar`, which asks the host for its bytes.
// While the host is offline, such as during its restart for an update, the saved workspace showed
// each agent with its generated avatar, and the user thought that the picture was lost. A picture
// URL names a version whose bytes do not change, so a copy is safe to use again.
//
// A copy skips the host's check of the account. Thus the copies are of one account only, and they
// are deleted on sign-out, when the server leaves the list, and when the host ends access.

/** The pictures that one server keeps. The oldest copies go first. */
const REMOTE_PICTURES_PER_SERVER = 400;

export interface RemotePicture {
  bytes: Uint8Array;
  mimeType: string;
}

interface RemotePictureKey {
  /** The signed-in account. A copy of one account is never shown to another. */
  account: string;
  serverId: string;
  kind: "agent" | "channel";
  id: string;
  /** The version in the picture URL. A new picture has a new version. */
  version: string;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

export class RemotePictureCache {
  readonly #root: string;
  // One change of the directory at a time, so a delete cannot run between the check and the write
  // of a download that started before it.
  readonly #changes = Semaphore.makeUnsafe(1);
  // A download that started before `forget` or `clear` must not store its result after it.
  readonly #generations = new Map<string, number>();
  #epoch = 0;
  /** The account whose directory is the only one in the root. */
  #account: string | null = null;

  constructor(root: string) {
    this.#root = root;
  }

  /** The state of a server before a download. `write` stores only while it is the same. */
  token(serverId: string): string {
    return `${this.#epoch}:${this.#generations.get(serverId) ?? 0}`;
  }

  /** The saved picture, or null. A file that cannot be read or is not a picture is a miss. */
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

  /** Saves a picture and removes the older versions of it. A failure keeps no copy. */
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

  /**
   * Deletes the pictures of one server. The state changes at the call, so a download that is in
   * progress stores nothing; the returned Effect deletes the files.
   */
  forget(serverId: string): Effect.Effect<void> {
    this.#generations.set(serverId, (this.#generations.get(serverId) ?? 0) + 1);
    return this.#changes.withPermit(
      Effect.tryPromise(async () => {
        for (const account of await readdir(this.#root))
          await rm(this.#serverDirectory(account, serverId), { recursive: true, force: true });
      }).pipe(Effect.ignore),
    );
  }

  /** Deletes the pictures of all servers, as after a sign-out. See `forget` for the two steps. */
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

  /** Removes the directories of other accounts, once for each account that writes. */
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
