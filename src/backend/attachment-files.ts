import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  copyFile,
  type FileHandle,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative } from "node:path";
import { attachmentMimeTypeForName, isSupportedAttachmentName } from "@openbot/contracts/attachment-files";
import { ATTACHMENT_LIMITS, INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AttachmentDataInput,
  AttachmentKind,
  AttachmentPreviewKind,
  AttachmentSummary,
  QueueDelivery,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result } from "effect";
import { isHeldTargetError } from "./atomic-json-file";
import { type AttachmentOperationError, attachmentCall, attachmentFailure, attachmentSync } from "./attachment-effects";
import { sha256File } from "./file-hash";
import { isWithin } from "./workspace-paths";

const MAX_ATTACHMENTS = INPUT_LIMITS.attachments;
const MAX_FILE_BYTES = ATTACHMENT_LIMITS.fileBytes;
const MAX_TOTAL_BYTES = ATTACHMENT_LIMITS.totalBytes;
const SVG_PREVIEW_MAX_BYTES = 10 * 1024 * 1024;
const TRANSFER_MANIFEST_FILE = ".openbot-transfer.json";
const HELD_TRANSFER_WAITS_MS: readonly number[] = [10, 50, 100, 250, 500, 1000, 1000];

export interface StoredAttachment extends AttachmentSummary {
  path: string;
  sha256: string;
  deletedAt?: string;
}

export interface StoredGeneratedAttachment extends StoredAttachment {
  ownerAgentId?: string;
  ownerThreadId?: string | null;
}

export interface StoredDraft extends StoredAttachment {
  ownerEditId?: string | undefined;
  preserveOnRestart?: boolean | undefined;
  createdAt: string;
}

interface TransferManifest {
  version: 2;
  kind: "message-transfer" | "generated-attachment";
  transferId?: string;
  messageId?: string;
  generatedAttachmentId?: string;
  sender?: QueueDelivery["sender"];
  recipientAgentIds?: string[];
  ownerAgentId?: string;
  ownerThreadId?: string | null;
  createdAt: string;
  attachments: Array<{
    id: string;
    name: string;
    relativePath: string;
    size: number;
    kind: AttachmentKind;
    mimeType: string;
    previewKind: AttachmentPreviewKind;
    sha256: string;
  }>;
}

export interface ExportedAttachmentFile {
  sourcePath: string;
  relativePath: string;
}

export interface GeneratedAttachmentSource {
  path: string;
  handle: FileHandle;
}

export interface AttachmentFilesOptions {
  userDataPath: string;
  sharedRoot: string;
}

export class AttachmentFiles {
  readonly #draftsRoot: string;
  readonly #transfersRoot: string;

  constructor(options: AttachmentFilesOptions) {
    this.#draftsRoot = join(options.userDataPath, "attachment-drafts");
    this.#transfersRoot = join(options.sharedRoot, "Transfers");
  }

