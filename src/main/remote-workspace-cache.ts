import { createHash } from "node:crypto";
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  type AgentSummary,
  type ConversationMessage,
  type ConversationReadState,
  isRemoteWorkspaceCache,
  REMOTE_WORKSPACE_CACHE_LIMITS,
  type RemoteWorkspaceCache,
  type RemoteWorkspaceCacheConversation,
  type RemoteWorkspaceCachePreference,
  type SaveRemoteConversationInput,
  type SaveRemoteWorkspaceInput,
} from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { Effect, Result, Semaphore } from "effect";
import { writeJsonFileAtomically } from "../backend/atomic-json-file";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

/** The secret storage that the copy is encrypted with. Without it, nothing is kept. */
export interface RemoteWorkspaceCacheCipher {
  canPersist: () => boolean;
  encrypt: (value: string) => Buffer;
  decrypt: (value: Buffer) => string;
}

export interface RemoteWorkspaceCacheOptions {
  /** The directory that holds the copies: one directory per account, one file per server. */
  directory: string;
  preferencePath: string;
  cipher: RemoteWorkspaceCacheCipher;
  now?: () => Date;
}

interface StoredCopy extends RemoteWorkspaceCache {
  version: 1;
  principalId: string;
}

const COPY_VERSION = 1;

/**
 * The optional saved copy of each joined server, so that a launch can show the last known sidebar and
 * the latest messages of recent chats while the server connects.
 *
 * A conversation of a joined server otherwise stays only on the computer that runs the server, so the
 * copy is off until the user turns it on, and it keeps little: the roster, the unread counts, the
 * sidebar layout, and the latest messages of the few most recent chats, without attachments. The file
 * is encrypted with the same secret storage as the server tokens, and nothing is kept without it.
 *
 * Main, not the renderer, decides whose copy a request reaches. The account is the signed-in account
 * that `setPrincipal` names, and the server must be one of the joined servers that `setServers` names.
 * The copies of every other account are deleted when the account changes or signs out, a server's copy
 * is deleted when the server leaves the list, and every copy is deleted when the setting is turned off.
 * One permit orders the reads, writes and deletes, so a write that was queued before a delete cannot
 * put the copy back after it.
 *
 * Nothing here logs: a failure deletes the copy it concerns and reads as no copy.
 */
export class RemoteWorkspaceCacheStore {
  readonly #directory: string;
  readonly #preferencePath: string;
  readonly #cipher: RemoteWorkspaceCacheCipher;
  readonly #now: () => Date;
  readonly #permit = Semaphore.makeUnsafe(1);
  #enabled = false;
  #principalId: string | null = null;
  #serverIds: ReadonlySet<string> = new Set();

  constructor(options: RemoteWorkspaceCacheOptions) {
    this.#directory = options.directory;
    this.#preferencePath = options.preferencePath;
    this.#cipher = options.cipher;
    this.#now = options.now ?? (() => new Date());
  }

