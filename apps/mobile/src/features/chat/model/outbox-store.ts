import { sourceText } from "@openbot/i18n/source";
import { MOBILE_ATTACHMENT_BYTES } from "@openbot/team-client/remote-peer";
import type { ChatAttachment } from "../components/use-chat-attachments";
import {
  type DecodedOutbox,
  type OutboxFile,
  type OutboxMessage,
  type OutboxTarget,
  outboxRetrySafe,
  outboxTargetKey,
  type PersistedOutbox,
} from "./outbox";
import { ChatUploadCancelledError } from "./upload-chat-attachments";

export interface OutboxStorage {
  load: () => Promise<DecodedOutbox | null>;
  save: (outbox: PersistedOutbox) => Promise<void>;
  keepUnreadable: () => Promise<void>;
  writeFiles: (clientMessageId: string, files: readonly ChatAttachment[]) => Promise<OutboxFile[]>;
  readFile: (clientMessageId: string, file: OutboxFile) => Promise<string>;
  fileUri: (clientMessageId: string, file: OutboxFile) => string;
  removeFiles: (clientMessageId: string) => Promise<void>;
}

export interface OutboxDelivery {
  files: ChatAttachment[];
  cancelled: () => boolean;
  progress: (completed: number) => void;
  fileProgress: (fraction: number) => void;
  beforeStore: (repeatSafe: boolean) => Promise<void>;
}

export type OutboxDeliveryResult = { messageId: string | null };

type OutboxDeliverer = (message: OutboxMessage, delivery: OutboxDelivery) => Promise<OutboxDeliveryResult>;

export interface OutboxUpload {
  completed: number;
  current: number;
  cancelling: boolean;
}

export interface OutboxSnapshot {
  messages: readonly OutboxMessage[];
  uploads: ReadonlyMap<string, OutboxUpload>;
  storing: ReadonlySet<string>;
  online: ReadonlySet<string>;
  editing: ReadonlySet<string>;
  storageFailed: boolean;
}

export interface OutboxDraft {
  text: string;
  replyToMessageId: string | null;
  files: ChatAttachment[];
}

class OutboxRepeatUnsafeError extends Error {
  constructor() {
    super("The host may have stored this message, and a repeat could store it again.");
  }
}

interface OutboxStoreOptions {
  storage: OutboxStorage | null;
  deliver: OutboxDeliverer;
  describeError: (error: unknown) => string;
  reportFailure?: (error: unknown, message: OutboxMessage) => void;
  now?: () => number;
  randomId: () => string;
}

export class OutboxStore {
  private messages: OutboxMessage[] = [];
  private snapshotValue: OutboxSnapshot = {
    messages: [],
    uploads: new Map(),
    storing: new Set(),
    online: new Set(),
    editing: new Set(),
    storageFailed: false,
  };
  private readonly listeners = new Set<() => void>();
  private readonly memoryFiles = new Map<string, ChatAttachment[]>();
  private readonly saving = new Map<string, Promise<void>>();
  private readonly uploads = new Map<string, OutboxUpload>();
  private storing: ReadonlySet<string> = new Set();
  private readonly cancelRequests = new Set<string>();
  private readonly holds = new Set<string>();
  private readonly notSentAttempts = new Map<string, number>();
  private readonly notSentTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private editing: ReadonlySet<string> = new Set();
  private online: ReadonlySet<string> = new Set();
  private storageFailed = false;
  private loaded = false;
  private loading: Promise<void> | null = null;
  private canSave = true;
  private dirty = false;
  private looping = false;
  private writing: Promise<void> = Promise.resolve();
  private readonly now: () => number;

