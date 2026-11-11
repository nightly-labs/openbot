import { type BigIntStats, createWriteStream } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { ATTACHMENT_LIMITS } from "@openbot/contracts/input-limits";
import { createOpenBotLogger, redactText } from "@openbot/logging";
import { Effect, Exit, Fiber, Scope } from "effect";
import {
  type AttachmentOperationError,
  attachmentCall,
  attachmentFailure,
  attachmentSync,
} from "../attachment-effects";
import type { BrowserOperationError } from "../browser-effects";
import { parseBrowserToolArguments } from "../browser-tools";
import type { GeneratedAttachmentSource } from "../mailbox-store";
import type { DynamicToolCallParams, DynamicToolResult } from "../protocol";
import type { AttachmentSourceScope } from "./attachment-gateway";

/**
 * The copies of one upload's files, assigned to a page. Other documents can retain its File objects after
 * navigation. An upload of the same unchanged files to any input of any tab reuses it rather than copying
 * the files again, so its bytes count once for each quota however many inputs hold it.
 */
interface BrowserUploadRoot {
  path: string;
  bytes: number;
  /** The staged paths, in the order of the upload's sources, and the size of each. */
  files: readonly string[];
  sizes: readonly number[];
  /** Which source files it copies (see `uploadKey`), or null when it cannot be reused. */
  key: string | null;
  /** The input assignments and in-flight uploads that hold it. The directory goes when none is left. */
  holders: number;
}

/**
 * A staging directory in flight. It counts against both quotas from the moment the copy starts, so two
 * concurrent uploads cannot each pass a check the pair of them fails. `invalidated` is how a document
 * change reaches a copy already running: the loop re-reads it and abandons the staging directory rather
 * than handing a page files it asked for before it navigated.
 */
interface BrowserUploadReservation {
  bytes: number;
  inputId: string;
  documentId: string;
  invalidated: boolean;
  root: string | null;
  /** The retained copy this upload reuses; it copies nothing and adds no bytes a holder already counts. */
  reused: BrowserUploadRoot | null;
}

/** The `handleDynamicTool` callbacks this controller uses to bind a staging directory to a real input. */
interface BrowserUploadHooks {
  onUploadTargetResolved?: (inputId: string, documentId: string) => void;
  onUploadAssigned?: (inputId: string, documentId: string) => void;
  onUploadOperationStarted?: (completion: Fiber.Fiber<void, BrowserOperationError>) => void;
}

/** The browser surface staging needs. `BrowserHost` satisfies it. */
export interface BrowserUploadTarget {
  resolveUploadTarget(
    params: DynamicToolCallParams,
  ): Effect.Effect<{ inputId: string; documentId: string }, BrowserOperationError>;
  handleDynamicTool(
    params: DynamicToolCallParams,
    hooks?: BrowserUploadHooks,
  ): Effect.Effect<DynamicToolResult, BrowserOperationError>;
}

/** The file-opening half of `AttachmentGateway`, which owns the path policy this controller asks for. */
export interface BrowserUploadSources {
  openSources(
    agentId: string,
    paths: string[],
    scope: AttachmentSourceScope,
  ): Effect.Effect<GeneratedAttachmentSource[], AttachmentOperationError>;
}

export interface BrowserUploadsOptions {
  browser: BrowserUploadTarget;
  attachments: BrowserUploadSources;
  isStopping(): boolean;
  /**
   * Whether a browser takeover is pending for this agent. Staging runs outside the tab queue and can
   * take as long as the files are large, so the caller's pre-flight check can be stale by the time
   * the input is reached -- this is read again inside the queued operation.
   */
  hasTakeover(agentId: string): boolean;
}

/** Uploads read from anywhere on the disk; `AttachmentSourceScope` documents what that does and does not widen. */
const UPLOAD_SCOPE: AttachmentSourceScope = { allowAnyReadablePath: true };

const removeUploadRoot = Effect.fn("BrowserUploads.removeRoot")((path: string) =>
  attachmentCall(() => rm(path, { recursive: true, force: true })).pipe(
    Effect.uninterruptible,
    Effect.catch(() => Effect.void),
  ),
);

const logger = createOpenBotLogger("browser-uploads");