  readonly initialize = Effect.fn("AttachmentFiles.initialize")(function* (
    this: AttachmentFiles,
  ): Effect.fn.Return<void, AttachmentOperationError> {
    yield* Effect.forEach(
      [this.#draftsRoot, this.#transfersRoot],
      (root) => attachmentCall(() => mkdir(root, { recursive: true, mode: 0o700 })).pipe(Effect.uninterruptible),
      { concurrency: "unbounded" },
    );
  }).bind(this);

  readonly resetDrafts = Effect.fn("AttachmentFiles.resetDrafts")(function* (
    this: AttachmentFiles,
    retainedIds: string[] = [],
  ): Effect.fn.Return<void, AttachmentOperationError> {
    const retained = new Set(retainedIds);
    const entries = yield* attachmentCall(() => readdir(this.#draftsRoot));
    yield* Effect.forEach(
      entries.filter((name) => !retained.has(name)),
      (name) => this.remove(join(this.#draftsRoot, name)),
      { concurrency: "unbounded" },
    );
  }).bind(this);

  transferRoot(id: string): string {
    return join(this.#transfersRoot, id);
  }

  transferRootForPath(path: string): string | null {
    return transferRootForPath(this.#transfersRoot, path);
  }

  generatedRootForPath(path: string): string | null {
    return generatedRootForPath(this.#transfersRoot, path);
  }

  managedTransferFile(path: string): Effect.Effect<string | null, AttachmentOperationError> {
    return Effect.gen({ self: this }, function* () {
      try {
        const [root, candidate] = yield* attachmentCall(() =>
          Promise.all([realpath(this.#transfersRoot), realpath(path)]),
        );
        if (!isWithin(root, candidate)) return null;
        return (yield* attachmentCall(() => lstat(candidate))).isFile() ? candidate : null;
      } catch {
        return null;
      }
    }).pipe(
      Effect.catch(() => Effect.succeed(null)),
      Effect.withSpan("AttachmentFiles.managedTransferFile"),
    );
  }

  readonly remove = Effect.fn("AttachmentFiles.remove")(function* (
    this: AttachmentFiles,
    path: string,
  ): Effect.fn.Return<void, AttachmentOperationError> {
    yield* attachmentCall(() => rm(path, { recursive: true, force: true })).pipe(Effect.uninterruptible);
  }).bind(this);

  readonly removeAttachmentDirectories = Effect.fn("AttachmentFiles.removeAttachmentDirectories")(function* (
    this: AttachmentFiles,
    paths: string[],
  ): Effect.fn.Return<void, AttachmentOperationError> {
    yield* Effect.forEach(paths, (path) => this.remove(dirname(path)), { concurrency: "unbounded" });
  }).bind(this);

  readonly discardGenerated = Effect.fn("AttachmentFiles.discardGenerated")(function* (
    this: AttachmentFiles,
    attachments: StoredGeneratedAttachment[],
  ): Effect.fn.Return<void, AttachmentOperationError> {
    const roots = attachments
      .map((attachment) => this.generatedRootForPath(attachment.path))
      .filter((path): path is string => path !== null);
    yield* Effect.forEach(roots, (path) => Effect.result(this.remove(path)), { concurrency: "unbounded" });
  }).bind(this);

  resolveDraft(attachment: StoredAttachment) {
    return resolveManagedAttachmentEffect(this.#draftsRoot, attachment);
  }
  resolveTransfer(attachment: StoredAttachment) {
    return resolveManagedAttachmentEffect(this.#transfersRoot, attachment);
  }

  readonly prepareDrafts = Effect.fn("AttachmentFiles.prepareDrafts")(function* (
    this: AttachmentFiles,
    paths: string[],
    data: AttachmentDataInput[],
    options: { voiceRecording?: boolean } = {},
  ): Effect.fn.Return<StoredDraft[], AttachmentOperationError> {
    if (paths.some((path) => !path || path.length > INPUT_LIMITS.path)) {
      return yield* attachmentFailure(new Error("An attachment path is invalid."));
    }
    if (
      data.some(
        (item) => item.name.length > INPUT_LIMITS.attachmentName || item.mimeType.length > INPUT_LIMITS.mimeType,
      )
    ) {
      return yield* attachmentFailure(new Error("Attachment metadata is too long."));
    }

    const prepared: StoredDraft[] = [];
    const preparedRoots: string[] = [];
    let total = 0;
    let completed = false;
    return yield* Effect.gen({ self: this }, function* () {
      try {
        for (const sourcePath of paths) {
          const source = yield* inspectSourceEffect(sourcePath);
          const id = randomUUID();
          const targetDirectory = join(this.#draftsRoot, id);
          preparedRoots.push(targetDirectory);
          const name = sanitizeName(source.path);
          const targetPath = join(targetDirectory, name);
          yield* attachmentCall(() => mkdir(targetDirectory, { recursive: true, mode: 0o700 })).pipe(
            Effect.uninterruptible,
          );
          yield* attachmentCall(() => copyFile(source.path, targetPath)).pipe(Effect.uninterruptible);
          const copied = yield* attachmentCall(() => stat(targetPath));
          if (copied.size > MAX_FILE_BYTES) {
            yield* attachmentCall(() => rm(targetDirectory, { recursive: true, force: true })).pipe(
              Effect.uninterruptible,
            );
            throw new Error(sourceText("error.attachment.namedFileTooLarge", { name }));
          }
          total += copied.size;
          if (total > MAX_TOTAL_BYTES) {
            yield* attachmentCall(() => rm(targetDirectory, { recursive: true, force: true })).pipe(
              Effect.uninterruptible,
            );
            throw new Error(sourceText("error.attachment.totalTooLarge"));
          }
          prepared.push({
            ...attachmentRecord(
              id,
              name,
              copied.size,
              targetPath,
              yield* sha256File(targetPath).pipe(Effect.mapError((error) => attachmentFailure(error.cause))),
              yield* heifSafeFileMimeType(name, targetPath),
            ),
            createdAt: new Date().toISOString(),
          });
        }
        for (const item of data) {
          const bytes = normalizeBytes(item.bytes);
          if (bytes.byteLength > MAX_FILE_BYTES) {
            throw new Error(sourceText("error.attachment.namedFileTooLarge", { name: item.name }));
          }
          total += bytes.byteLength;
          if (total > MAX_TOTAL_BYTES) throw new Error(sourceText("error.attachment.totalTooLarge"));
          const id = randomUUID();
          const targetDirectory = join(this.#draftsRoot, id);
          preparedRoots.push(targetDirectory);
          const name = sanitizeName(item.name || "pasted-image.png");
          const mimeType = heifSafeMimeType(
            name,
            bytes,
            options.voiceRecording || isSupportedAttachmentName(name) ? item.mimeType : undefined,
          );
          const targetPath = join(targetDirectory, name);
          yield* attachmentCall(() => mkdir(targetDirectory, { recursive: true, mode: 0o700 })).pipe(
            Effect.uninterruptible,
          );
          yield* attachmentCall(() => writeFile(targetPath, bytes, { mode: 0o600 })).pipe(Effect.uninterruptible);
          prepared.push({
            ...attachmentRecord(
              id,
              name,
              bytes.byteLength,
              targetPath,
              createHash("sha256").update(bytes).digest("hex"),
              mimeType,
            ),
            createdAt: new Date().toISOString(),
          });
        }
        completed = true;
        return prepared;
      } catch (error) {
        return yield* attachmentFailure(error);
      }
    }).pipe(
      Effect.ensuring(
        Effect.gen(function* () {
          if (completed) return;
          yield* attachmentCall(() =>
            Promise.all(preparedRoots.map((root) => rm(root, { recursive: true, force: true }))),
          );
        }).pipe(Effect.orDie),
      ),
    );
  }).bind(this);

  readonly commitMessageTransfer = Effect.fn("AttachmentFiles.commitMessageTransfer")(function* (
    this: AttachmentFiles,
    transferId: string,
    sender: QueueDelivery["sender"],
    recipientAgentIds: string[],
    messageId: string,
    createdAt: string,
    sourcePaths: string[],
  ): Effect.fn.Return<StoredAttachment[], AttachmentOperationError> {
    if (sourcePaths.length === 0) return [];
    const inspected = yield* Effect.forEach(sourcePaths, inspectSourceEffect, { concurrency: "unbounded" });
    const temporaryRoot = join(this.#transfersRoot, `.tmp-${transferId}`);
    const finalRoot = join(this.#transfersRoot, transferId);
    const usedNames = new Set<string>();
    let completed = false;
    return yield* Effect.gen({ self: this }, function* () {
      try {
        yield* attachmentCall(() => mkdir(temporaryRoot, { recursive: true, mode: 0o700 })).pipe(
          Effect.uninterruptible,
        );

        const attachments: StoredAttachment[] = [];
        let total = 0;
        for (const source of inspected) {
          const sourceName = sanitizeName(source.path);
          const name = yield* attachmentCall(async () => {
            while (true) {
              const candidate = uniqueName(sourceName, usedNames);
              try {
                await copyFile(source.path, join(temporaryRoot, candidate), constants.COPYFILE_EXCL);
                return candidate;
              } catch (error) {
                if (error === null || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST") {
                  throw error;
                }
              }
            }
          }).pipe(Effect.uninterruptible);
          const id = randomUUID();
          const targetPath = join(temporaryRoot, name);
          const copied = yield* attachmentCall(() => stat(targetPath));
          if (copied.size > MAX_FILE_BYTES) throw new Error(sourceText("error.attachment.namedFileTooLarge", { name }));
          total += copied.size;
          if (total > MAX_TOTAL_BYTES) throw new Error(sourceText("error.attachment.totalTooLarge"));
          attachments.push(
            attachmentRecord(
              id,
              name,
              copied.size,
              join(finalRoot, name),
              yield* sha256File(targetPath).pipe(Effect.mapError((error) => attachmentFailure(error.cause))),
              yield* heifSafeFileMimeType(name, targetPath),
            ),
          );
        }
        yield* writeTransferManifestEffect(temporaryRoot, {
          version: 2,
          kind: "message-transfer",
          transferId,
          messageId,
          sender,
          recipientAgentIds,
          createdAt,
          attachments: attachments.map(manifestAttachment),
        });
        for (let attempt = 0; ; attempt += 1) {
          const renamed = yield* Effect.result(
            attachmentCall(() => rename(temporaryRoot, finalRoot)).pipe(Effect.uninterruptible),
          );
          if (Result.isSuccess(renamed)) break;
          const wait = HELD_TRANSFER_WAITS_MS[attempt];
          if (wait === undefined || !isHeldTargetError(renamed.failure.cause)) return yield* renamed.failure;
          yield* Effect.sleep(wait);
        }
        completed = true;
        return attachments;
      } catch (error) {
        return yield* attachmentFailure(error);
      }
    }).pipe(
      Effect.ensuring(
        Effect.gen(function* () {
          if (completed) return;
          yield* attachmentCall(() => rm(temporaryRoot, { recursive: true, force: true })).pipe(Effect.uninterruptible);
        }).pipe(Effect.orDie),
      ),
    );
  }).bind(this);

  readonly stageGenerated = Effect.fn("AttachmentFiles.stageGenerated")(function* (
    this: AttachmentFiles,
    input: {
      sources: GeneratedAttachmentSource[];
      ownerAgentId?: string;
      ownerThreadId?: string | null;
    },
  ): Effect.fn.Return<StoredGeneratedAttachment[], AttachmentOperationError> {
    if (input.sources.length === 0 || input.sources.length > MAX_ATTACHMENTS) {
      return yield* attachmentFailure(new Error(sourceText("error.backend.attachBetween", { limit: MAX_ATTACHMENTS })));
    }
    const sources = yield* Effect.forEach(
      input.sources,
      (source) =>
        Effect.gen(function* () {
          const metadata = yield* attachmentCall(() => source.handle.stat());
          if (!metadata.isFile())
            return yield* attachmentFailure(
              new Error(sourceText("error.backend.attachmentNotFile", { path: source.path })),
            );
          if (metadata.size > MAX_FILE_BYTES)
            return yield* attachmentFailure(new Error(`${basename(source.path)} exceeds the 100 MB limit.`));
          return { ...source, size: metadata.size };
        }),
      { concurrency: "unbounded" },
    );
    const total = sources.reduce((sum, source) => sum + source.size, 0);
    if (total > MAX_TOTAL_BYTES)
      return yield* attachmentFailure(new Error(sourceText("error.attachment.totalTooLarge")));

    const usedNames = new Set<string>();
    const entries = sources.map((source) => {
      const id = randomUUID();
      const name = uniqueName(sanitizeName(source.path), usedNames);
      const generatedRoot = join(this.#transfersRoot, "generated", id);
      return { id, name, source, generatedRoot, targetPath: join(generatedRoot, name) };
    });

    let completed = false;
    return yield* Effect.gen({ self: this }, function* () {
      try {
        const attachments: StoredGeneratedAttachment[] = [];
        let copiedTotal = 0;
        for (const entry of entries) {
          yield* attachmentCall(() => mkdir(entry.generatedRoot, { recursive: true, mode: 0o700 })).pipe(
            Effect.uninterruptible,
          );
          yield* copyOpenedFileEffect(entry.source.handle, entry.targetPath, entry.name, MAX_TOTAL_BYTES - copiedTotal);
          const copied = yield* attachmentCall(() => stat(entry.targetPath));
          if (copied.size > MAX_FILE_BYTES) throw new Error(`${entry.name} exceeds the 100 MB limit.`);
          copiedTotal += copied.size;
          if (copiedTotal > MAX_TOTAL_BYTES) throw new Error(sourceText("error.attachment.totalTooLarge"));
          const attachment: StoredGeneratedAttachment = {
            ...attachmentRecord(
              entry.id,
              entry.name,
              copied.size,
              entry.targetPath,
              yield* sha256File(entry.targetPath).pipe(Effect.mapError((error) => attachmentFailure(error.cause))),
            ),
            ...(input.ownerAgentId ? { ownerAgentId: input.ownerAgentId } : {}),
            ...(input.ownerThreadId !== undefined ? { ownerThreadId: input.ownerThreadId } : {}),
          };
          yield* writeGeneratedManifestEffect(attachment);
          attachments.push(attachment);
        }
        completed = true;
        return attachments;
      } catch (error) {
        return yield* attachmentFailure(error);
      }
    }).pipe(
      Effect.ensuring(
        Effect.gen(function* () {
          if (completed) return;
          yield* attachmentCall(() =>
            Promise.allSettled(entries.map((entry) => rm(entry.generatedRoot, { recursive: true, force: true }))),
          );
        }).pipe(Effect.orDie),
      ),
    );
  }).bind(this);

  readonly storeGenerated = Effect.fn("AttachmentFiles.storeGenerated")(function* (
    this: AttachmentFiles,
    input: {
      sourcePath?: string;
      bytes?: Uint8Array;
      kind?: "image" | "video";
      name?: string;
      mimeType?: string;
      ownerAgentId?: string;
      ownerThreadId?: string | null;
    },
  ): Effect.fn.Return<StoredGeneratedAttachment, AttachmentOperationError> {
    if ((input.sourcePath === undefined) === (input.bytes === undefined)) {
      return yield* attachmentFailure(new Error("Provide exactly one generated image source."));
    }

    const id = randomUUID();
    const source = input.sourcePath === undefined ? null : yield* inspectSourceEffect(input.sourcePath);
    const inputBytes = input.bytes;
    const bytes = inputBytes === undefined ? null : yield* attachmentSync(() => normalizeBytes(inputBytes));
    const size = source?.size ?? bytes?.byteLength ?? 0;
    const tooLargeText = sourceText(
      input.kind === "video" ? "error.backend.generatedVideoTooLarge" : "error.backend.generatedImageTooLarge",
    );
    if (size > MAX_FILE_BYTES) return yield* attachmentFailure(new Error(tooLargeText));

    const name = sanitizeName(input.name ?? (source ? basename(source.path) : "generated-image.png"));
    const generatedRoot = join(this.#transfersRoot, "generated", id);
    const targetPath = join(generatedRoot, name);
    let completed = false;
    return yield* Effect.gen({ self: this }, function* () {
      try {
        yield* attachmentCall(() => mkdir(generatedRoot, { recursive: true, mode: 0o700 })).pipe(
          Effect.uninterruptible,
        );

        if (source) yield* attachmentCall(() => copyFile(source.path, targetPath)).pipe(Effect.uninterruptible);
        else if (bytes)
          yield* attachmentCall(() => writeFile(targetPath, bytes, { mode: 0o600 })).pipe(Effect.uninterruptible);
        else throw new Error("Generated image bytes are missing.");
        const stored = yield* attachmentCall(() => stat(targetPath));
        if (stored.size > MAX_FILE_BYTES) throw new Error(tooLargeText);
        const generatedAttachment: StoredGeneratedAttachment = {
          ...attachmentRecord(
            id,
            name,
            stored.size,
            targetPath,
            yield* sha256File(targetPath).pipe(Effect.mapError((error) => attachmentFailure(error.cause))),
            input.mimeType,
          ),
          ...(input.ownerAgentId ? { ownerAgentId: input.ownerAgentId } : {}),
          ...(input.ownerThreadId !== undefined ? { ownerThreadId: input.ownerThreadId } : {}),
        };
        yield* writeGeneratedManifestEffect(generatedAttachment);
        completed = true;
        return generatedAttachment;
      } catch (error) {
        return yield* attachmentFailure(error);
      }
    }).pipe(
      Effect.ensuring(
        Effect.gen(function* () {
          if (completed) return;
          yield* attachmentCall(() => rm(generatedRoot, { recursive: true, force: true })).pipe(Effect.uninterruptible);
        }).pipe(Effect.orDie),
      ),
    );
  }).bind(this);

  readonly exportAttachment = Effect.fn("AttachmentFiles.exportAttachment")(function* (
    this: AttachmentFiles,
    attachment: StoredAttachment,
    message?: { id: string; index: number },
  ): Effect.fn.Return<ExportedAttachmentFile | null, AttachmentOperationError> {
    const resolved = yield* this.resolveTransfer(attachment);
    if (!resolved) return null;
    return {
      sourcePath: resolved.path,
      relativePath: join(
        "attachments",
        message ? `${message.index + 1}-${safeArchiveSegment(message.id)}` : "generated",
        `${safeArchiveSegment(attachment.id)}-${safeArchiveSegment(attachment.name)}`,
      ),
    };
  }).bind(this);
}

const resolveManagedAttachmentEffect = Effect.fn("Attachments.resolveManagedAttachment")(
  function* (
    root: string,
    attachment: StoredAttachment,
  ): Effect.fn.Return<{ path: string; mimeType: string; name: string } | null, AttachmentOperationError> {
    try {
      const [canonicalRoot, canonicalPath] = yield* attachmentCall(() =>
        Promise.all([realpath(root), realpath(attachment.path)]),
      );
      if (!isWithin(canonicalRoot, canonicalPath)) return null;
      const metadata = yield* attachmentCall(() => stat(canonicalPath));
      if (!metadata.isFile() || metadata.size !== attachment.size) return null;
      if (
        (yield* sha256File(canonicalPath).pipe(Effect.mapError((error) => attachmentFailure(error.cause)))) !==
        attachment.sha256
      )
        return null;
      return { path: canonicalPath, mimeType: attachment.mimeType, name: attachment.name };
    } catch {
      return null;
    }
  },
  Effect.catch(() => Effect.succeed(null)),
);

const writeTransferManifestEffect = Effect.fn("Attachments.writeTransferManifest")(function* (
  directory: string,
  manifest: TransferManifest,
): Effect.fn.Return<void, AttachmentOperationError> {
  yield* attachmentCall(() =>
    writeFile(join(directory, TRANSFER_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    }),
  ).pipe(Effect.uninterruptible);
});

const writeGeneratedManifestEffect = Effect.fn("Attachments.writeGeneratedManifest")(function* (
  attachment: StoredGeneratedAttachment,
): Effect.fn.Return<void, AttachmentOperationError> {
  yield* writeTransferManifestEffect(dirname(attachment.path), {
    version: 2,
    kind: "generated-attachment",
    generatedAttachmentId: attachment.id,
    ...(attachment.ownerAgentId ? { ownerAgentId: attachment.ownerAgentId } : {}),
    ...(attachment.ownerThreadId !== undefined ? { ownerThreadId: attachment.ownerThreadId } : {}),
    createdAt: new Date().toISOString(),
    attachments: [manifestAttachment(attachment)],
  });
});

function attachmentRecord(
  id: string,
  name: string,
  size: number,
  path: string,
  digest: string,
  mimeType?: string,
): StoredAttachment {
  return {
    id,
    name,
    size,
    ...attachmentMetadata(name, mimeType, size),
    previewUrl: attachmentPreviewUrl(id),
    path,
    sha256: digest,
  };
}

function manifestAttachment(attachment: StoredAttachment): TransferManifest["attachments"][number] {
  return {
    id: attachment.id,
    name: attachment.name,
    relativePath: attachment.name,
    size: attachment.size,
    kind: attachment.kind,
    mimeType: attachment.mimeType,
    previewKind: attachment.previewKind,
    sha256: attachment.sha256,
  };
}

const inspectSourceEffect = Effect.fn("Attachments.inspectSource")(function* (
  sourcePath: string,
): Effect.fn.Return<{ path: string; size: number }, AttachmentOperationError> {
  const path = yield* attachmentCall(() => realpath(sourcePath));
  const metadata = yield* attachmentCall(() => stat(path));
  if (!metadata.isFile())
    return yield* attachmentFailure(
      new Error(sourceText("error.backend.attachmentNotRegularFile", { name: basename(path) })),
    );
  if (metadata.size > MAX_FILE_BYTES)
    return yield* attachmentFailure(
      new Error(sourceText("error.attachment.namedFileTooLarge", { name: basename(path) })),
    );
  return { path, size: metadata.size };
});

function sanitizeName(path: string): string {
  const value = basename(path)
    .replace(/[^\p{L}\p{M}\p{N}._ -]+/gu, "-")
    .replace(/^\.+/, "")
    .trim();
  if (!value) return "attachment";
  const extension = extname(value);
  if (!extension || extension.length >= 180) return value.slice(0, 180);
  const stem = value.slice(0, -extension.length);
  return `${stem.slice(0, 180 - extension.length)}${extension}`;
}

function safeArchiveSegment(value: string): string {
  return (
    basename(value)
      .replace(/[^\p{L}\p{M}\p{N}._ -]+/gu, "-")
      .replace(/^\.+/, "")
      .slice(0, 120) || "item"
  );
}

function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name.toLowerCase())) {
    used.add(name.toLowerCase());
    return name;
  }
  const extension = extname(name);
  const stem = name.slice(0, -extension.length || undefined);
  let index = 2;
  while (used.has(`${stem}-${index}${extension}`.toLowerCase())) index += 1;
  const result = `${stem}-${index}${extension}`;
  used.add(result.toLowerCase());
  return result;
}

function attachmentMetadata(
  name: string,
  explicitMimeType?: string,
  size = 0,
): { kind: AttachmentKind; mimeType: string; previewKind: AttachmentPreviewKind } {
  const inferred = attachmentMimeTypeForName(name);
  const mimeType =
    inferred.startsWith("audio/") ||
    inferred.startsWith("video/") ||
    inferred === "application/zip" ||
    inferred === "image/svg+xml"
      ? inferred
      : explicitMimeType?.trim() || inferred;
  const previewKind: AttachmentPreviewKind = mimeType.startsWith("image/")
    ? "image"
    : mimeType === "application/pdf"
      ? "pdf"
      : // An email is RFC 822 text, so the lightbox shows it with the text branch. `text` is a
        mimeType.startsWith("text/") || mimeType === "application/json" || mimeType === "message/rfc822"
        ? "text"
        : "none";
  const svg = mimeType.split(";", 1)[0]?.trim().toLowerCase() === "image/svg+xml";
  return {
    kind: previewKind === "image" && !svg ? "image" : "file",
    mimeType,
    previewKind: svg && size > SVG_PREVIEW_MAX_BYTES ? "none" : previewKind,
  };
}

const HEIF_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "mif2", "msf1"]);
const HEIF_HEADER_BYTES = 64;

function isHeifImage(header: Uint8Array): boolean {
  const bytes = Buffer.from(header.subarray(0, HEIF_HEADER_BYTES));
  if (bytes.length < 12 || bytes.toString("latin1", 4, 8) !== "ftyp") return false;
  const end = Math.min(bytes.readUInt32BE(0), bytes.length);
  const brands: string[] = [];
  for (let offset = 8; offset + 4 <= end; offset += offset === 8 ? 8 : 4) {
    brands.push(bytes.toString("latin1", offset, offset + 4));
  }
  return (
    !brands.some((brand) => brand === "avif" || brand === "avis") && brands.some((brand) => HEIF_BRANDS.has(brand))
  );
}

function heifSafeMimeType(name: string, header: Uint8Array, mimeType?: string): string | undefined {
  return attachmentMetadata(name, mimeType).kind === "image" && isHeifImage(header)
    ? "application/octet-stream"
    : mimeType;
}

const heifSafeFileMimeType = Effect.fn("Attachments.heifSafeFileMimeType")(function* (
  name: string,
  path: string,
): Effect.fn.Return<string | undefined, AttachmentOperationError> {
  if (attachmentMetadata(name).kind !== "image") return undefined;
  const header = yield* attachmentCall(async () => {
    const file = await open(path, "r");
    try {
      const buffer = Buffer.alloc(HEIF_HEADER_BYTES);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await file.close();
    }
  });
  return heifSafeMimeType(name, header);
});

function attachmentPreviewUrl(id: string): string {
  return `openbot-attachment://file/${id}`;
}

export function toAttachmentSummary(attachment: StoredAttachment): AttachmentSummary {
  const metadata = attachmentMetadata(attachment.name, attachment.mimeType, attachment.size);
  return {
    id: attachment.id,
    name: attachment.name,
    size: attachment.size,
    ...metadata,
    previewUrl: attachment.previewUrl ?? null,
  };
}

function normalizeBytes(value: Uint8Array): Uint8Array {
  if (value instanceof Uint8Array) return value;
  throw new Error("Attachment data is invalid.");
}

function transferRootForPath(root: string, path: string): string | null {
  const candidate = relative(root, path);
  if (!candidate || candidate.startsWith("..") || isAbsolute(candidate)) return null;
  const segment = candidate.split(/[\\/]/u)[0];
  return segment && !segment.startsWith(".") ? join(root, segment) : null;
}

function generatedRootForPath(root: string, path: string): string | null {
  const candidate = relative(root, path);
  if (!candidate || candidate.startsWith("..") || isAbsolute(candidate)) return null;
  const segments = candidate.split(/[\\/]/u);
  if (segments[0] !== "generated" || !segments[1] || segments[1].startsWith(".")) return null;
  return join(root, "generated", segments[1]);
}

const copyOpenedFileEffect = Effect.fn("Attachments.copyOpenedFile")(
  (source: FileHandle, targetPath: string, name: string, remainingTotalBytes: number) =>
    Effect.acquireUseRelease(
      attachmentCall(() => open(targetPath, "wx", 0o600)),
      (target) =>
        Effect.gen(function* () {
          const buffer = Buffer.allocUnsafe(64 * 1024);
          let position = 0;
          for (;;) {
            const { bytesRead } = yield* attachmentCall(() => source.read(buffer, 0, buffer.byteLength, position));
            if (bytesRead === 0) return;
            const nextPosition = position + bytesRead;
            if (nextPosition > MAX_FILE_BYTES)
              return yield* attachmentFailure(new Error(`${name} exceeds the 100 MB limit.`));
            if (nextPosition > remainingTotalBytes)
              return yield* attachmentFailure(new Error(sourceText("error.attachment.totalTooLarge")));
            let written = 0;
            while (written < bytesRead) {
              const result = yield* attachmentCall(() =>
                target.write(buffer, written, bytesRead - written, position + written),
              );
              if (result.bytesWritten === 0)
                return yield* attachmentFailure(new Error(sourceText("error.backend.attachmentCopyFailed", { name })));
              written += result.bytesWritten;
            }
            position = nextPosition;
          }
        }),
      (target) => attachmentCall(() => target.close()).pipe(Effect.orDie),
    ),
);
