import { createWriteStream } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { ATTACHMENT_LIMITS } from "@openbot/contracts/input-limits";
import { isString } from "@openbot/contracts/runtime-values";
import { redactText } from "@openbot/logging";
import { parseBrowserToolArguments } from "../browser-tools";
import type { GeneratedAttachmentSource } from "../mailbox-store";
import type { DynamicToolCallParams, DynamicToolResult } from "../protocol";
import type { AttachmentSourceScope } from "./attachment-gateway";

/** A file copy assigned to a page. Other documents can retain its File objects after navigation. */
interface BrowserUploadRoot {
  path: string;
  bytes: number;
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
}

/** The `handleDynamicTool` callbacks this controller uses to bind a staging directory to a real input. */
export interface BrowserUploadHooks {
  onUploadTargetResolved?: (inputId: string, documentId: string) => void;
  onUploadAssigned?: (inputId: string, documentId: string) => void;
  onUploadOperationStarted?: (completion: Promise<void>) => void;
}

/** The browser surface staging needs. `BrowserHost` satisfies it. */
export interface BrowserUploadTarget {
  resolveUploadTarget(params: DynamicToolCallParams): Promise<{ inputId: string; documentId: string }>;
  handleDynamicTool(params: DynamicToolCallParams, hooks?: BrowserUploadHooks): Promise<DynamicToolResult>;
}

/** The file-opening half of `AttachmentGateway`, which owns the path policy this controller asks for. */
export interface BrowserUploadSources {
  openSources(agentId: string, paths: string[], scope: AttachmentSourceScope): Promise<GeneratedAttachmentSource[]>;
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

const MAX_BROWSER_UPLOAD_INPUTS_PER_TAB = 10;
const MAX_BROWSER_UPLOAD_BYTES_PER_TAB = ATTACHMENT_LIMITS.totalBytes;
const MAX_BROWSER_UPLOAD_BYTES_TOTAL = ATTACHMENT_LIMITS.totalBytes * 2;

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
 */
export class BrowserUploads {
  readonly #browser: BrowserUploadTarget;
  readonly #attachments: BrowserUploadSources;
  readonly #isStopping: () => boolean;
  readonly #hasTakeover: (agentId: string) => boolean;
  readonly #roots = new Map<string, Map<string, BrowserUploadRoot[]>>();
  readonly #reservations = new Map<string, Map<symbol, BrowserUploadReservation>>();

  constructor(options: BrowserUploadsOptions) {
    this.#browser = options.browser;
    this.#attachments = options.attachments;
    this.#isStopping = options.isStopping;
    this.#hasTakeover = options.hasTakeover;
  }

  async uploadFiles(agentId: string, params: DynamicToolCallParams): Promise<DynamicToolResult> {
    try {
      return await this.#stageAndAssign(agentId, params);
    } catch (error) {
      // `BrowserHost.handleDynamicTool` redacts what it *returns*, but everything this controller does
      // around that call -- resolving the target, opening the sources, the quotas, staging -- throws
      // past it to the facade, which forwards `String(error)` to the provider unchanged. The page picks
      // some of that text: an ambiguous semantic target names both candidates by accessible name, so
      // two inputs labelled `Upload password=hunter2` put the password in the error.
      throw new Error(redactText(error instanceof Error ? error.message : String(error)));
    }
  }