const MAX_BROWSER_UPLOAD_INPUTS_PER_TAB = 10;
const MAX_BROWSER_UPLOAD_BYTES_PER_TAB = ATTACHMENT_LIMITS.totalBytes;
const MAX_BROWSER_UPLOAD_BYTES_TOTAL = ATTACHMENT_LIMITS.totalBytes * 2;

/**
 * How long a source file must be unchanged before its copy can be reused. FAT and some network volumes
 * keep mtime in steps of up to 2 seconds and have no ctime, so a rewrite just after a recent change can
 * keep every value of the key. After this time, a rewrite always gets a later mtime.
 */
const REUSE_SETTLED_MS = 5_000;

/**
 * Which files a copy holds: each name, file identity, size and change times. A rewrite that keeps size and
 * mtime still moves ctime, and a replace by rename changes the inode. Null when the file system reports no
 * file identity (some network and FAT volumes report inode 0), since two different files could then match,
 * or when a file changed too recently to tell a later rewrite apart (`REUSE_SETTLED_MS`).
 */
function uploadKey(
  sources: readonly GeneratedAttachmentSource[],
  stats: readonly BigIntStats[],
  now: number,
): string | null {
  if (stats.some((file) => file.ino === 0n || now - Number(file.mtimeMs) < REUSE_SETTLED_MS)) return null;
  return JSON.stringify(
    stats.map((file, index) => [
      basename(sources[index]?.path ?? ""),
      String(file.dev),
      String(file.ino),
      String(file.size),
      String(file.mtimeNs),
      String(file.ctimeNs),
    ]),
  );
}

/**
 * Staging for `openbot_browser.upload_files`.
 *
 * A tab keeps a file input's selection until the page navigates, and a page can keep the `File` objects
 * it took from an earlier selection for just as long, so the files behind both have to outlive the tool
 * call that set them. That is what makes this more than a pass-through: the agent names paths
 * anywhere on the disk, and handing those straight to the page would leave a renderer holding a live
 * handle on the user's own file for as long as the tab stays open.
 *
 * Owns a private `0o700` copy of every file an agent hands to a page, and the whole lifetime of that
 * copy: it is created before the input is set, retained across document changes, and deleted when
 * the tab closes or the service stops. A parent page can retain a File from an iframe that navigated,
 * so removing the source document does not prove the copy is unused.
 *
 * Owns the two quotas as well -- inputs per tab, bytes per tab and bytes across every tab -- because a
 * retained copy is disk the user did not ask to spend and nothing else counts it. Reservations are
 * checked against the same totals as retained roots, so concurrent calls cannot pass one at a time.
 * A copy is kept until its tab closes, so a second upload of the same unchanged files reuses the
 * retained copy: one video posted in several tabs, or retried in one input, takes its bytes once.
 */
export class BrowserUploads {
  readonly #browser: BrowserUploadTarget;
  readonly #attachments: BrowserUploadSources;
  readonly #isStopping: () => boolean;
  readonly #hasTakeover: (agentId: string) => boolean;
  #scope = Scope.makeUnsafe();
  readonly #roots = new Map<string, Map<string, BrowserUploadRoot[]>>();
  readonly #reservations = new Map<string, Map<symbol, BrowserUploadReservation>>();
  /** Assigned roots that can be reused, by `uploadKey`. Each stays here while it has a holder. */
  readonly #reusable = new Map<string, BrowserUploadRoot>();

  constructor(options: BrowserUploadsOptions) {
    this.#browser = options.browser;
    this.#attachments = options.attachments;
    this.#isStopping = options.isStopping;
    this.#hasTakeover = options.hasTakeover;
  }