  load(): Effect.Effect<void, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      const loaded = yield* Effect.result(
        readPreferenceFile(this.#preferencePath, (parsed): boolean | null =>
          isDynamicRecord(parsed) && parsed.version === 1 && isBoolean(parsed.enabled) ? parsed.enabled : null,
        ),
      );
      if (Result.isSuccess(loaded)) {
        if (loaded.success !== null) this.#enabled = loaded.success;
      } else if (!isMissingFileError(loaded.failure.cause) && !(loaded.failure.cause instanceof SyntaxError))
        return yield* loaded.failure;
      // A copy left behind while the setting was off, by a crash during the delete, goes now.
      if (!this.#enabled) yield* this.#withPermit(this.#removeAll());
    });
  }

  preference(): RemoteWorkspaceCachePreference {
    return { enabled: this.#enabled };
  }

  readonly setEnabled = Effect.fn("RemoteWorkspaceCache.setEnabled")(function* (
    this: RemoteWorkspaceCacheStore,
    { enabled }: RemoteWorkspaceCachePreference,
  ) {
    yield* this.#permit.withPermit(
      Effect.uninterruptible(
        Effect.gen({ self: this }, function* () {
          yield* writePreferenceFile(this.#preferencePath, { version: 1, enabled });
          this.#enabled = enabled;
          if (!enabled) yield* this.#removeAll();
        }),
      ),
    );
    return this.preference();
  });

  /**
   * The signed-in account, or null when nobody is signed in. Another account's copies are deleted, and
   * signing out deletes all of them. The value applies at once to the requests that follow, also
   * while the delete waits for the permit.
   */
  setPrincipal(principalId: string | null): Effect.Effect<void> {
    this.#principalId = principalId;
    return this.#withPermit(
      principalId === null ? this.#removeAll() : this.#removeOtherPrincipals(principalKey(principalId)),
    );
  }

  /** The joined servers that may keep a copy. The copy of each other server is deleted. */
  setServers(serverIds: Iterable<string>): Effect.Effect<void> {
    this.#serverIds = new Set(serverIds);
    const keep = new Set([...this.#serverIds].map(serverKey));
    return this.#withPermit(this.#removeServersExcept(keep));
  }

  read(serverId: string): Effect.Effect<RemoteWorkspaceCache | null> {
    return this.#withPermit(
      Effect.gen({ self: this }, function* () {
        const target = this.#target(serverId);
        if (!target) return null;
        const stored = yield* this.#readCopy(target);
        if (!stored) return null;
        const { version: _version, principalId: _principalId, ...copy } = stored;
        return copy;
      }),
    );
  }

  saveWorkspace(input: SaveRemoteWorkspaceInput): Effect.Effect<void> {
    return this.#withPermit(
      Effect.gen({ self: this }, function* () {
        const target = this.#target(input.serverId);
        if (!target) return;
        const previous = yield* this.#readCopy(target);
        const agents = input.agents.slice(0, REMOTE_WORKSPACE_CACHE_LIMITS.agents).map(savedAgent);
        const agentIds = new Set(agents.map((agent) => agent.id));
        yield* this.#writeCopy(target, {
          version: COPY_VERSION,
          principalId: target.principalId,
          serverId: input.serverId,
          savedAt: this.#now().toISOString(),
          memberId: input.memberId,
          agents,
          reads: savedReads(input.reads, agentIds),
          layout: input.layout,
          conversations: (previous?.conversations ?? []).filter((conversation) => agentIds.has(conversation.agentId)),
        });
      }),
    );
  }

  /** The latest messages of one chat. A chat of an agent that the saved roster does not list is not kept. */
  saveConversation(input: SaveRemoteConversationInput): Effect.Effect<void> {
    return this.#withPermit(
      Effect.gen({ self: this }, function* () {
        const target = this.#target(input.serverId);
        if (!target) return;
        const previous = yield* this.#readCopy(target);
        if (!previous?.agents.some((agent) => agent.id === input.agentId)) return;
        const conversation: RemoteWorkspaceCacheConversation = {
          agentId: input.agentId,
          messages: savedMessages(input.messages),
        };
        yield* this.#writeCopy(target, {
          ...previous,
          savedAt: this.#now().toISOString(),
          conversations: [
            conversation,
            ...previous.conversations.filter((candidate) => candidate.agentId !== input.agentId),
          ].slice(0, REMOTE_WORKSPACE_CACHE_LIMITS.conversations),
        });
      }),
    );
  }

  /** Where the copy of a server is, or null when this request may not reach a copy. */
  #target(serverId: string): { path: string; principalId: string; serverId: string } | null {
    const principalId = this.#principalId;
    if (!this.#enabled || principalId === null || !this.#serverIds.has(serverId) || !this.#cipher.canPersist()) {
      return null;
    }
    return {
      path: join(this.#directory, principalKey(principalId), `${serverKey(serverId)}.json`),
      principalId,
      serverId,
    };
  }

  #readCopy(target: { path: string; principalId: string; serverId: string }): Effect.Effect<StoredCopy | null> {
    return Effect.tryPromise({
      try: async () => {
        const file = await readFile(target.path, "utf8");
        return storedCopyFromFile(JSON.parse(file), target, (data) => JSON.parse(this.#cipher.decrypt(data)));
      },
      catch: (cause) => cause,
    }).pipe(
      Effect.catch((cause) => Effect.succeed(isMissingFileError(cause) ? null : ("unreadable" as const))),
      Effect.flatMap((copy) =>
        // An unreadable copy is deleted, so the next save starts clean. A missing one is only missing.
        copy === "unreadable" ? removePath(target.path).pipe(Effect.as(null)) : Effect.succeed(copy),
      ),
    );
  }

  #writeCopy(target: { path: string }, copy: StoredCopy): Effect.Effect<void> {
    return Effect.try({
      try: () => this.#cipher.encrypt(JSON.stringify(copy)).toString("base64"),
      catch: (cause) => cause,
    }).pipe(
      Effect.flatMap((data) =>
        writeJsonFileAtomically(target.path, { version: COPY_VERSION, data }, { createDirectory: true }),
      ),
      Effect.catch(() => removePath(target.path)),
    );
  }

  #removeAll(): Effect.Effect<void> {
    return removePath(this.#directory);
  }

  #removeOtherPrincipals(keep: string): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      for (const name of yield* listDirectory(this.#directory)) {
        if (name !== keep) yield* removePath(join(this.#directory, name));
      }
    });
  }

  #removeServersExcept(keep: ReadonlySet<string>): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      for (const principal of yield* listDirectory(this.#directory)) {
        const principalDirectory = join(this.#directory, principal);
        for (const name of yield* listDirectory(principalDirectory)) {
          if (!keep.has(name.replace(/\.json$/, ""))) yield* removePath(join(principalDirectory, name));
        }
      }
    });
  }

  #withPermit<A>(effect: Effect.Effect<A>): Effect.Effect<A> {
    return this.#permit.withPermit(Effect.uninterruptible(effect));
  }
}