  constructor(private readonly options: OutboxStoreOptions) {
    this.now = options.now ?? Date.now;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = (): OutboxSnapshot => this.snapshotValue;

  filesInMemory(clientMessageId: string): readonly ChatAttachment[] {
    return this.memoryFiles.get(clientMessageId) ?? [];
  }

  previewUri(message: OutboxMessage, file: OutboxFile): string | null {
    const memory = this.memoryFiles.get(message.clientMessageId)?.find((item) => item.id === file.id);
    if (memory) return memory.uri ?? `data:${memory.mimeType};base64,${memory.base64}`;
    return file.fileName && this.options.storage ? this.options.storage.fileUri(message.clientMessageId, file) : null;
  }

  load(): Promise<void> {
    this.loading ??= this.readSaved();
    return this.loading;
  }

  private async readSaved(): Promise<void> {
    const { storage } = this.options;
    if (!storage) {
      this.loaded = true;
      this.pump();
      return;
    }
    let restored: OutboxMessage[] = [];
    try {
      const saved = await storage.load();
      if (saved?.dropped) await storage.keepUnreadable();
      restored = saved?.messages ?? [];
    } catch {
      this.canSave = false;
      this.storageFailed = true;
    }
    const now = this.now();
    const kept: OutboxMessage[] = [];
    for (const message of restored) {
      if (message.state === "sent") {
        void storage.removeFiles(message.clientMessageId).catch(() => undefined);
        continue;
      }
      kept.push(
        message.state === "failed"
          ? { ...message, returned: false }
          : outboxRetrySafe(message, now)
            ? { ...message, state: "waiting", returned: false }
            : { ...message, state: "failed", returned: false, repeatSafe: false },
      );
    }
    this.messages = [...kept, ...this.messages];
    this.loaded = true;
    this.publish();
    if (this.dirty || kept.length !== restored.length) void this.persist();
    this.pump();
  }

  setOnline(serverIds: ReadonlySet<string>): void {
    const reconnected = new Set([...serverIds].filter((id) => !this.online.has(id)));
    this.online = serverIds;
    for (const message of this.messages)
      if (reconnected.has(message.target.serverId)) this.clearNotSentRetry(message.clientMessageId);
    if (reconnected.size) {
      const now = this.now();
      this.messages = this.messages.map((message) =>
        message.state === "failed" &&
        !message.returned &&
        !message.stopped &&
        reconnected.has(message.target.serverId) &&
        outboxRetrySafe(message, now)
          ? { ...message, state: "waiting", error: null }
          : message,
      );
    }
    this.publish();
    this.pump();
  }

  add(
    target: OutboxTarget,
    input: { text: string; replyToMessageId: string | null; files: readonly ChatAttachment[] },
    replaces: readonly string[] = [],
  ): OutboxMessage {
    const clientMessageId = this.options.randomId();
    const files = input.files.map((file, index) => ({
      ...file,
      id: `mobile-draft-attachment-${clientMessageId}-${index}`,
    }));
    const message: OutboxMessage = {
      clientMessageId,
      target,
      text: input.text,
      replyToMessageId: input.replyToMessageId,
      files: files.map((file) => ({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        size: file.size,
        fileName: "",
        ...(file.dimensions ? { dimensions: file.dimensions } : {}),
      })),
      createdAt: new Date(this.now()).toISOString(),
      firstAttemptAt: null,
      repeatSafe: false,
      state: "waiting",
      messageId: null,
      error: null,
      returned: false,
      stopped: false,
    };
    this.memoryFiles.set(clientMessageId, files);
    this.messages = [...this.messages, message];
    this.publish();
    const saved = this.save(message, files);
    if (files.some((file) => file.file)) this.saving.set(clientMessageId, saved);
    void saved.then(() => {
      this.saving.delete(clientMessageId);
      for (const id of replaces) void this.cancel(id);
    });
    this.pump();
    return message;
  }

  private async save(message: OutboxMessage, files: ChatAttachment[]): Promise<void> {
    const { storage } = this.options;
    if (!storage) return;
    try {
      if (files.length) {
        const stored = await storage.writeFiles(message.clientMessageId, files);
        if (!this.messages.some((item) => item.clientMessageId === message.clientMessageId)) {
          await storage.removeFiles(message.clientMessageId);
          return;
        }
        this.update(message.clientMessageId, { files: stored });
        if (files.some((file) => file.file))
          this.memoryFiles.set(
            message.clientMessageId,
            files.map((file, index) => {
              const saved = stored[index];
              if (!file.file || !saved) return file;
              const uri = storage.fileUri(message.clientMessageId, saved);
              return { ...file, uri, file: { ref: uri, size: file.file.size } };
            }),
          );
      }
      await this.persist();
    } catch {
      if (!this.messages.some((item) => item.clientMessageId === message.clientMessageId)) {
        await storage.removeFiles(message.clientMessageId).catch(() => undefined);
        return;
      }
      this.storageFailed = true;
      this.publish();
    }
  }

  retry(clientMessageId: string): void {
    const message = this.find(clientMessageId);
    if (message?.state !== "failed") return;
    this.clearNotSentRetry(clientMessageId);
    if (!outboxRetrySafe(message, this.now())) {
      this.update(clientMessageId, { repeatSafe: false });
    } else {
      this.update(clientMessageId, { state: "waiting", error: null, returned: false, stopped: false });
    }
    void this.persist();
    this.pump();
  }

  async cancel(clientMessageId: string): Promise<void> {
    if (!this.take(clientMessageId)) return;
    await this.forget(clientMessageId);
  }

  async edit(clientMessageId: string): Promise<OutboxDraft | null> {
    const message = this.find(clientMessageId);
    if (!message || !removable(message) || this.holds.has(clientMessageId) || this.editing.has(clientMessageId))
      return null;
    this.holds.add(clientMessageId);
    let files: ChatAttachment[];
    try {
      files = await this.readFiles(message);
    } catch (error) {
      this.holds.delete(clientMessageId);
      this.pump();
      throw error;
    }
    this.holds.delete(clientMessageId);
    const current = this.find(clientMessageId);
    if (!current || !removable(current)) return null;
    this.editing = new Set([...this.editing, clientMessageId]);
    this.clearNotSentRetry(clientMessageId);
    this.update(clientMessageId, { state: "failed", error: null, returned: false, stopped: true });
    await this.persist();
    this.pump();
    return { text: message.text, replyToMessageId: message.replyToMessageId, files };
  }

  stopEditing(clientMessageIds: Iterable<string>): void {
    const ids = new Set(clientMessageIds);
    if (![...ids].some((id) => this.editing.has(id))) return;
    this.editing = new Set([...this.editing].filter((id) => !ids.has(id)));
    this.publish();
  }

  cancelUpload(clientMessageId: string): void {
    const upload = this.uploads.get(clientMessageId);
    if (!upload) return;
    this.cancelRequests.add(clientMessageId);
    this.uploads.set(clientMessageId, { ...upload, cancelling: true });
    this.publish();
  }

  settle(clientMessageIds: readonly string[]): void {
    const settled = this.messages.filter(
      (message) => message.state === "sent" && clientMessageIds.includes(message.clientMessageId),
    );
    if (!settled.length) return;
    this.messages = this.messages.filter((message) => !settled.includes(message));
    this.publish();
    for (const message of settled) void this.forget(message.clientMessageId);
  }

  private take(clientMessageId: string): OutboxMessage | null {
    const message = this.find(clientMessageId);
    if (!message || !removable(message)) return null;
    this.clearNotSentRetry(clientMessageId);
    this.messages = this.messages.filter((item) => item !== message);
    if (this.editing.has(clientMessageId))
      this.editing = new Set([...this.editing].filter((id) => id !== clientMessageId));
    this.publish();
    this.pump();
    return message;
  }

  private async forget(clientMessageId: string): Promise<void> {
    this.memoryFiles.delete(clientMessageId);
    await this.persist();
    await this.options.storage?.removeFiles(clientMessageId).catch(() => undefined);
  }

  private find(clientMessageId: string): OutboxMessage | undefined {
    return this.messages.find((message) => message.clientMessageId === clientMessageId);
  }

  private update(clientMessageId: string, patch: Partial<OutboxMessage>): OutboxMessage | undefined {
    let updated: OutboxMessage | undefined;
    this.messages = this.messages.map((message) => {
      if (message.clientMessageId !== clientMessageId) return message;
      updated = { ...message, ...patch };
      return updated;
    });
    this.publish();
    return updated;
  }

  private async readFiles(message: OutboxMessage): Promise<ChatAttachment[]> {
    await this.saving.get(message.clientMessageId);
    const memory = this.memoryFiles.get(message.clientMessageId);
    if (memory) return memory;
    const { storage } = this.options;
    if (!storage) return [];
    return Promise.all(
      message.files.map(async (file) => {
        const item = {
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          size: file.size,
          ...(file.dimensions ? { dimensions: file.dimensions } : {}),
        };
        if (file.size <= MOBILE_ATTACHMENT_BYTES)
          return { ...item, base64: await storage.readFile(message.clientMessageId, file) };
        const uri = storage.fileUri(message.clientMessageId, file);
        return { ...item, base64: "", uri, file: { ref: uri, size: file.size } };
      }),
    );
  }

  private persist(): Promise<void> {
    this.dirty = true;
    if (!this.loaded || !this.options.storage) return Promise.resolve();
    if (!this.looping) {
      this.looping = true;
      this.writing = this.writeLoop();
    }
    return this.writing;
  }

  private async writeLoop(): Promise<void> {
    const { storage } = this.options;
    try {
      while (this.dirty && storage && this.canSave) {
        this.dirty = false;
        await storage.save({ version: 1, messages: this.messages.filter((message) => !hasUnsavedFiles(message)) });
      }
    } catch {
      this.storageFailed = true;
      this.publish();
    } finally {
      this.looping = false;
    }
  }

  private pump(): void {
    if (!this.loaded) return;
    const blocked = new Set<string>();
    for (const message of this.messages) {
      const key = outboxTargetKey(message.target);
      if (
        blocked.has(key) ||
        message.state === "sent" ||
        message.state === "failed" ||
        this.editing.has(message.clientMessageId)
      )
        continue;
      blocked.add(key);
      const current = this.find(message.clientMessageId);
      if (
        current?.state === "waiting" &&
        !this.holds.has(current.clientMessageId) &&
        !this.notSentTimers.has(current.clientMessageId) &&
        this.online.has(current.target.serverId)
      )
        void this.start(current);
    }
  }

  private async start(queued: OutboxMessage): Promise<void> {
    const { clientMessageId } = queued;
    if (!outboxRetrySafe(queued, this.now())) {
      this.update(clientMessageId, { state: "failed", repeatSafe: false, error: null });
      void this.persist();
      this.pump();
      return;
    }
    const sending = this.update(clientMessageId, { state: "sending", error: null });
    if (!sending) return;
    this.cancelRequests.delete(clientMessageId);
    if (sending.files.length) this.setUpload(clientMessageId, { completed: 0, current: 0, cancelling: false });
    let result: OutboxDeliveryResult;
    try {
      const files = await this.readFiles(sending);
      result = await this.options.deliver(sending, {
        files,
        cancelled: () => this.cancelRequests.has(clientMessageId),
        progress: (completed) => this.patchUpload(clientMessageId, { completed, current: 0 }),
        fileProgress: (current) => this.patchUpload(clientMessageId, { current }),
        beforeStore: async (repeatSafe) => {
          const current = this.find(clientMessageId);
          if (!current) return;
          if (current.firstAttemptAt !== null && !repeatSafe) throw new OutboxRepeatUnsafeError();
          if (current.firstAttemptAt === null) {
            this.update(clientMessageId, { firstAttemptAt: new Date(this.now()).toISOString(), repeatSafe });
            await this.persist();
          }
          this.storing = new Set([...this.storing, clientMessageId]);
          this.publish();
        },
      });
    } catch (error) {
      this.finishUpload(clientMessageId);
      this.fail(clientMessageId, error);
      return;
    }
    this.finishUpload(clientMessageId);
    this.notSentAttempts.delete(clientMessageId);
    if (result.messageId !== null) {
      this.update(clientMessageId, { state: "sent", messageId: result.messageId });
    } else {
      this.messages = this.messages.filter((message) => message.clientMessageId !== clientMessageId);
      this.publish();
      void this.forget(clientMessageId);
    }
    void this.persist();
    this.pump();
  }

  private fail(clientMessageId: string, error: unknown): void {
    const message = this.find(clientMessageId);
    if (!message) return;
    if (error instanceof ChatUploadCancelledError || this.cancelRequests.has(clientMessageId)) {
      this.cancelRequests.delete(clientMessageId);
      this.update(clientMessageId, { state: "failed", error: null, returned: true });
    } else if (error instanceof OutboxRepeatUnsafeError || !outboxRetrySafe(message, this.now())) {
      this.update(clientMessageId, { state: "failed", repeatSafe: false, error: null });
    } else if (!this.online.has(message.target.serverId)) {
      this.update(clientMessageId, { state: "waiting", error: null });
    } else if (stoppedBeforeSend(error) && this.retryNotSentLater(clientMessageId)) {
      this.update(clientMessageId, { state: "waiting", error: null });
    } else {
      this.notSentAttempts.delete(clientMessageId);
      this.options.reportFailure?.(error, message);
      this.update(clientMessageId, { state: "failed", error: this.options.describeError(error) });
    }
    void this.persist();
    this.pump();
  }

  private retryNotSentLater(clientMessageId: string): boolean {
    const attempt = this.notSentAttempts.get(clientMessageId) ?? 0;
    if (attempt >= NOT_SENT_RETRY_LIMIT) return false;
    this.notSentAttempts.set(clientMessageId, attempt + 1);
    clearTimeout(this.notSentTimers.get(clientMessageId));
    this.notSentTimers.set(
      clientMessageId,
      setTimeout(() => {
        this.notSentTimers.delete(clientMessageId);
        this.pump();
      }, notSentRetryDelay(attempt)),
    );
    return true;
  }

  private clearNotSentRetry(clientMessageId: string): void {
    clearTimeout(this.notSentTimers.get(clientMessageId));
    this.notSentTimers.delete(clientMessageId);
    this.notSentAttempts.delete(clientMessageId);
  }

  private setUpload(clientMessageId: string, upload: OutboxUpload): void {
    this.uploads.set(clientMessageId, upload);
    this.publish();
  }

  private patchUpload(clientMessageId: string, patch: Partial<OutboxUpload>): void {
    const upload = this.uploads.get(clientMessageId);
    if (upload) this.setUpload(clientMessageId, { ...upload, ...patch });
  }

  private finishUpload(clientMessageId: string): void {
    const uploading = this.uploads.delete(clientMessageId);
    const storing = this.storing.has(clientMessageId);
    if (storing) this.storing = new Set([...this.storing].filter((id) => id !== clientMessageId));
    if (storing || uploading) this.publish();
  }

  private publish(): void {
    this.snapshotValue = {
      messages: this.messages,
      uploads: new Map(this.uploads),
      storing: this.storing,
      online: this.online,
      editing: this.editing,
      storageFailed: this.storageFailed,
    };
    for (const listener of this.listeners) listener();
  }
}

const NOT_SENT_RETRY_FIRST_MS = 1_000;
const NOT_SENT_RETRY_MAX_MS = 16_000;
const NOT_SENT_RETRY_LIMIT = 6;

function notSentRetryDelay(attempt: number): number {
  return Math.min(NOT_SENT_RETRY_FIRST_MS * 2 ** attempt, NOT_SENT_RETRY_MAX_MS);
}

function stoppedBeforeSend(error: unknown): boolean {
  return error instanceof Error && error.message === sourceText("error.remote.selectedServerOffline");
}

function removable(message: OutboxMessage): boolean {
  return message.state === "waiting" || message.state === "failed";
}

function hasUnsavedFiles(message: OutboxMessage): boolean {
  return message.files.some((file) => !file.fileName);
}
