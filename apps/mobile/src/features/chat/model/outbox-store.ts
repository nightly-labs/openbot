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

/** The phone's copy of the outbox. Every method can fail with an I/O error. */
export interface OutboxStorage {
  /** The saved outbox, or null when there is none. Throws when the file exists but cannot be read. */
  load: () => Promise<DecodedOutbox | null>;
  save: (outbox: PersistedOutbox) => Promise<void>;
  /** Keeps a copy of a saved outbox that this version could not read fully, before it is replaced. */
  keepUnreadable: () => Promise<void>;
  writeFiles: (clientMessageId: string, files: readonly ChatAttachment[]) => Promise<OutboxFile[]>;
  readFile: (clientMessageId: string, file: OutboxFile) => Promise<string>;
  /** The file's address on this phone, for an image preview. */
  fileUri: (clientMessageId: string, file: OutboxFile) => string;
  removeFiles: (clientMessageId: string) => Promise<void>;
}

export interface OutboxDelivery {
  /** The files with their bytes, in order. */
  files: ChatAttachment[];
  cancelled: () => boolean;
  progress: (completed: number) => void;
  fileProgress: (fraction: number) => void;
  /**
   * Call right before the request that can store the message. `repeatSafe` says whether the host
   * answers a repeat with the first receipt. Rejects when the message may be stored and a repeat is
   * not safe.
   */
  beforeStore: (repeatSafe: boolean) => Promise<void>;
}

/** A channel message has no message ID: the channel history shows it once the host stored it. */
export type OutboxDeliveryResult = { messageId: string | null };

type OutboxDeliverer = (message: OutboxMessage, delivery: OutboxDelivery) => Promise<OutboxDeliveryResult>;

export interface OutboxUpload {
  completed: number;
  /** The sent fraction of file number `completed`, from 0 to 1. */
  current: number;
  cancelling: boolean;
}

export interface OutboxSnapshot {
  messages: readonly OutboxMessage[];
  uploads: ReadonlyMap<string, OutboxUpload>;
  /** Messages whose request that can store them is in flight. Their host row can arrive before the receipt. */
  storing: ReadonlySet<string>;
  online: ReadonlySet<string>;
  /** Messages whose text and files are in a composer after Edit. The chat does not draw them. */
  editing: ReadonlySet<string>;
  /** The phone could not save or read the outbox. Unsaved messages send only while the app runs. */
  storageFailed: boolean;
}

/** What Edit gives back to the composer. */
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
  /** The text of a failed attempt, in the reader's language. */
  describeError: (error: unknown) => string;
  /** Reports a failed attempt. A stopped upload is not a failure. */
  reportFailure?: (error: unknown, message: OutboxMessage) => void;
  now?: () => number;
  randomId: () => string;
}

