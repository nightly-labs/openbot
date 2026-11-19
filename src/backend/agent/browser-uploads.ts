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

interface BrowserUploadRoot {
  path: string;
  bytes: number;
  files: readonly string[];
  sizes: readonly number[];
  key: string | null;
  holders: number;
}

interface BrowserUploadReservation {
  bytes: number;
  inputId: string;
  documentId: string;
  invalidated: boolean;
  root: string | null;
  reused: BrowserUploadRoot | null;
}

interface BrowserUploadHooks {
  onUploadTargetResolved?: (inputId: string, documentId: string) => void;
  onUploadAssigned?: (inputId: string, documentId: string) => void;
  onUploadOperationStarted?: (completion: Fiber.Fiber<void, BrowserOperationError>) => void;
}

export interface BrowserUploadTarget {
  resolveUploadTarget(
    params: DynamicToolCallParams,
  ): Effect.Effect<{ inputId: string; documentId: string }, BrowserOperationError>;
  handleDynamicTool(
    params: DynamicToolCallParams,
    hooks?: BrowserUploadHooks,
  ): Effect.Effect<DynamicToolResult, BrowserOperationError>;
}

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
  hasTakeover(agentId: string, threadId: string, tabId: string): boolean;
}

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

const REUSE_SETTLED_MS = 5_000;

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

export class BrowserUploads {
  readonly #browser: BrowserUploadTarget;
  readonly #attachments: BrowserUploadSources;
  readonly #isStopping: () => boolean;
  readonly #hasTakeover: (agentId: string, threadId: string, tabId: string) => boolean;
  #scope = Scope.makeUnsafe();
  readonly #roots = new Map<string, Map<string, BrowserUploadRoot[]>>();
  readonly #reservations = new Map<string, Map<symbol, BrowserUploadReservation>>();
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
                    if (this.#hasTakeover(agentId, params.threadId, tabId)) {
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
                    const held = roots.get(inputId) ?? [];
                    if (!held.includes(root)) {
                      roots.set(inputId, [...held, root]);
                      root.holders += 1;
                    }
                    this.#roots.set(tabId, roots);
                    if (root !== reused && root.key !== null && !this.#reusable.has(root.key)) {
                      this.#reusable.set(root.key, root);
                    }
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
