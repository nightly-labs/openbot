import { createHash, randomUUID } from "node:crypto";
import type { EventEmitter } from "node:events";
import { createWriteStream } from "node:fs";
import { type FileHandle, mkdir, open, readFile, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { isString } from "@openbot/contracts/runtime-values";
import {
  decodeTeamProtocolV2FileChunk,
  decodeTeamProtocolV2FileControlFrame,
  encodeTeamProtocolV2FileChunk,
  encodeTeamProtocolV2Frame,
  TEAM_PROTOCOL_V2_MAX_FILE_BYTES,
  TEAM_PROTOCOL_V2_MAX_FILE_SET_BYTES,
  type TeamProtocolV2FileControlFrame,
} from "@openbot/contracts/team-protocol/v2";
import { sourceText } from "@openbot/i18n/source";
import { Deferred, Effect, Result, Semaphore } from "effect";
import { sha256File } from "../backend/file-hash";
import { recordRestartActivity } from "../backend/restart-activity";
import { RemoteWorkflowError, remoteCall, remoteDecode, toRemoteWorkflowError } from "./remote-service-effects";
import type { TeamWebRtcBridge } from "./team-webrtc-bridge";

const FILE_CHUNK_BYTES = 60 * 1024;
const ACK_INTERVAL_BYTES = 1024 * 1024;
const TRANSFER_RESUME_MILLISECONDS = 10 * 60_000;
const STOPPED_WATCH_MILLISECONDS = 60_000;

type BridgeEvents = TeamWebRtcBridge extends EventEmitter<infer Events> ? Events : never;
type FileOpenFrame = Extract<TeamProtocolV2FileControlFrame, { type: "file-open" }>;
type FileTransferBridge = Pick<EventEmitter<BridgeEvents>, "on" | "off"> &
  Pick<TeamWebRtcBridge, "send" | "disconnectPeer">;

interface IncomingTransfer {
  peerId: string;
  transferId: string;
  name: string;
  mimeType: string;
  size: number;
  sha256: string;
  path: string;
  file: FileHandle;
  received: number;
  lastAcknowledged: number;
}

interface OutgoingTransfer {
  peerId: string;
  transferId: string;
  name: string;
  mimeType: string;
  size: number;
  read: (offset: number, length: number) => Promise<Uint8Array>;
  sha256: string;
  acknowledged: number;
  acknowledgementGeneration: number;
  lastProgressAt: number;
  cancelled: Error | null;
  onProgress?: ((acknowledged: number, size: number) => void) | undefined;
}

interface IncomingWatch {
  peerId: string;
  size: number;
  onProgress: (received: number, size: number) => void;
  transferId: string | null;
  taken: string[];
  stopped: boolean;
}

export interface IncomingFileWatch {
  end: (answered: string | null) => void;
  stop: Effect.Effect<void>;
}

export interface ReceivedWebRtcFile {
  peerId: string;
  transferId: string;
  name: string;
  mimeType: string;
  size: number;
  path: string;
}

export class TeamFileTooLargeError extends Error {}

export class TeamWebRtcFileTransfer {
  readonly #bridge: FileTransferBridge;
  readonly #writingAbort = new AbortController();
  readonly #operations = new Set<Deferred.Deferred<void>>();
  readonly #directory: string;
  readonly #resumeMilliseconds: number;
  readonly #acceptPeer: (peerId: string) => boolean;
  readonly #incoming = new Map<string, IncomingTransfer>();
  readonly #outgoing = new Map<string, OutgoingTransfer>();
  readonly #writing = new Set<{ peerId: string; size: number }>();
  readonly #completed = new Map<string, ReceivedWebRtcFile>();
  readonly #waitingOpens = new Map<string, { peerId: string; frame: FileOpenFrame }>();
  readonly #watches = new Set<IncomingWatch>();
  readonly #expirationTimers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #waiters = new Map<
    string,
    {
      resolve: (file: ReceivedWebRtcFile) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  #frames = Semaphore.makeUnsafe(1);
  #lastFrame: Deferred.Deferred<void> | null = null;
  readonly #connectedPeers = new Set<string>();
  readonly #stateWaiters = new Set<() => void>();
  #stopped = false;

  constructor(
    bridge: FileTransferBridge,
    directory: string,
    resumeMilliseconds = TRANSFER_RESUME_MILLISECONDS,
    acceptPeer: (peerId: string) => boolean = () => true,
  ) {
    this.#bridge = bridge;
    this.#directory = directory;
    this.#resumeMilliseconds = resumeMilliseconds;
    this.#acceptPeer = acceptPeer;
    bridge.on("data", this.#onData);
    bridge.on("disconnected", this.#onDisconnected);
  }

  setPeerAuthenticated(peerId: string, authenticated: boolean): void {
    if (authenticated) this.#connectedPeers.add(peerId);
    else this.#connectedPeers.delete(peerId);
    this.#notifyStateChange();
  }

  hasActiveTransfers(): boolean {
    return this.#incoming.size > 0 || this.#outgoing.size > 0 || this.#writing.size > 0 || this.#waitingOpens.size > 0;
  }

  readonly send = Effect.fn("TeamFileTransfer.send")(function* (
    this: TeamWebRtcFileTransfer,
    peerId: string,
    input: {
      name: string;
      mimeType: string;
      bytes: Uint8Array;
      onProgress?: ((acknowledged: number, size: number) => void) | undefined;
    },
  ): Effect.fn.Return<string, RemoteWorkflowError> {
    return yield* this.#owned(
      Effect.gen({ self: this }, function* () {
        const { bytes } = input;
        yield* remoteDecode(() => this.#checkOutgoing(bytes.byteLength));
        return yield* this.#sendOutgoingEffect(peerId, {
          name: input.name,
          mimeType: input.mimeType,
          size: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          read: async (offset, length) => bytes.subarray(offset, offset + length),
          onProgress: input.onProgress,
        });
      }),
    );
  }).bind(this);

  readonly sendStream = Effect.fn("TeamFileTransfer.sendStream")(function* (
    this: TeamWebRtcFileTransfer,
    peerId: string,
    input: { name: string; mimeType: string; body: AsyncIterable<Uint8Array> | Iterable<Uint8Array> },
  ): Effect.fn.Return<{ transferId: string; size: number }, RemoteWorkflowError> {
    return yield* this.#owned(
      Effect.gen({ self: this }, function* () {
        if (this.#stopped)
          return yield* new RemoteWorkflowError({
            cause: new Error(sourceText("error.remote.fileTransportIsStopped")),
          });
        yield* remoteCall(() => mkdir(this.#directory, { recursive: true, mode: 0o700 }));
        const path = join(this.#directory, `${randomUUID()}.outgoing`);
        let file: FileHandle | null = null;
        const pending = { peerId, size: 0 };
        return yield* Effect.acquireUseRelease(
          Effect.sync(() => {
            this.#writing.add(pending);
            recordRestartActivity();
          }),
          () =>
            Effect.gen({ self: this }, function* () {
              const hash = createHash("sha256");
              const check = (size: number) => this.#checkOutgoing(size);
              yield* remoteCall(() =>
                pipeline(
                  Readable.from(input.body),
                  async function* (chunks: AsyncIterable<Uint8Array>) {
                    for await (const chunk of chunks) {
                      pending.size += chunk.byteLength;
                      check(pending.size);
                      hash.update(chunk);
                      yield chunk;
                    }
                  },
                  createWriteStream(path, { flags: "wx", mode: 0o600 }),
                  { signal: this.#writingAbort.signal },
                ),
              );
              const size = pending.size;
              const source = yield* remoteCall(() => open(path, "r"));
              file = source;
              this.#writing.delete(pending);
              yield* remoteDecode(() => this.#checkOutgoing(size));
              const transferId = yield* this.#sendOutgoingEffect(peerId, {
                name: input.name,
                mimeType: input.mimeType,
                size,
                sha256: hash.digest("hex"),
                read: async (offset, length) => {
                  const bytes = new Uint8Array(length);
                  const { bytesRead } = await source.read(bytes, 0, length, offset);
                  if (bytesRead !== length) throw new Error("The outgoing WebRTC file is incomplete.");
                  return bytes;
                },
              });
              return { transferId, size };
            }),
          () =>
            Effect.gen({ self: this }, function* () {
              this.#writing.delete(pending);
              yield* remoteCall(() => (file ? file.close() : Promise.resolve())).pipe(Effect.catch(() => Effect.void));
              yield* remoteCall(() => rm(path, { force: true }));
            }),
        );
      }),
    );
  }).bind(this);

  #checkOutgoing(size: number): void {
    if (this.#stopped) throw new Error(sourceText("error.remote.fileTransportIsStopped"));
    if (size > TEAM_PROTOCOL_V2_MAX_FILE_BYTES)
      throw new TeamFileTooLargeError(sourceText("error.remote.fileTooLarge"));
  }

  #reserveOutgoing(transfer: OutgoingTransfer): boolean {
    const activeBytes = [...this.#outgoing.values()]
      .filter((item) => item.peerId === transfer.peerId)
      .reduce((sum, item) => sum + item.size, 0);
    if (activeBytes + transfer.size > TEAM_PROTOCOL_V2_MAX_FILE_SET_BYTES) return false;
    transfer.lastProgressAt = Date.now();
    this.#outgoing.set(transferKey(transfer.peerId, transfer.transferId), transfer);
    return true;
  }

  readonly #sendOutgoingEffect = Effect.fn("TeamFileTransfer.sendOutgoing")(function* (
    this: TeamWebRtcFileTransfer,
    peerId: string,
    input: Pick<OutgoingTransfer, "name" | "mimeType" | "size" | "sha256" | "read" | "onProgress">,
  ): Effect.fn.Return<string, RemoteWorkflowError> {
    const transferId = randomUUID();
    const transfer: OutgoingTransfer = {
      peerId,
      transferId,
      name: basename(input.name) || "file",
      mimeType: input.mimeType || "application/octet-stream",
      size: input.size,
      read: input.read,
      sha256: input.sha256,
      acknowledged: 0,
      acknowledgementGeneration: 0,
      lastProgressAt: Date.now(),
      cancelled: null,
      onProgress: input.onProgress,
    };
    return yield* Effect.gen({ self: this }, function* () {
      yield* this.#waitUntilEffect(() => this.#reserveOutgoing(transfer), Date.now() + this.#resumeMilliseconds).pipe(
        Effect.mapError((error) =>
          this.#stopped
            ? error
            : new RemoteWorkflowError({ cause: new Error(sourceText("error.remote.fileSetTooLarge")) }),
        ),
      );
      recordRestartActivity();
      yield* this.#sendWithResumeEffect(transfer);
      return transferId;
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          this.#outgoing.delete(transferKey(peerId, transferId));
          this.#notifyStateChange();
        }),
      ),
    );
  });

  watchIncoming(peerId: string, size: number, onProgress: (received: number, size: number) => void): IncomingFileWatch {
    const watch: IncomingWatch = { peerId, size, onProgress, transferId: null, taken: [], stopped: false };
    for (const item of this.#watches)
      if (item.stopped && item.peerId === peerId && item.size === size && item.transferId === null)
        this.#watches.delete(item);
    this.#watches.add(watch);
    return {
      end: (answered) => {
        if (watch.stopped || !this.#watches.delete(watch)) return;
        const shared = [...this.#watches].some((item) => !item.stopped && item.peerId === peerId && item.size === size);
        const others = shared ? [] : watch.taken.filter((transferId) => transferId !== answered);
        for (const transferId of others)
          void Effect.runPromise(
            this.#owned(
              this.#frames.withPermit(
                this.#refuse(peerId, transferId, new Error(sourceText("error.remote.downloadStopped"))),
              ),
            ),
          ).catch(() => undefined);
      },
      stop: Effect.suspend(() => {
        if (watch.stopped) return Effect.void;
        watch.stopped = true;
        const { transferId } = watch;
        if (transferId === null) {
          const timer = setTimeout(() => this.#watches.delete(watch), STOPPED_WATCH_MILLISECONDS);
          timer.unref?.();
          return Effect.void;
        }
        this.#watches.delete(watch);
        return this.#owned(
          this.#frames.withPermit(
            this.#refuse(peerId, transferId, new Error(sourceText("error.remote.downloadStopped"))),
          ),
        ).pipe(Effect.catch(() => Effect.void));
      }),
    };
  }

  readonly receive = Effect.fn("TeamFileTransfer.receive")(function* (
    this: TeamWebRtcFileTransfer,
    peerId: string,
    transferId: string,
    timeoutMs = 60_000,
  ): Effect.fn.Return<ReceivedWebRtcFile, RemoteWorkflowError> {
    return yield* this.#owned(
      Effect.gen({ self: this }, function* () {
        const key = transferKey(peerId, transferId);
        const completed = this.#completed.get(key);
        if (completed) return completed;
        if (this.#stopped)
          return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.remote.fileTransportStopped")) });
        if (this.#waiters.has(key))
          return yield* new RemoteWorkflowError({ cause: new Error("The WebRTC file is already being received.") });
        return yield* Effect.callback<ReceivedWebRtcFile, RemoteWorkflowError>((resume) => {
          const timer = setTimeout(() => {
            this.#waiters.delete(key);
            resume(
              Effect.fail(
                new RemoteWorkflowError({ cause: new Error(sourceText("error.remote.fileTransferTimeout")) }),
              ),
            );
          }, timeoutMs);
          timer.unref?.();
          this.#waiters.set(key, {
            timer,
            resolve: (file) => resume(Effect.succeed(file)),
            reject: (cause) => resume(Effect.fail(new RemoteWorkflowError({ cause }))),
          });
          return Effect.sync(() => {
            clearTimeout(timer);
            this.#waiters.delete(key);
          });
        });
      }),
    );
  }).bind(this);

  readonly consume = Effect.fn("TeamFileTransfer.consume")(function* (
    this: TeamWebRtcFileTransfer,
    peerId: string,
    transferId: string,
  ): Effect.fn.Return<{ bytes: Uint8Array; name: string; mimeType: string }, RemoteWorkflowError> {
    return yield* this.#owned(
      Effect.gen({ self: this }, function* () {
        return yield* this.useReceived(peerId, transferId, (file) =>
          remoteCall(() => readFile(file.path)).pipe(
            Effect.map((bytes) => ({ bytes: new Uint8Array(bytes), name: file.name, mimeType: file.mimeType })),
          ),
        );
      }),
    );
  }).bind(this);

  readonly useReceived = Effect.fn("TeamFileTransfer.useReceived")(function* <T, E, R>(
    this: TeamWebRtcFileTransfer,
    peerId: string,
    transferId: string,
    use: (file: ReceivedWebRtcFile) => Effect.Effect<T, E, R>,
  ): Effect.fn.Return<T, E | RemoteWorkflowError, R> {
    return yield* this.#owned(
      Effect.gen({ self: this }, function* () {
        return yield* Effect.acquireUseRelease(this.receive(peerId, transferId), use, (file) =>
          Effect.gen({ self: this }, function* () {
            const key = transferKey(peerId, transferId);
            this.#clearExpiration(key);
            this.#completed.delete(key);
            this.#admitWaitingOpensLater();
            yield* remoteCall(() => rm(file.path, { force: true }));
          }),
        );
      }),
    );
  });

  #owned<A, E, R>(operation: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
    return Effect.suspend(() => {
      const done = Deferred.makeUnsafe<void>();
      this.#operations.add(done);
      return operation.pipe(
        Effect.ensuring(
          Effect.sync(() => this.#operations.delete(done)).pipe(Effect.andThen(Deferred.succeed(done, undefined))),
        ),
      );
    });
  }

  readonly stop = Effect.fn("TeamFileTransfer.stop")(function* (this: TeamWebRtcFileTransfer) {
    this.#stopped = true;
    this.#writingAbort.abort();
    for (const waiter of this.#waiters.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(sourceText("error.remote.fileTransportStopped")));
    }
    this.#waiters.clear();
    this.#waitingOpens.clear();
    this.#notifyStateChange();
    this.#bridge.off("data", this.#onData);
    this.#bridge.off("disconnected", this.#onDisconnected);
    for (const timer of this.#expirationTimers.values()) clearTimeout(timer);
    this.#expirationTimers.clear();
    while (this.#operations.size)
      yield* Effect.forEach([...this.#operations], Deferred.await, { concurrency: "unbounded" });
    yield* Effect.forEach(
      [...this.#incoming.values()],
      (transfer) => remoteCall(() => transfer.file.close()).pipe(Effect.catch(() => Effect.void)),
      { concurrency: "unbounded" },
    );
    yield* Effect.forEach(
      [...this.#incoming.values(), ...this.#completed.values()],
      (transfer) => remoteCall(() => rm(transfer.path, { force: true })),
      { concurrency: "unbounded" },
    );
    for (const timer of this.#expirationTimers.values()) clearTimeout(timer);
    this.#incoming.clear();
    this.#outgoing.clear();
    this.#completed.clear();
    this.#expirationTimers.clear();
  }).bind(this);

  readonly #onDisconnected = (peerId: string): void => {
    this.setPeerAuthenticated(peerId, false);
  };

  readonly #onData = (
    peerId: string,
    channel: "rpc" | "events" | "files" | "desktop",
    data: string | ArrayBuffer,
  ): void => {
    if (channel !== "files" || !this.#connectedPeers.has(peerId) || !this.#acceptPeer(peerId)) return;
    const transferId = fileTransferId(data);
    const previous = this.#lastFrame;
    const done = Deferred.makeUnsafe<void>();
    this.#lastFrame = done;
    void Effect.runPromise(
      this.#owned(
        (previous ? Deferred.await(previous) : Effect.void).pipe(
          Effect.andThen(
            this.#frames.withPermit(
              this.#handleData(peerId, data).pipe(
                Effect.catch((error) => this.#failFrame(peerId, transferId, error.cause)),
              ),
            ),
          ),
          Effect.ensuring(Deferred.succeed(done, undefined)),
        ),
      ),
    ).catch(() => undefined);
  };

  readonly #handleData = Effect.fn("TeamFileTransfer.handleData")(function* (
    this: TeamWebRtcFileTransfer,
    peerId: string,
    data: string | ArrayBuffer,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    if (isString(data)) {
      const frame = yield* remoteDecode(() => decodeTeamProtocolV2FileControlFrame(data));
      const key = transferKey(peerId, frame.transferId);
      if (frame.type === "file-open") {
        const existing = this.#incoming.get(key);
        if (existing) {
          if (existing.size !== frame.size || existing.sha256 !== frame.sha256)
            return yield* new RemoteWorkflowError({ cause: new Error("The resumed WebRTC file metadata changed.") });
          yield* this.#bridge.send(
            peerId,
            "files",
            encodeTeamProtocolV2Frame({
              version: 2,
              type: "file-ack",
              transferId: frame.transferId,
              receivedThrough: existing.received,
            }),
          );
          return;
        }
        if (this.#waitingOpens.has(key)) {
          this.#waitingOpens.set(key, { peerId, frame });
          this.#scheduleExpiration(key);
          return;
        }
        const watch = [...this.#watches].find(
          (item) => item.peerId === peerId && item.transferId === null && item.size === frame.size,
        );
        if (watch?.stopped) {
          this.#watches.delete(watch);
          return yield* this.#refuse(peerId, frame.transferId, new Error(sourceText("error.remote.downloadStopped")));
        }
        if (watch) {
          watch.transferId = frame.transferId;
          watch.taken.push(frame.transferId);
          watch.onProgress(0, frame.size);
        }
        if (!this.#hasIncomingRoom(peerId, frame.size)) {
          this.#waitingOpens.set(key, { peerId, frame });
          this.#scheduleExpiration(key);
          return;
        }
        yield* this.#startIncoming(peerId, frame);
      } else if (frame.type === "file-ack") {
        const outgoing = this.#outgoing.get(key);
        if (!outgoing || frame.receivedThrough < outgoing.acknowledged || frame.receivedThrough > outgoing.size) return;
        if (frame.receivedThrough > outgoing.acknowledged) outgoing.lastProgressAt = Date.now();
        outgoing.acknowledged = frame.receivedThrough;
        outgoing.acknowledgementGeneration += 1;
        outgoing.onProgress?.(outgoing.acknowledged, outgoing.size);
        this.#notifyStateChange();
      } else if (frame.type === "file-complete") {
        const transfer = this.#incoming.get(key);
        if (!transfer || transfer.received !== transfer.size)
          return yield* new RemoteWorkflowError({ cause: new Error("The WebRTC file is incomplete.") });
        yield* remoteCall(() => transfer.file.close());
        if ((yield* sha256File(transfer.path).pipe(toRemoteWorkflowError)) !== transfer.sha256) {
          const error = new Error("The WebRTC file hash is invalid.");
          yield* this.#bridge
            .send(
              peerId,
              "files",
              encodeTeamProtocolV2Frame({
                version: 2,
                type: "file-cancel",
                transferId: transfer.transferId,
                reason: error.message,
              }),
            )
            .pipe(Effect.catch(() => Effect.void));
          yield* this.#cancelEffect(key, error);
          return yield* new RemoteWorkflowError({ cause: error });
        }
        this.#incoming.delete(key);
        const completed = {
          peerId,
          transferId: transfer.transferId,
          name: transfer.name,
          mimeType: transfer.mimeType,
          size: transfer.size,
          path: transfer.path,
        };
        this.#completed.set(key, completed);
        this.#scheduleExpiration(key);
        for (const watch of this.#watches)
          if (watch.peerId === peerId && watch.transferId === frame.transferId) watch.transferId = null;
        const waiter = this.#waiters.get(key);
        if (waiter) {
          clearTimeout(waiter.timer);
          this.#waiters.delete(key);
          waiter.resolve(completed);
        }
      } else if (frame.type === "file-cancel") {
        const outgoing = this.#outgoing.get(key);
        if (outgoing) {
          outgoing.cancelled = new Error(frame.reason);
          this.#notifyStateChange();
        }
        yield* this.#cancelEffect(key, new Error(frame.reason));
      }
      return;
    }
    const chunk = yield* remoteDecode(() => decodeTeamProtocolV2FileChunk(data));
    const key = transferKey(peerId, chunk.transferId);
    const transfer = this.#incoming.get(key);
    const end = chunk.offset + chunk.bytes.byteLength;
    if (!transfer || chunk.offset > transfer.received || end > transfer.size) {
      return yield* new RemoteWorkflowError({ cause: new Error("The WebRTC file offset is invalid.") });
    }
    if (end <= transfer.received) {
      this.#scheduleExpiration(key);
      return;
    }
    const skipped = transfer.received - chunk.offset;
    yield* remoteCall(() =>
      transfer.file.write(chunk.bytes, skipped, chunk.bytes.byteLength - skipped, transfer.received),
    );
    transfer.received = end;
    this.#scheduleExpiration(key);
    for (const watch of this.#watches)
      if (watch.peerId === peerId && watch.transferId === chunk.transferId)
        watch.onProgress(transfer.received, transfer.size);
    if (transfer.received === transfer.size || transfer.received - transfer.lastAcknowledged >= ACK_INTERVAL_BYTES) {
      transfer.lastAcknowledged = transfer.received;
      yield* this.#bridge.send(
        peerId,
        "files",
        encodeTeamProtocolV2Frame({
          version: 2,
          type: "file-ack",
          transferId: transfer.transferId,
          receivedThrough: transfer.received,
        }),
      );
    }
  });

  #hasIncomingRoom(peerId: string, size: number): boolean {
    const activeBytes = [...this.#incoming.values(), ...this.#completed.values()]
      .filter((item) => item.peerId === peerId)
      .reduce((sum, item) => sum + item.size, 0);
    return activeBytes + size <= TEAM_PROTOCOL_V2_MAX_FILE_SET_BYTES;
  }

  readonly #startIncoming = Effect.fn("TeamFileTransfer.startIncoming")(function* (
    this: TeamWebRtcFileTransfer,
    peerId: string,
    frame: FileOpenFrame,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    const key = transferKey(peerId, frame.transferId);
    yield* remoteCall(() => mkdir(this.#directory, { recursive: true, mode: 0o700 }));
    const path = join(this.#directory, `${frame.transferId}.part`);
    const file = yield* remoteCall(() => open(path, "w", 0o600));
    recordRestartActivity();
    this.#incoming.set(key, {
      peerId,
      transferId: frame.transferId,
      name: frame.name,
      mimeType: frame.mimeType,
      size: frame.size,
      sha256: frame.sha256,
      path,
      file,
      received: 0,
      lastAcknowledged: 0,
    });
    this.#scheduleExpiration(key);
    yield* this.#bridge.send(
      peerId,
      "files",
      encodeTeamProtocolV2Frame({ version: 2, type: "file-ack", transferId: frame.transferId, receivedThrough: 0 }),
    );
  });

  #admitWaitingOpensLater(): void {
    if (this.#waitingOpens.size === 0 || this.#stopped) return;
    void Effect.runPromise(this.#owned(this.#frames.withPermit(this.#admitWaitingOpens()))).catch(() => undefined);
  }

  readonly #admitWaitingOpens = Effect.fn("TeamFileTransfer.admitWaitingOpens")(function* (
    this: TeamWebRtcFileTransfer,
  ) {
    for (const [key, { peerId, frame }] of this.#waitingOpens) {
      if (this.#stopped) return;
      if (!this.#hasIncomingRoom(peerId, frame.size)) continue;
      this.#waitingOpens.delete(key);
      yield* this.#startIncoming(peerId, frame).pipe(
        Effect.catch((error) => this.#failFrame(peerId, frame.transferId, error.cause)),
        Effect.catch(() => Effect.void),
      );
    }
  });

  readonly #cancelEffect = Effect.fn("TeamFileTransfer.cancel")(function* (
    this: TeamWebRtcFileTransfer,
    key: string,
    error: Error,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    this.#clearExpiration(key);
    this.#waitingOpens.delete(key);
    const transfer = this.#incoming.get(key);
    if (transfer) {
      this.#incoming.delete(key);
      yield* remoteCall(() => transfer.file.close()).pipe(Effect.catch(() => Effect.void));
      yield* remoteCall(() => rm(transfer.path, { force: true }));
    }
    const completed = this.#completed.get(key);
    if (completed) {
      this.#completed.delete(key);
      yield* remoteCall(() => rm(completed.path, { force: true }));
    }
    const waiter = this.#waiters.get(key);
    if (waiter) {
      clearTimeout(waiter.timer);
      this.#waiters.delete(key);
      waiter.reject(error);
    }
    this.#admitWaitingOpensLater();
  });

  readonly #refuse = Effect.fn("TeamFileTransfer.refuse")(function* (
    this: TeamWebRtcFileTransfer,
    peerId: string,
    transferId: string,
    error: Error,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    yield* this.#bridge
      .send(
        peerId,
        "files",
        encodeTeamProtocolV2Frame({ version: 2, type: "file-cancel", transferId, reason: error.message }),
      )
      .pipe(Effect.catch(() => Effect.void));
    yield* this.#cancelEffect(transferKey(peerId, transferId), error);
  });

  readonly #failFrame = Effect.fn("TeamFileTransfer.failFrame")(function* (
    this: TeamWebRtcFileTransfer,
    peerId: string,
    transferId: string | null,
    error: unknown,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    if (!transferId) {
      this.setPeerAuthenticated(peerId, false);
      yield* this.#bridge.disconnectPeer(peerId).pipe(Effect.catch(() => Effect.void));
      return;
    }
    const failure = error instanceof Error ? error : new Error(sourceText("error.remote.fileTransferFailed"));
    yield* this.#bridge
      .send(
        peerId,
        "files",
        encodeTeamProtocolV2Frame({
          version: 2,
          type: "file-cancel",
          transferId,
          reason: failure.message.slice(0, 512),
        }),
      )
      .pipe(Effect.catch(() => Effect.void));
    yield* this.#cancelEffect(transferKey(peerId, transferId), failure);
  });

  readonly #sendWithResumeEffect = Effect.fn("TeamFileTransfer.sendWithResume")(function* (
    this: TeamWebRtcFileTransfer,
    transfer: OutgoingTransfer,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    while (Date.now() < transfer.lastProgressAt + this.#resumeMilliseconds) {
      if (transfer.cancelled) return yield* new RemoteWorkflowError({ cause: transfer.cancelled });
      yield* this.#waitUntilEffect(
        () => this.#connectedPeers.has(transfer.peerId),
        transfer.lastProgressAt + this.#resumeMilliseconds,
      );
      const generation = transfer.acknowledgementGeneration;
      const attempt = yield* Effect.gen({ self: this }, function* () {
        yield* this.#bridge.send(
          transfer.peerId,
          "files",
          encodeTeamProtocolV2Frame({
            version: 2,
            type: "file-open",
            transferId: transfer.transferId,
            name: transfer.name,
            size: transfer.size,
            mimeType: transfer.mimeType,
            sha256: transfer.sha256,
          }),
        );
        yield* this.#waitUntilEffect(
          () =>
            Boolean(transfer.cancelled) ||
            transfer.acknowledgementGeneration > generation ||
            !this.#connectedPeers.has(transfer.peerId),
          transfer.lastProgressAt + this.#resumeMilliseconds,
        );
        if (transfer.cancelled) return yield* new RemoteWorkflowError({ cause: transfer.cancelled });
        if (!this.#connectedPeers.has(transfer.peerId)) return false;
        for (let offset = transfer.acknowledged; offset < transfer.size; offset += FILE_CHUNK_BYTES) {
          const bytes = yield* remoteCall(() =>
            transfer.read(offset, Math.min(transfer.size, offset + FILE_CHUNK_BYTES) - offset),
          );
          const chunk = yield* remoteDecode(() =>
            encodeTeamProtocolV2FileChunk({ transferId: transfer.transferId, offset, bytes }),
          );
          const transferable = new Uint8Array(chunk.byteLength);
          transferable.set(chunk);
          yield* this.#bridge.send(transfer.peerId, "files", transferable.buffer);
        }
        yield* this.#bridge.send(
          transfer.peerId,
          "files",
          encodeTeamProtocolV2Frame({ version: 2, type: "file-complete", transferId: transfer.transferId }),
        );
        yield* this.#waitUntilEffect(
          () =>
            Boolean(transfer.cancelled) ||
            transfer.acknowledged === transfer.size ||
            !this.#connectedPeers.has(transfer.peerId),
          transfer.lastProgressAt + this.#resumeMilliseconds,
        );
        if (transfer.cancelled) return yield* new RemoteWorkflowError({ cause: transfer.cancelled });
        return this.#connectedPeers.has(transfer.peerId);
      }).pipe(Effect.result);
      if (Result.isSuccess(attempt)) {
        if (attempt.success) return;
        continue;
      }
      if (Date.now() >= transfer.lastProgressAt + this.#resumeMilliseconds) break;
      yield* this.#waitUntilEffect(
        () => !this.#connectedPeers.has(transfer.peerId),
        Math.min(transfer.lastProgressAt + this.#resumeMilliseconds, Date.now() + 2_000),
      ).pipe(Effect.catch(() => Effect.void));
    }
    return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.remote.fileResumeFailed")) });
  });

  #waitUntilEffect(predicate: () => boolean, deadline: number): Effect.Effect<void, RemoteWorkflowError> {
    return Effect.callback((resume) => {
      if (this.#stopped) {
        resume(
          Effect.fail(new RemoteWorkflowError({ cause: new Error(sourceText("error.remote.fileTransportStopped")) })),
        );
        return;
      }
      if (predicate()) {
        resume(Effect.void);
        return;
      }
      let timer: ReturnType<typeof setTimeout>;
      const cleanup = () => {
        clearTimeout(timer);
        this.#stateWaiters.delete(check);
      };
      const check = () => {
        if (this.#stopped) {
          cleanup();
          resume(
            Effect.fail(new RemoteWorkflowError({ cause: new Error(sourceText("error.remote.fileTransportStopped")) })),
          );
          return;
        }
        if (!predicate()) return;
        cleanup();
        resume(Effect.void);
      };
      timer = setTimeout(
        () => {
          cleanup();
          resume(
            Effect.fail(new RemoteWorkflowError({ cause: new Error(sourceText("error.remote.fileTransferTimeout")) })),
          );
        },
        Math.max(1, deadline - Date.now()),
      );
      this.#stateWaiters.add(check);
      check();
      return Effect.sync(cleanup);
    });
  }

  #notifyStateChange(): void {
    for (const waiter of [...this.#stateWaiters]) waiter();
  }

  #scheduleExpiration(key: string): void {
    this.#clearExpiration(key);
    const timer = setTimeout(() => {
      this.#expirationTimers.delete(key);
      void Effect.runPromise(this.#owned(this.#frames.withPermit(this.#expire(key)))).catch(() => undefined);
    }, this.#resumeMilliseconds);
    timer.unref?.();
    this.#expirationTimers.set(key, timer);
  }

  #clearExpiration(key: string): void {
    const timer = this.#expirationTimers.get(key);
    if (timer) clearTimeout(timer);
    this.#expirationTimers.delete(key);
  }

  readonly #expire = Effect.fn("TeamFileTransfer.expire")(function* (
    this: TeamWebRtcFileTransfer,
    key: string,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    const error = new Error(sourceText("error.remote.fileResumeExpired"));
    this.#waitingOpens.delete(key);
    const transfer = this.#incoming.get(key);
    if (transfer) {
      this.#incoming.delete(key);
      yield* remoteCall(() => transfer.file.close()).pipe(Effect.catch(() => Effect.void));
      yield* remoteCall(() => rm(transfer.path, { force: true }));
    }
    const completed = this.#completed.get(key);
    if (completed) {
      this.#completed.delete(key);
      yield* remoteCall(() => rm(completed.path, { force: true }));
    }
    const waiter = this.#waiters.get(key);
    if (waiter) {
      clearTimeout(waiter.timer);
      this.#waiters.delete(key);
      waiter.reject(error);
    }
    this.#admitWaitingOpensLater();
  });
}

function transferKey(peerId: string, transferId: string): string {
  return `${peerId}\0${transferId}`;
}

function fileTransferId(data: string | ArrayBuffer): string | null {
  try {
    return isString(data)
      ? decodeTeamProtocolV2FileControlFrame(data).transferId
      : decodeTeamProtocolV2FileChunk(data).transferId;
  } catch {
    return null;
  }
}