  async #stageAndAssign(agentId: string, params: DynamicToolCallParams): Promise<DynamicToolResult> {
    const args = parseBrowserToolArguments("upload_files", params.arguments);
    const tabId = args.tabId;
    const paths = args.paths;
    // The schema above already bounded both; this only narrows the parsed record's `unknown` values.
    if (!isString(tabId) || !Array.isArray(paths) || !paths.every(isString)) {
      throw new Error("upload_files requires a tabId and a list of local file paths.");
    }
    const uploadTarget = await this.#browser.resolveUploadTarget(params);
    const sources = await this.#attachments.openSources(agentId, paths, UPLOAD_SCOPE);
    let stagingRoot: string | null = null;
    const reservationId = Symbol("browser-upload");
    let reservation: BrowserUploadReservation | null = null;
    const uploadState: { completion?: Promise<void> } = {};
    const releaseReservation = () => {
      if (!reservation) return;
      this.#releaseReservation(tabId, reservationId);
      reservation = null;
    };
    try {
      const sizes = await Promise.all(sources.map((source) => source.handle.stat().then((metadata) => metadata.size)));
      if (sizes.some((size) => size > ATTACHMENT_LIMITS.fileBytes)) {
        throw new Error(`Each browser upload file must not exceed ${ATTACHMENT_LIMITS.fileBytes} bytes.`);
      }
      const stagedBytes = sizes.reduce((total, size) => total + size, 0);
      if (stagedBytes > ATTACHMENT_LIMITS.totalBytes) {
        throw new Error(`Browser upload files must not exceed ${ATTACHMENT_LIMITS.totalBytes} bytes in total.`);
      }
      reservation = {
        bytes: stagedBytes,
        inputId: uploadTarget.inputId,
        documentId: uploadTarget.documentId,
        invalidated: false,
        root: null,
      };
      this.#reserve(tabId, reservationId, reservation);
      stagingRoot = await mkdtemp(join(tmpdir(), "openbot-browser-upload-"));
      reservation.root = stagingRoot;
      if (reservation.invalidated) throw new Error("The browser document changed during upload staging.");
      await chmod(stagingRoot, 0o700);
      const stagedPaths: string[] = [];
      for (const [index, source] of sources.entries()) {
        // One directory per file, so two uploads that share a basename do not collide and the name the
        // page reports is the name the user recognizes.
        const stagedDirectory = join(stagingRoot, String(index));
        await mkdir(stagedDirectory, { mode: 0o700 });
        const stagedPath = join(stagedDirectory, basename(source.path));
        const expectedBytes = sizes[index];
        if (expectedBytes === 0) {
          await writeFile(stagedPath, "", { flag: "wx", mode: 0o600 });
        } else {
          await pipeline(
            source.handle.createReadStream({ autoClose: false, start: 0, end: expectedBytes - 1 }),
            createWriteStream(stagedPath, { flags: "wx", mode: 0o600 }),
          );
        }
        const copiedBytes = (await stat(stagedPath)).size;
        // The size was measured before the copy and the quotas were reserved against it, so a file that
        // changed underneath us has already been charged the wrong amount. The staged size alone only
        // catches a file that shrank: the read stops at `expectedBytes - 1`, so one that grew produces a
        // copy of exactly the expected length. Re-stat the descriptor the copy read from -- the same open
        // handle, so it is the same file even if the path was replaced -- and reject either direction.
        const sourceBytes = (await source.handle.stat()).size;
        if (copiedBytes !== expectedBytes || sourceBytes !== expectedBytes)
          throw new Error("A browser upload file changed while it was staged.");
        stagedPaths.push(stagedPath);
      }
      if (reservation.invalidated) throw new Error("The browser document changed during upload staging.");
      return await this.#browser.handleDynamicTool(
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
            if (!stagingRoot || this.#isStopping() || !reservation || reservation.invalidated) {
              throw new Error("The browser document changed while files were being staged.");
            }
            const roots = this.#roots.get(tabId) ?? new Map<string, BrowserUploadRoot[]>();
            // Appended rather than replacing what the input held before. Setting `input.files` again
            // does not invalidate the `File` objects a page already took from it, so deleting the
            // earlier directory here would break a page that is accumulating attachments across
            // selections -- it reads a file that is no longer there. The earlier copies stay until the
            // tab closes, and their bytes keep counting against the quotas.
            roots.set(inputId, [...(roots.get(inputId) ?? []), { path: stagingRoot, bytes: stagedBytes }]);
            this.#roots.set(tabId, roots);
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
      );
    } finally {
      await Promise.allSettled(sources.map((source) => source.handle.close()));
      if (stagingRoot) {
        const unassignedRoot = stagingRoot;
        const cleanup = async () => {
          if (stagingRoot !== unassignedRoot) return;
          stagingRoot = null;
          if (reservation) reservation.root = null;
          releaseReservation();
          await rm(unassignedRoot, { recursive: true, force: true }).catch(() => undefined);
        };
        // The tool can reject while the input-setting operation is still reading the staged files, so
        // cleanup waits for it rather than pulling the directory out from under the renderer.
        if (uploadState.completion) void uploadState.completion.then(cleanup, cleanup);
        else await cleanup();
      } else releaseReservation();
    }
  }

  /** A closed tab can never read its staged files again, so the tab roster shrinking frees them. */
  retainTabs(tabs: readonly { id: string }[]): void {
    const open = new Set(tabs.map((tab) => tab.id));
    for (const tabId of new Set([...this.#roots.keys(), ...this.#reservations.keys()])) {
      if (open.has(tabId)) continue;
      this.#discardTab(tabId);
    }
  }

  /**
   * Cancels staging for a removed document. Assigned files stay: a surviving parent document can
   * retain File objects from the document that navigated. The byte quotas continue to bound them.
   */
  retainDocuments(tabId: string, documentIds: ReadonlySet<string>): void {
    const reservations = this.#reservations.get(tabId);
    if (reservations) {
      for (const [id, reservation] of reservations) {
        if (documentIds.has(reservation.documentId)) continue;
        reservations.delete(id);
        reservation.invalidated = true;
        if (reservation.root) void rm(reservation.root, { recursive: true, force: true }).catch(() => undefined);
      }
      if (reservations.size === 0) this.#reservations.delete(tabId);
    }
  }

  /** Deletes every staging directory. Awaited, because after this the process is expected to exit. */
  async dispose(): Promise<void> {
    const roots = [...this.#roots.values()].flatMap((values) => [...values.values()].flat().map((root) => root.path));
    const reserved = [...this.#reservations.values()].flatMap((values) =>
      [...values.values()].flatMap((reservation) => {
        reservation.invalidated = true;
        return reservation.root ? [reservation.root] : [];
      }),
    );
    this.#roots.clear();
    this.#reservations.clear();
    await Promise.allSettled([...roots, ...reserved].map((root) => rm(root, { recursive: true, force: true })));
  }

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
    const retainedBytes = [...(roots?.values() ?? [])].flat().reduce((total, root) => total + root.bytes, 0);
    const reservedBytes = [...reservations.values()].reduce((total, value) => total + value.bytes, 0);
    if (retainedBytes + reservedBytes + reservation.bytes > MAX_BROWSER_UPLOAD_BYTES_PER_TAB) {
      throw new Error(`A browser tab can retain up to ${MAX_BROWSER_UPLOAD_BYTES_PER_TAB} upload bytes.`);
    }
    const totalRetainedBytes = this.#totalBytes(this.#roots, (inputRoots) =>
      inputRoots.reduce((total, root) => total + root.bytes, 0),
    );
    const totalReservedBytes = this.#totalBytes(this.#reservations, (value) => value.bytes);
    if (totalRetainedBytes + totalReservedBytes + reservation.bytes > MAX_BROWSER_UPLOAD_BYTES_TOTAL) {
      throw new Error(`Browser uploads can retain up to ${MAX_BROWSER_UPLOAD_BYTES_TOTAL} bytes in total.`);
    }
    reservations.set(id, reservation);
    this.#reservations.set(tabId, reservations);
  }

  #totalBytes<Key, Value>(byTab: Map<string, Map<Key, Value>>, bytes: (value: Value) => number): number {
    return [...byTab.values()].reduce(
      (total, values) => total + [...values.values()].reduce((sum, value) => sum + bytes(value), 0),
      0,
    );
  }

  #releaseReservation(tabId: string, id: symbol): void {
    const reservations = this.#reservations.get(tabId);
    if (!reservations) return;
    reservations.delete(id);
    if (reservations.size === 0) this.#reservations.delete(tabId);
  }

  #discardTab(tabId: string): void {
    const roots = this.#roots.get(tabId);
    this.#roots.delete(tabId);
    for (const root of [...(roots?.values() ?? [])].flat()) {
      void rm(root.path, { recursive: true, force: true }).catch(() => undefined);
    }
    const reservations = this.#reservations.get(tabId);
    this.#reservations.delete(tabId);
    for (const reservation of reservations?.values() ?? []) {
      reservation.invalidated = true;
      if (reservation.root) void rm(reservation.root, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
