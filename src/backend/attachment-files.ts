import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  type FileHandle,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative } from "node:path";
import {
  attachmentMimeTypeForName,
  isSupportedAttachmentName,
  SUPPORTED_ATTACHMENT_DESCRIPTION,
} from "@openbot/contracts/attachment-files";
import { ATTACHMENT_LIMITS, INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AttachmentDataInput,
  AttachmentKind,
  AttachmentPreviewKind,
  AttachmentSummary,
  QueueDelivery,
} from "@openbot/contracts/ipc";

const MAX_ATTACHMENTS = INPUT_LIMITS.attachments;
const MAX_FILE_BYTES = ATTACHMENT_LIMITS.fileBytes;
const MAX_TOTAL_BYTES = ATTACHMENT_LIMITS.totalBytes;
const TRANSFER_MANIFEST_FILE = ".openbot-transfer.json";

export interface StoredAttachment extends AttachmentSummary {
  path: string;
  sha256: string;
}

export interface StoredGeneratedAttachment extends StoredAttachment {
  ownerAgentId?: string;
  ownerThreadId?: string | null;
}

export interface StoredDraft extends StoredAttachment {
  createdAt: string;
}

interface TransferManifest {
  /**
   * 2, because the rename changed the field names inside: `recipientBotIds` became `recipientAgentIds` and
   * `ownerBotId` became `ownerAgentId`. Nothing in the app reads this sidecar back -- it is written for the
   * user and the model looking at the transfer directory -- but a released version 1 on disk spells those
   * fields the old way, and leaving both shapes under one number would make the version say nothing.
   */
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

/** Owns managed attachment files, verification, sidecars, and cleanup. Never imports MailboxStore or writes mailbox state. */
export class AttachmentFiles {
  readonly #draftsRoot: string;
  readonly #transfersRoot: string;

  constructor(options: AttachmentFilesOptions) {
    this.#draftsRoot = join(options.userDataPath, "attachment-drafts");
    this.#transfersRoot = join(options.sharedRoot, "Transfers");
  }