  readonly uploadFiles = Effect.fn("BrowserUploads.uploadFiles")(function* (
    this: BrowserUploads,
    agentId: string,
    params: DynamicToolCallParams,
  ): Effect.fn.Return<DynamicToolResult> {
    // A failed tool result, as every other browser tool returns: Codex replaces a JSON-RPC error with
    // "dynamic tool request failed", so the agent could not correct an ambiguous selector or a bad path.
    return yield* this.#stageAndAssign(agentId, params).pipe(
      Effect.catch((error) =>
        Effect.sync((): DynamicToolResult => {
          const text = redactText(error.cause instanceof Error ? error.cause.message : String(error.cause));
          logger.warn("A browser upload failed.", { error: text });
          return { success: false, contentItems: [{ type: "inputText", text }] };
        }),
      ),
    );
  });

  readonly #stageAndAssign = Effect.fn("BrowserUploads.stageAndAssign")(function* (
    this: BrowserUploads,
    agentId: string,
    params: DynamicToolCallParams,
  ): Effect.fn.Return<DynamicToolResult, AttachmentOperationError> {
    const args = yield* attachmentSync(() => parseBrowserToolArguments("upload_files", params.arguments));
    const tabId = args.tabId;
    const paths = args.paths;
    const uploadTarget = yield* this.#browser
      .resolveUploadTarget(params)
      .pipe(Effect.mapError((error) => attachmentFailure(error.cause)));
    return yield* Effect.acquireUseRelease(
      this.#attachments.openSources(agentId, paths, UPLOAD_SCOPE),
      (sources) =>
        Effect.gen({ self: this }, function* () {
          let stagingRoot: string | null = null;
          const reservationId = Symbol("browser-upload");
          let reservation: BrowserUploadReservation | null = null;
          // A retained root this upload holds, so the root cannot go while the page takes its files.
          let reused: BrowserUploadRoot | null = null;
          const uploadState: { completion?: Fiber.Fiber<void, BrowserOperationError> } = {};
          const releaseReservation = () => {
            if (!reservation) return;
            this.#releaseReservation(tabId, reservationId);
            reservation = null;
          };
          return yield* Effect.gen({ self: this }, function* () {
            const stats = yield* attachmentCall(() =>
              Promise.all(sources.map((source) => source.handle.stat({ bigint: true }))),
            );
            const sizes = stats.map((metadata) => Number(metadata.size));
            const key = uploadKey(sources, stats, Date.now());
            if (sizes.some((size) => size > ATTACHMENT_LIMITS.fileBytes)) {
              return yield* attachmentFailure(
                new Error(`Each browser upload file must not exceed ${ATTACHMENT_LIMITS.fileBytes} bytes.`),
              );
            }
            const stagedBytes = sizes.reduce((total, size) => total + size, 0);
            if (stagedBytes > ATTACHMENT_LIMITS.totalBytes) {
              return yield* attachmentFailure(
                new Error(`Browser upload files must not exceed ${ATTACHMENT_LIMITS.totalBytes} bytes in total.`),
              );
            }
            // Held before it is recorded, so interruption cannot leave a hold that nothing releases.
            yield* Effect.gen({ self: this }, function* () {
              reused = yield* this.#holdReusable(key);
            }).pipe(Effect.uninterruptible);
            reservation = {
              bytes: stagedBytes,
              inputId: uploadTarget.inputId,
              documentId: uploadTarget.documentId,
              invalidated: false,
              root: null,
              reused,
            };
            const currentReservation = reservation;
            yield* attachmentSync(() => this.#reserve(tabId, reservationId, currentReservation));
            const stagedPaths = reused ? [...reused.files] : [];
            if (!reused) {
              // Node cannot cancel this allocation. Record its path before interruption can run cleanup.
              yield* Effect.gen(function* () {
                stagingRoot = yield* attachmentCall(() => mkdtemp(join(tmpdir(), "openbot-browser-upload-")));
                currentReservation.root = stagingRoot;
              }).pipe(Effect.uninterruptible);
              if (reservation.invalidated)
                return yield* attachmentFailure(new Error("The browser document changed during upload staging."));
              const currentRoot = currentReservation.root;
              if (!currentRoot)
                return yield* attachmentFailure(new Error("The browser document changed during upload staging."));
              yield* attachmentCall(() => chmod(currentRoot, 0o700)).pipe(Effect.uninterruptible);
              for (const [index, source] of sources.entries()) {
                // One directory per file, so two uploads that share a basename do not collide and the name the
                // page reports is the name the user recognizes.
                const stagedDirectory = join(currentRoot, String(index));
                yield* attachmentCall(() => mkdir(stagedDirectory, { mode: 0o700 })).pipe(Effect.uninterruptible);
                const stagedPath = join(stagedDirectory, basename(source.path));
                const expectedBytes = sizes[index];
                if (expectedBytes === undefined)
                  return yield* attachmentFailure(new Error("The upload size is missing."));
                if (expectedBytes === 0) {
                  yield* attachmentCall(() => writeFile(stagedPath, "", { flag: "wx", mode: 0o600 })).pipe(
                    Effect.uninterruptible,
                  );
                } else {
                  yield* attachmentCall(() =>
                    pipeline(
                      source.handle.createReadStream({ autoClose: false, start: 0, end: expectedBytes - 1 }),
                      createWriteStream(stagedPath, { flags: "wx", mode: 0o600 }),
                    ),
                  ).pipe(Effect.uninterruptible);
                }
                const copiedBytes = (yield* attachmentCall(() => stat(stagedPath))).size;
                // The size was measured before the copy and the quotas were reserved against it, so a file that
                // changed underneath us has already been charged the wrong amount. The staged size alone only
                // catches a file that shrank: the read stops at `expectedBytes - 1`, so one that grew produces a
                // copy of exactly the expected length. Re-stat the descriptor the copy read from -- the same open
                // handle, so it is the same file even if the path was replaced -- and reject either direction.
                const sourceBytes = (yield* attachmentCall(() => source.handle.stat())).size;
                if (copiedBytes !== expectedBytes || sourceBytes !== expectedBytes)
                  return yield* attachmentFailure(new Error("A browser upload file changed while it was staged."));
                stagedPaths.push(stagedPath);
              }
            }
            if (reservation.invalidated)
              return yield* attachmentFailure(new Error("The browser document changed during upload staging."));
            return yield* this.#browser
              .handleDynamicTool(
                { ...params, arguments: { ...args, paths: stagedPaths } },
                {
                  onUploadTargetResolved: (inputId, documentId) => {
                    if (!reservation || reservation.invalidated) {
                      throw new Error("The browser document changed while files were being staged.");
                    }
                    // Inside the tab queue, and the last point before the input is assigned. The caller
                    // checked takeover before staging began; a takeover that started during staging would
                    // otherwise let this write files into a page the user is holding, since `BrowserHost`
                    // checks tab ownership and not takeover.
                    if (this.#hasTakeover(agentId)) {
                      reservation.invalidated = true;
                      throw new Error("Browser tools are unavailable during user takeover.");
                    }
                    if (inputId !== uploadTarget.inputId || documentId !== uploadTarget.documentId) {
                      reservation.invalidated = true;
                      throw new Error("The browser upload target changed while files were being staged.");
                    }
                  },
                  onUploadAssigned: (inputId) => {
                    const root: BrowserUploadRoot | null =
                      reused ??
                      (stagingRoot
                        ? { path: stagingRoot, bytes: stagedBytes, files: stagedPaths, sizes, key, holders: 0 }
                        : null);
                    if (!root || this.#isStopping() || !reservation || reservation.invalidated) {
                      throw new Error("The browser document changed while files were being staged.");
                    }
                    const roots = this.#roots.get(tabId) ?? new Map<string, BrowserUploadRoot[]>();
                    // Appended rather than replacing what the input held before. Setting `input.files` again
                    // does not invalidate the `File` objects a page already took from it, so deleting the
                    // earlier directory here would break a page that is accumulating attachments across
                    // selections -- it reads a file that is no longer there. The earlier copies stay until the
                    // tab closes, and their bytes keep counting against the quotas.
                    // An input that already holds this root gains nothing from a second entry, so a retry of the
                    // same files does not grow the list.
                    const held = roots.get(inputId) ?? [];
                    if (!held.includes(root)) {
                      roots.set(inputId, [...held, root]);
                      root.holders += 1;
                    }
                    this.#roots.set(tabId, roots);
                    // Only a new copy is indexed: a reused root that `#holdReusable` dropped must stay dropped.
                    if (root !== reused && root.key !== null && !this.#reusable.has(root.key)) {
                      this.#reusable.set(root.key, root);
                    }
                    // Ownership moves from the reservation to the root here: the `finally` below must not delete
                    // a directory the input is now reading from.
                    reservation.root = null;
                    stagingRoot = null;
                    releaseReservation();
                  },
                  onUploadOperationStarted: (completion) => {
                    uploadState.completion = completion;
                  },
                },
              )
              .pipe(Effect.mapError((error) => attachmentFailure(error.cause)));
          }).pipe(
            Effect.ensuring(
              Effect.gen({ self: this }, function* () {
                const heldRoot = reused;
                if (stagingRoot || heldRoot) {
                  const unassignedRoot = stagingRoot;
                  const cleanup = Effect.gen({ self: this }, function* () {
                    if (heldRoot) {
                      // An assignment holds the root by itself by now; this releases only the upload's hold.
                      releaseReservation();
                      yield* this.#releaseRoot(heldRoot);
                      return;
                    }
                    if (!unassignedRoot || stagingRoot !== unassignedRoot) return;
                    stagingRoot = null;
                    if (reservation) reservation.root = null;
                    releaseReservation();
                    yield* removeUploadRoot(unassignedRoot);
                  });
                  // The tool can reject while the input-setting operation is still reading the staged files, so
                  // cleanup waits for it rather than pulling the directory out from under the renderer. A reused
                  // root can lose its last other holder in that time, so its hold waits the same way.
                  if (uploadState.completion)
                    yield* Effect.forkIn(
                      Fiber.await(uploadState.completion).pipe(Effect.andThen(cleanup)),
                      this.#scope,
                      { startImmediately: true, uninterruptible: true },
                    );
                  else yield* cleanup;
                } else releaseReservation();
              }).pipe(Effect.orDie),
            ),
          );
        }),
      (sources) =>
        attachmentCall(() => Promise.allSettled(sources.map((source) => source.handle.close()))).pipe(Effect.orDie),
    );
  });

  /** A closed tab can never read its staged files again, so the tab roster shrinking frees them. */
  readonly retainTabs = Effect.fn("BrowserUploads.retainTabs")(function* (
    this: BrowserUploads,
    tabs: readonly { id: string }[],
  ) {
    const open = new Set(tabs.map((tab) => tab.id));
    for (const tabId of new Set([...this.#roots.keys(), ...this.#reservations.keys()])) {
      if (open.has(tabId)) continue;
      yield* this.#discardTab(tabId);
    }
  });

  /**
   * Cancels staging for a removed document. Assigned files stay: a surviving parent document can
   * retain File objects from the document that navigated. The byte quotas continue to bound them.
   */
  readonly retainDocuments = Effect.fn("BrowserUploads.retainDocuments")(function* (
    this: BrowserUploads,
    tabId: string,
    documentIds: ReadonlySet<string>,
  ) {
    const reservations = this.#reservations.get(tabId);
    if (reservations) {
      for (const [id, reservation] of reservations) {
        if (documentIds.has(reservation.documentId)) continue;
        reservations.delete(id);
        reservation.invalidated = true;
        if (reservation.root) yield* removeUploadRoot(reservation.root);
      }
      if (reservations.size === 0) this.#reservations.delete(tabId);
    }
  });

  readonly dispose = Effect.fn("BrowserUploads.dispose")(function* (
    this: BrowserUploads,
  ): Effect.fn.Return<void, AttachmentOperationError> {
    yield* Scope.close(this.#scope, Exit.void);
    const roots = new Set(
      [...this.#roots.values()].flatMap((values) => [...values.values()].flat().map((root) => root.path)),
    );
    const reserved = [...this.#reservations.values()].flatMap((values) =>
      [...values.values()].flatMap((reservation) => {
        reservation.invalidated = true;
        return reservation.root ? [reservation.root] : [];
      }),
    );
    this.#roots.clear();
    this.#reservations.clear();
    this.#reusable.clear();
    yield* Effect.forEach([...roots, ...reserved], removeUploadRoot, { concurrency: "unbounded" });
    this.#scope = Scope.makeUnsafe();
  }, Effect.uninterruptible);

  #reserve(tabId: string, id: symbol, reservation: BrowserUploadReservation): void {
    const roots = this.#roots.get(tabId);
    const reservations = this.#reservations.get(tabId) ?? new Map<symbol, BrowserUploadReservation>();
    if ([...reservations.values()].some((value) => value.inputId === reservation.inputId)) {
      throw new Error("Another upload to this browser input is already in progress.");
    }
    const reservedNewInputs = [...reservations.values()].filter((value) => !roots?.has(value.inputId)).length;
    const additionalInput = roots?.has(reservation.inputId) ? 0 : 1;
    if ((roots?.size ?? 0) + reservedNewInputs + additionalInput > MAX_BROWSER_UPLOAD_INPUTS_PER_TAB) {
      throw new Error(`A browser tab can retain files for up to ${MAX_BROWSER_UPLOAD_INPUTS_PER_TAB} inputs.`);
    }
    // Reassigning an input keeps what it held, so nothing is subtracted here: those bytes are still on
    // disk for as long as the page could read them, and the quota is what bounds the accumulation.
    // The agent reads these errors, so they say how to free the space: only closing a tab does.
    if (this.#chargedBytes([tabId], reservation) > MAX_BROWSER_UPLOAD_BYTES_PER_TAB) {
      throw new Error(
        `A browser tab can retain up to ${MAX_BROWSER_UPLOAD_BYTES_PER_TAB} upload bytes. A tab keeps its uploaded files until it closes: close this tab when its uploads are finished, then open the page in a new tab.`,
      );
    }
    const tabIds = new Set([...this.#roots.keys(), ...this.#reservations.keys()]);
    if (this.#chargedBytes(tabIds, reservation) > MAX_BROWSER_UPLOAD_BYTES_TOTAL) {
      throw new Error(
        `Browser uploads can retain up to ${MAX_BROWSER_UPLOAD_BYTES_TOTAL} bytes in total. A tab keeps its uploaded files until it closes: close the tabs whose uploads are finished, then try again.`,
      );
    }
    reservations.set(id, reservation);
    this.#reservations.set(tabId, reservations);
  }

  /** The bytes these tabs hold on disk with `next` added. A root that several inputs or tabs hold counts once. */
  #chargedBytes(tabIds: Iterable<string>, next: BrowserUploadReservation): number {
    const roots = new Set<BrowserUploadRoot>();
    let stagingBytes = 0;
    const add = (reservation: BrowserUploadReservation) => {
      if (reservation.reused) roots.add(reservation.reused);
      else stagingBytes += reservation.bytes;
    };
    for (const tabId of tabIds) {
      for (const inputRoots of this.#roots.get(tabId)?.values() ?? []) {
        for (const root of inputRoots) roots.add(root);
      }
      for (const reservation of this.#reservations.get(tabId)?.values() ?? []) add(reservation);
    }
    add(next);
    return [...roots].reduce((total, root) => total + root.bytes, stagingBytes);
  }

  /**
   * Holds the retained root of these exact files when it is still whole on disk, or returns null. The
   * caller releases the hold with `#releaseRoot`.
   */
  readonly #holdReusable = Effect.fn("BrowserUploads.holdReusable")(function* (
    this: BrowserUploads,
    key: string | null,
  ) {
    const root = key === null ? undefined : this.#reusable.get(key);
    if (!root) return null;
    root.holders += 1;
    const whole = yield* attachmentCall(() => Promise.all(root.files.map((file) => stat(file)))).pipe(
      Effect.map((copies) => copies.every((copy, index) => copy.size === root.sizes[index])),
      Effect.catch(() => Effect.succeed(false)),
    );
    if (whole) return root;
    // Something removed or changed the copy. Its holders keep it, but a new upload copies the files again.
    if (key !== null && this.#reusable.get(key) === root) this.#reusable.delete(key);
    yield* this.#releaseRoot(root);
    return null;
  });

  readonly #releaseRoot = Effect.fn("BrowserUploads.releaseRoot")(function* (
    this: BrowserUploads,
    root: BrowserUploadRoot,
  ) {
    root.holders -= 1;
    if (root.holders > 0) return;
    if (root.key !== null && this.#reusable.get(root.key) === root) this.#reusable.delete(root.key);
    yield* removeUploadRoot(root.path);
  });

  #releaseReservation(tabId: string, id: symbol): void {
    const reservations = this.#reservations.get(tabId);
    if (!reservations) return;
    reservations.delete(id);
    if (reservations.size === 0) this.#reservations.delete(tabId);
  }

  readonly #discardTab = Effect.fn("BrowserUploads.discardTab")(function* (this: BrowserUploads, tabId: string) {
    const roots = this.#roots.get(tabId);
    this.#roots.delete(tabId);
    for (const root of [...(roots?.values() ?? [])].flat()) {
      yield* this.#releaseRoot(root);
    }
    const reservations = this.#reservations.get(tabId);
    this.#reservations.delete(tabId);
    for (const reservation of reservations?.values() ?? []) {
      reservation.invalidated = true;
      if (reservation.root) yield* removeUploadRoot(reservation.root);
    }
  });
}