/**
 * The copy in a file, or "unreadable". The names inside the encrypted copy must match the request too,
 * so a file moved to another account's or server's path reads as no copy.
 */
function storedCopyFromFile(
  file: unknown,
  target: { principalId: string; serverId: string },
  decrypt: (data: Buffer) => unknown,
): StoredCopy | "unreadable" {
  if (!isDynamicRecord(file) || file.version !== COPY_VERSION || !isString(file.data)) return "unreadable";
  return storedCopyFromRecord(decrypt(Buffer.from(file.data, "base64")), target);
}

function storedCopyFromRecord(
  stored: unknown,
  target: { principalId: string; serverId: string },
): StoredCopy | "unreadable" {
  if (
    !isDynamicRecord(stored) ||
    stored.version !== COPY_VERSION ||
    stored.principalId !== target.principalId ||
    stored.serverId !== target.serverId
  ) {
    return "unreadable";
  }
  const { version: _version, principalId: _principalId, ...copy } = stored;
  return isRemoteWorkspaceCache(copy)
    ? { ...copy, version: COPY_VERSION, principalId: target.principalId }
    : "unreadable";
}

function principalKey(principalId: string): string {
  return digest(`principal:${principalId}`);
}

function serverKey(serverId: string): string {
  return digest(`server:${serverId}`);
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function listDirectory(path: string): Effect.Effect<string[]> {
  return Effect.tryPromise({ try: () => readdir(path), catch: (cause) => cause }).pipe(
    Effect.catch(() => Effect.succeed<string[]>([])),
  );
}

function removePath(path: string): Effect.Effect<void> {
  return Effect.tryPromise({ try: () => rm(path, { recursive: true, force: true }), catch: (cause) => cause }).pipe(
    Effect.catch(() => Effect.void),
  );
}

/** The roster row without its avatar address, which names the host, and with a short preview. */
function savedAgent(agent: AgentSummary): AgentSummary {
  return { ...agent, avatarUrl: null, preview: agent.preview.slice(0, REMOTE_WORKSPACE_CACHE_LIMITS.preview) };
}

function savedReads(
  reads: Record<string, ConversationReadState>,
  agentIds: ReadonlySet<string>,
): Record<string, ConversationReadState> {
  return Object.fromEntries(
    Object.entries(reads)
      .filter(([agentId]) => agentIds.has(agentId))
      .map(([agentId, state]) => [
        agentId,
        {
          unreadCount: state.unreadCount,
          firstUnreadMessageId: state.firstUnreadMessageId,
          throughMessageId: state.throughMessageId,
        },
      ]),
  );
}

/**
 * The latest finished messages, as text. Attachments, generated images, question prompts and queue
 * state stay with the host: the copy is for reading, and each of these would offer an action that only
 * the host can do, or keep a file on this computer.
 */
function savedMessages(messages: readonly ConversationMessage[]): ConversationMessage[] {
  return messages
    .filter((message) => message.status !== "streaming")
    .slice(-REMOTE_WORKSPACE_CACHE_LIMITS.messages)
    .map(
      ({
        attachments: _attachments,
        imageGeneration: _image,
        questionPrompt: _prompt,
        delivery: _delivery,
        ...message
      }) => ({
        ...message,
        text: message.text.slice(0, REMOTE_WORKSPACE_CACHE_LIMITS.messageText),
      }),
    );
}