/**
 * The messages that the person sent and the host has not drawn yet, for every chat of one account.
 * The phone keeps them over a restart. Each chat sends its messages one at a time, in order, while
 * its server is online. A failed message stops the messages behind it until the person retries,
 * edits or cancels it.
 */
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
  /** The bytes of files added in this run. Sent messages use them to fill the preview cache. */
  private readonly memoryFiles = new Map<string, ChatAttachment[]>();
  private readonly uploads = new Map<string, OutboxUpload>();
  /** Replaced on each change only, so a progress update does not draw the chat's rows again. */
  private storing: ReadonlySet<string> = new Set();
  private readonly cancelRequests = new Set<string>();
  /** Messages that Edit reads back. They neither start nor leave the outbox until it is done. */
  private readonly holds = new Set<string>();
  /** Messages that a composer has after Edit. They stay saved and stopped, and nothing sends them. */
  private editing: ReadonlySet<string> = new Set();
  private online: ReadonlySet<string> = new Set();
  private storageFailed = false;
  /** Saves wait for the load: a save before it would replace messages that the phone kept. */
  private loaded = false;
  private loading: Promise<void> | null = null;
  /** No save after a load that failed: the file may still hold messages this run could not read. */
  private canSave = true;
  private dirty = false;
  /** Set and cleared in the same task as the loop's last check, so no change waits for a loop that ended. */
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

  /** The bytes of a message's files added in this run, for the preview cache. */
  filesInMemory(clientMessageId: string): readonly ChatAttachment[] {
    return this.memoryFiles.get(clientMessageId) ?? [];
  }

  /** Where a pending row reads an image: the chosen file, its bytes, or the outbox copy. */
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
      // The host transcript is the truth for a message with a receipt.
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
    // Messages saved before this run are older than the ones added while it loaded.
    this.messages = [...kept, ...this.messages];
    this.loaded = true;
    this.publish();
    if (this.dirty || kept.length !== restored.length) void this.persist();
    this.pump();
  }

  /** The servers online now. A server that comes back retries its failed messages that are safe to repeat. */
  setOnline(serverIds: ReadonlySet<string>): void {
    const reconnected = new Set([...serverIds].filter((id) => !this.online.has(id)));
    this.online = serverIds;
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

  /**
   * Adds a message at the end of its chat, and saves it on the phone at once. `replaces` are the
   * messages that Edit gave to its composer: they go when the save of this one ends, so that an app
   * closed before then still has the original.
   */
  add(
    target: OutboxTarget,
    input: { text: string; replyToMessageId: string | null; files: readonly ChatAttachment[] },
    replaces: readonly string[] = [],
  ): OutboxMessage {
    const clientMessageId = this.options.randomId();
    // Composer file ids restart in each chat, and an outbox outlives the chat that wrote it.
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
    void this.save(message, files).then(() => {
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
      }
      await this.persist();
    } catch {
      // A message cancelled during the write has no files to keep.
      if (!this.messages.some((item) => item.clientMessageId === message.clientMessageId)) {
        await storage.removeFiles(message.clientMessageId).catch(() => undefined);
        return;
      }
      this.storageFailed = true;
      this.publish();
    }
  }

  /** Sends a failed message again, if a repeat cannot store it twice. */
  retry(clientMessageId: string): void {
    const message = this.find(clientMessageId);
    if (message?.state !== "failed") return;
    if (!outboxRetrySafe(message, this.now())) {
      this.update(clientMessageId, { repeatSafe: false });
    } else {
      this.update(clientMessageId, { state: "waiting", error: null, returned: false, stopped: false });
    }
    void this.persist();
    this.pump();
  }

  /** Removes a message that is not sending, and lets the messages behind it go. */
  async cancel(clientMessageId: string): Promise<void> {
    if (!this.take(clientMessageId)) return;
    await this.forget(clientMessageId);
  }

  /**
   * Gives the text, reply and files of a message that is not sending to the composer. The message
   * stays saved, stopped, until the composer sends the change (`cancel`) or the chat closes
   * (`stopEditing`): a composer draft is not saved.
   */
  async edit(clientMessageId: string): Promise<OutboxDraft | null> {
    const message = this.find(clientMessageId);
    if (!message || !removable(message) || this.holds.has(clientMessageId) || this.editing.has(clientMessageId))
      return null;
    // Read the files first: when the read fails, the message stays where it is.
    this.holds.add(clientMessageId);
    let files: ChatAttachment[];
    try {
      files = await this.readFiles(message);
    } catch (error) {
      this.holds.delete(clientMessageId);
      this.pump();
      throw error;
    }
    // Stop it before anything can start it: the messages behind it go after this.
    this.holds.delete(clientMessageId);
    const current = this.find(clientMessageId);
    if (!current || !removable(current)) return null;
    this.editing = new Set([...this.editing, clientMessageId]);
    this.update(clientMessageId, { state: "failed", error: null, returned: false, stopped: true });
    await this.persist();
    this.pump();
    return { text: message.text, replyToMessageId: message.replyToMessageId, files };
  }

  /** Shows again the messages of an edit that was not sent. They wait, stopped, for the person. */
  stopEditing(clientMessageIds: Iterable<string>): void {
    const ids = new Set(clientMessageIds);
    if (![...ids].some((id) => this.editing.has(id))) return;
    this.editing = new Set([...this.editing].filter((id) => !ids.has(id)));
    this.publish();
  }

  /** Stops the upload of a sending message. The chat then puts it back in the composer. */
  cancelUpload(clientMessageId: string): void {
    const upload = this.uploads.get(clientMessageId);
    if (!upload) return;
    this.cancelRequests.add(clientMessageId);
    this.uploads.set(clientMessageId, { ...upload, cancelling: true });
    this.publish();
  }

  /** Drops sent messages whose host row the chat draws now. */
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
    const memory = this.memoryFiles.get(message.clientMessageId);
    if (memory) return memory;
    const { storage } = this.options;
    if (!storage) return [];
    return Promise.all(
      message.files.map(async (file) => ({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        size: file.size,
        base64: await storage.readFile(message.clientMessageId, file),
        ...(file.dimensions ? { dimensions: file.dimensions } : {}),
      })),
    );
  }

  /** Writes the outbox after every change. Writes run one at a time; the last one has the latest list. */
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
        // A file write that has not finished has no name yet. Its message is saved when it has one.
        await storage.save({ version: 1, messages: this.messages.filter((message) => !hasUnsavedFiles(message)) });
      }
    } catch {
      this.storageFailed = true;
      this.publish();
    } finally {
      this.looping = false;
    }
  }

  /** Starts the oldest waiting message of each chat whose server is online, unless one sends. */
  private pump(): void {
    if (!this.loaded) return;
    const blocked = new Set<string>();
    for (const message of this.messages) {
      const key = outboxTargetKey(message.target);
      if (blocked.has(key) || message.state === "sent" || this.editing.has(message.clientMessageId)) continue;
      blocked.add(key);
      // A start changes the list. Read the message as it is now.
      const current = this.find(message.clientMessageId);
      if (
        current?.state === "waiting" &&
        !this.holds.has(current.clientMessageId) &&
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
            // A restart after this point knows that the host may have the message.
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
    if (result.messageId !== null) {
      this.update(clientMessageId, { state: "sent", messageId: result.messageId });
    } else {
      // A channel send waited for the history of an open channel: the chat already draws the host's row.
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
      // The connection went: the message waits for it and goes again on its own.
      this.update(clientMessageId, { state: "waiting", error: null });
    } else {
      this.options.reportFailure?.(error, message);
      this.update(clientMessageId, { state: "failed", error: this.options.describeError(error) });
    }
    void this.persist();
    this.pump();
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

function removable(message: OutboxMessage): boolean {
  return message.state === "waiting" || message.state === "failed";
}

function hasUnsavedFiles(message: OutboxMessage): boolean {
  return message.files.some((file) => !file.fileName);
}