  async initialize(): Promise<void> {
    await Promise.all([
      mkdir(this.#draftsRoot, { recursive: true, mode: 0o700 }),
      mkdir(this.#transfersRoot, { recursive: true, mode: 0o700 }),
    ]);
  }

  async resetDrafts(): Promise<void> {
    await this.remove(this.#draftsRoot);
    await mkdir(this.#draftsRoot, { recursive: true, mode: 0o700 });
  }

  transferRoot(id: string): string {
    return join(this.#transfersRoot, id);
  }

  transferRootForPath(path: string): string | null {
    return transferRootForPath(this.#transfersRoot, path);
  }

  generatedRootForPath(path: string): string | null {
    return generatedRootForPath(this.#transfersRoot, path);
  }

  async remove(path: string): Promise<void> {
    await rm(path, { recursive: true, force: true });
  }

  async removeAttachmentDirectories(paths: string[]): Promise<void> {
    await Promise.all(paths.map((path) => this.remove(dirname(path))));
  }

  async discardGenerated(attachments: StoredGeneratedAttachment[]): Promise<void> {
    const roots = attachments
      .map((attachment) => this.generatedRootForPath(attachment.path))
      .filter((path): path is string => path !== null);
    await Promise.allSettled(roots.map((path) => this.remove(path)));
  }

  resolveDraft(attachment: StoredAttachment): Promise<{ path: string; mimeType: string } | null> {
    return resolveManagedAttachment(this.#draftsRoot, attachment);
  }

  resolveTransfer(attachment: StoredAttachment): Promise<{ path: string; mimeType: string } | null> {
    return resolveManagedAttachment(this.#transfersRoot, attachment);
  }

  async prepareDrafts(paths: string[], data: AttachmentDataInput[]): Promise<StoredDraft[]> {
    if (paths.some((path) => !path || path.length > INPUT_LIMITS.path)) {
      throw new Error("An attachment path is invalid.");
    }
    if (
      data.some(
        (item) => item.name.length > INPUT_LIMITS.attachmentName || item.mimeType.length > INPUT_LIMITS.mimeType,
      )
    ) {
      throw new Error("Attachment metadata is too long.");
    }

    const prepared: StoredDraft[] = [];
    let total = 0;
    try {
      for (const sourcePath of paths) {
        const source = await inspectSource(sourcePath);
        const id = randomUUID();
        const targetDirectory = join(this.#draftsRoot, id);
        const name = sanitizeName(source.path);
        assertSupportedAttachmentName(name);
        const targetPath = join(targetDirectory, name);
        await mkdir(targetDirectory, { recursive: true, mode: 0o700 });
        await copyFile(source.path, targetPath);
        const copied = await stat(targetPath);
        if (copied.size > MAX_FILE_BYTES) {
          await rm(targetDirectory, { recursive: true, force: true });
          throw new Error(`${name} exceeds the 100 MB limit.`);
        }
        total += copied.size;
        if (total > MAX_TOTAL_BYTES) {
          await rm(targetDirectory, { recursive: true, force: true });
          throw new Error("Attachments exceed the 250 MB total limit.");
        }
        prepared.push({
          ...attachmentRecord(id, name, copied.size, targetPath, await sha256(targetPath)),
          createdAt: new Date().toISOString(),
        });
      }
      for (const item of data) {
        const bytes = normalizeBytes(item.bytes);
        if (bytes.byteLength > MAX_FILE_BYTES) {
          throw new Error(`${item.name} exceeds the 100 MB limit.`);
        }
        total += bytes.byteLength;
        if (total > MAX_TOTAL_BYTES) throw new Error("Attachments exceed the 250 MB total limit.");
        const id = randomUUID();
        const targetDirectory = join(this.#draftsRoot, id);
        const name = sanitizeName(item.name || "pasted-image.png");
        assertSupportedAttachmentName(name);
        const targetPath = join(targetDirectory, name);
        await mkdir(targetDirectory, { recursive: true, mode: 0o700 });
        await writeFile(targetPath, bytes, { mode: 0o600 });
        prepared.push({
          ...attachmentRecord(
            id,
            name,
            bytes.byteLength,
            targetPath,
            createHash("sha256").update(bytes).digest("hex"),
            item.mimeType,
          ),
          createdAt: new Date().toISOString(),
        });
      }
      return prepared;
    } catch (error) {
      await Promise.all(prepared.map((draft) => rm(dirname(draft.path), { recursive: true, force: true })));
      throw error;
    }
  }

  async commitMessageTransfer(
    transferId: string,
    sender: QueueDelivery["sender"],
    recipientAgentIds: string[],
    messageId: string,
    createdAt: string,
    sourcePaths: string[],
  ): Promise<StoredAttachment[]> {
    if (sourcePaths.length === 0) return [];
    const inspected = await Promise.all(sourcePaths.map(inspectSource));
    const temporaryRoot = join(this.#transfersRoot, `.tmp-${transferId}`);
    const finalRoot = join(this.#transfersRoot, transferId);
    await mkdir(temporaryRoot, { recursive: true, mode: 0o700 });
    const usedNames = new Set<string>();
    try {
      const attachments: StoredAttachment[] = [];
      let total = 0;
      for (const source of inspected) {
        const name = uniqueName(sanitizeName(source.path), usedNames);
        const id = randomUUID();
        const targetPath = join(temporaryRoot, name);
        await copyFile(source.path, targetPath);
        const copied = await stat(targetPath);
        if (copied.size > MAX_FILE_BYTES) throw new Error(`${name} exceeds the 100 MB limit.`);
        total += copied.size;
        if (total > MAX_TOTAL_BYTES) throw new Error("Attachments exceed the 250 MB total limit.");
        attachments.push(attachmentRecord(id, name, copied.size, join(finalRoot, name), await sha256(targetPath)));
      }
      await writeTransferManifest(temporaryRoot, {
        version: 2,
        kind: "message-transfer",
        transferId,
        messageId,
        sender,
        recipientAgentIds,
        createdAt,
        attachments: attachments.map(manifestAttachment),
      });
      await rename(temporaryRoot, finalRoot);
      return attachments;
    } catch (error) {
      await rm(temporaryRoot, { recursive: true, force: true });
      throw error;
    }
  }

  async stageGenerated(input: {
    sources: GeneratedAttachmentSource[];
    ownerAgentId?: string;
    ownerThreadId?: string | null;
  }): Promise<StoredGeneratedAttachment[]> {
    if (input.sources.length === 0 || input.sources.length > MAX_ATTACHMENTS) {
      throw new Error(`Attach between 1 and ${MAX_ATTACHMENTS} files.`);
    }
    const sources = await Promise.all(
      input.sources.map(async (source) => {
        const metadata = await source.handle.stat();
        if (!metadata.isFile()) throw new Error(`Attachment is not a file: ${source.path}`);
        if (metadata.size > MAX_FILE_BYTES) throw new Error(`${basename(source.path)} exceeds the 100 MB limit.`);
        assertSupportedAttachmentName(source.path);
        return { ...source, size: metadata.size };
      }),
    );
    const total = sources.reduce((sum, source) => sum + source.size, 0);
    if (total > MAX_TOTAL_BYTES) throw new Error("Attachments exceed the 250 MB total limit.");

    const usedNames = new Set<string>();
    const entries = sources.map((source) => {
      const id = randomUUID();
      const name = uniqueName(sanitizeName(source.path), usedNames);
      const generatedRoot = join(this.#transfersRoot, "generated", id);
      return { id, name, source, generatedRoot, targetPath: join(generatedRoot, name) };
    });

    try {
      const attachments: StoredGeneratedAttachment[] = [];
      let copiedTotal = 0;
      for (const entry of entries) {
        await mkdir(entry.generatedRoot, { recursive: true, mode: 0o700 });
        await copyOpenedFile(entry.source.handle, entry.targetPath, entry.name, MAX_TOTAL_BYTES - copiedTotal);
        const copied = await stat(entry.targetPath);
        if (copied.size > MAX_FILE_BYTES) throw new Error(`${entry.name} exceeds the 100 MB limit.`);
        copiedTotal += copied.size;
        if (copiedTotal > MAX_TOTAL_BYTES) throw new Error("Attachments exceed the 250 MB total limit.");
        const attachment: StoredGeneratedAttachment = {
          ...attachmentRecord(entry.id, entry.name, copied.size, entry.targetPath, await sha256(entry.targetPath)),
          ...(input.ownerAgentId ? { ownerAgentId: input.ownerAgentId } : {}),
          ...(input.ownerThreadId !== undefined ? { ownerThreadId: input.ownerThreadId } : {}),
        };
        await writeGeneratedManifest(attachment);
        attachments.push(attachment);
      }
      return attachments;
    } catch (error) {
      await Promise.allSettled(entries.map((entry) => rm(entry.generatedRoot, { recursive: true, force: true })));
      throw error;
    }
  }

  async storeGenerated(input: {
    sourcePath?: string;
    bytes?: Uint8Array;
    name?: string;
    mimeType?: string;
    ownerAgentId?: string;
    ownerThreadId?: string | null;
  }): Promise<StoredGeneratedAttachment> {
    if ((input.sourcePath === undefined) === (input.bytes === undefined)) {
      throw new Error("Provide exactly one generated image source.");
    }

    const id = randomUUID();
    const source = input.sourcePath === undefined ? null : await inspectSource(input.sourcePath);
    const bytes = input.bytes === undefined ? null : normalizeBytes(input.bytes);
    const size = source?.size ?? bytes?.byteLength ?? 0;
    if (size > MAX_FILE_BYTES) throw new Error("Generated image exceeds the 100 MB limit.");

    const name = sanitizeName(input.name ?? (source ? basename(source.path) : "generated-image.png"));
    const generatedRoot = join(this.#transfersRoot, "generated", id);
    const targetPath = join(generatedRoot, name);
    await mkdir(generatedRoot, { recursive: true, mode: 0o700 });
    try {
      if (source) await copyFile(source.path, targetPath);
      else if (bytes) await writeFile(targetPath, bytes, { mode: 0o600 });
      else throw new Error("Generated image bytes are missing.");
      const stored = await stat(targetPath);
      if (stored.size > MAX_FILE_BYTES) throw new Error("Generated image exceeds the 100 MB limit.");
      const generatedAttachment: StoredGeneratedAttachment = {
        ...attachmentRecord(id, name, stored.size, targetPath, await sha256(targetPath), input.mimeType),
        ...(input.ownerAgentId ? { ownerAgentId: input.ownerAgentId } : {}),
        ...(input.ownerThreadId !== undefined ? { ownerThreadId: input.ownerThreadId } : {}),
      };
      await writeGeneratedManifest(generatedAttachment);
      return generatedAttachment;
    } catch (error) {
      await rm(generatedRoot, { recursive: true, force: true });
      throw error;
    }
  }

  async exportAttachment(
    attachment: StoredAttachment,
    message?: { id: string; index: number },
  ): Promise<ExportedAttachmentFile | null> {
    const resolved = await this.resolveTransfer(attachment);
    if (!resolved) return null;
    return {
      sourcePath: resolved.path,
      relativePath: join(
        "attachments",
        message ? `${message.index + 1}-${safeArchiveSegment(message.id)}` : "generated",
        `${safeArchiveSegment(attachment.id)}-${safeArchiveSegment(attachment.name)}`,
      ),
    };
  }
}

async function resolveManagedAttachment(
  root: string,
  attachment: StoredAttachment,
): Promise<{ path: string; mimeType: string } | null> {
  try {
    const [canonicalRoot, canonicalPath] = await Promise.all([realpath(root), realpath(attachment.path)]);
    if (!isWithin(canonicalRoot, canonicalPath)) return null;
    const metadata = await stat(canonicalPath);
    if (!metadata.isFile() || metadata.size !== attachment.size) return null;
    if ((await sha256(canonicalPath)) !== attachment.sha256) return null;
    return { path: canonicalPath, mimeType: attachment.mimeType };
  } catch {
    return null;
  }
}

async function writeTransferManifest(directory: string, manifest: TransferManifest): Promise<void> {
  await writeFile(join(directory, TRANSFER_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

async function writeGeneratedManifest(attachment: StoredGeneratedAttachment): Promise<void> {
  await writeTransferManifest(dirname(attachment.path), {
    version: 2,
    kind: "generated-attachment",
    generatedAttachmentId: attachment.id,
    ...(attachment.ownerAgentId ? { ownerAgentId: attachment.ownerAgentId } : {}),
    ...(attachment.ownerThreadId !== undefined ? { ownerThreadId: attachment.ownerThreadId } : {}),
    createdAt: new Date().toISOString(),
    attachments: [manifestAttachment(attachment)],
  });
}

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
    ...attachmentMetadata(name, mimeType),
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

async function inspectSource(sourcePath: string): Promise<{ path: string; size: number }> {
  const path = await realpath(sourcePath);
  const metadata = await stat(path);
  if (!metadata.isFile()) throw new Error(`Only regular files can be attached: ${basename(path)}`);
  if (metadata.size > MAX_FILE_BYTES) throw new Error(`${basename(path)} exceeds the 100 MB limit.`);
  return { path, size: metadata.size };
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

function sanitizeName(path: string): string {
  const value = basename(path)
    .replace(/[^\p{L}\p{N}._ -]+/gu, "-")
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
      .replace(/[^\p{L}\p{N}._ -]+/gu, "-")
      .replace(/^\.+/, "")
      .slice(0, 120) || "item"
  );
}

function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const extension = extname(name);
  const stem = name.slice(0, -extension.length || undefined);
  let index = 2;
  while (used.has(`${stem}-${index}${extension}`)) index += 1;
  const result = `${stem}-${index}${extension}`;
  used.add(result);
  return result;
}

function attachmentMetadata(
  name: string,
  explicitMimeType?: string,
): { kind: AttachmentKind; mimeType: string; previewKind: AttachmentPreviewKind } {
  const inferred = attachmentMimeTypeForName(name);
  // Media stays an opaque file even if an importer supplies a preview MIME type.
  const mimeType =
    inferred.startsWith("audio/") || inferred.startsWith("video/") ? inferred : explicitMimeType?.trim() || inferred;
  const previewKind: AttachmentPreviewKind = mimeType.startsWith("image/")
    ? "image"
    : mimeType === "application/pdf"
      ? "pdf"
      : mimeType.startsWith("text/") || mimeType === "application/json"
        ? "text"
        : "none";
  return { kind: previewKind === "image" ? "image" : "file", mimeType, previewKind };
}

function assertSupportedAttachmentName(name: string): void {
  if (isSupportedAttachmentName(name)) return;
  throw new Error(
    `${name} is not supported. Attach ${SUPPORTED_ATTACHMENT_DESCRIPTION}. For other audio or video formats, export as MP3 or MOV, or attach a text transcript.`,
  );
}

function attachmentPreviewUrl(id: string): string {
  return `openbot-attachment://file/${id}`;
}

export function toAttachmentSummary(attachment: StoredAttachment): AttachmentSummary {
  const metadata = attachmentMetadata(attachment.name, attachment.mimeType);
  return {
    id: attachment.id,
    name: attachment.name,
    size: attachment.size,
    ...metadata,
    // `isStoredAttachment` accepts a persisted attachment with no `previewUrl` at all, from before
    // the field existed. `StoredAttachment extends AttachmentSummary` claims `string | null`, so
    // tsc cannot see the gap — and an `undefined` reaching the summary fails `isAttachmentSummary`
    // at the IPC boundary, which would take the whole conversation down with it.
    previewUrl: attachment.previewUrl ?? null,
  };
}

function normalizeBytes(value: Uint8Array): Uint8Array {
  if (value instanceof Uint8Array) return value;
  throw new Error("Attachment data is invalid.");
}

function isWithin(root: string, path: string): boolean {
  const candidate = relative(root, path);
  return candidate !== "" && !candidate.startsWith("..") && !isAbsolute(candidate);
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

async function copyOpenedFile(
  source: FileHandle,
  targetPath: string,
  name: string,
  remainingTotalBytes: number,
): Promise<void> {
  const target = await open(targetPath, "wx", 0o600);
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let position = 0;
  try {
    while (true) {
      const { bytesRead } = await source.read(buffer, 0, buffer.byteLength, position);
      if (bytesRead === 0) return;
      const nextPosition = position + bytesRead;
      if (nextPosition > MAX_FILE_BYTES) throw new Error(`${name} exceeds the 100 MB limit.`);
      if (nextPosition > remainingTotalBytes) throw new Error("Attachments exceed the 250 MB total limit.");

      let written = 0;
      while (written < bytesRead) {
        const result = await target.write(buffer, written, bytesRead - written, position + written);
        if (result.bytesWritten === 0) throw new Error(`OpenBot could not copy ${name}.`);
        written += result.bytesWritten;
      }
      position = nextPosition;
    }
  } finally {
    await target.close();
  }
}
