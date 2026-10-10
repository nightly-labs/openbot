import { channelAudienceSelection } from "@openbot/contracts/channel-audience-selection";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type ChannelAudienceInput,
  type ChannelAudienceResult,
  type ChannelAudienceTarget,
  decodeChannelAudienceResult,
  parseChannelAudienceInput,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { MOBILE_ATTACHMENT_BYTES } from "@openbot/team-client/remote-peer";
import type { ChatAttachment } from "../../chat/components/use-chat-attachments";
import { isStoredQueueAttachment, type StoredQueueAttachment } from "../../chat/model/queue-edit-draft";
import type { MobileChannelStore } from "./channel-store";

const KEY = "channel-audience-pending-v1";
const ENTRY_LIMIT = 20;
const BYTE_LIMIT = 1024 * 1024;
export interface NativeAudienceStorage {
  get: (key: string) => string | null;
  set: (key: string, value: string) => void;
}
export interface NativeAudienceFiles {
  write: (operationId: string, file: ChatAttachment) => Promise<StoredQueueAttachment>;
  read: (operationId: string, file: StoredQueueAttachment) => Promise<string>;
  remove: (operationId: string, file: StoredQueueAttachment) => Promise<void>;
}
type SourceFile = Pick<StoredQueueAttachment, "id" | "name" | "mimeType" | "size">;
type SavedFile = StoredQueueAttachment & { uploadedId?: string };
interface SavedStop {
  taskId: string;
  operationId: string;
  done: boolean;
}
export interface NativeAudiencePending {
  scope: string;
  input: ChannelAudienceInput;
  files: SavedFile[];
  sources: SourceFile[];
  uploadingId: string | null;
  submitted: boolean;
  result: ChannelAudienceResult | null;
  stops: SavedStop[];
}
export interface NativeAudienceState {
  pending: NativeAudiencePending | null;
  busy: boolean;
  /** Only an explicit Send in this mounted owner can own its current composer. Never hydrated. */
  draftOwnerOperationId: string | null;
  cancelRequested: boolean;
  localConfirmationPending: boolean;
  error: unknown;
}
function invalid(): never {
  throw new Error(sourceText("error.backend.channelAudienceStorageInvalid"));
}
function id(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}
function sourceFile(value: unknown): value is SourceFile {
  return (
    isDynamicRecord(value) &&
    id(value.id) &&
    typeof value.name === "string" &&
    value.name.length <= INPUT_LIMITS.attachmentName &&
    typeof value.mimeType === "string" &&
    value.mimeType.length <= INPUT_LIMITS.mimeType &&
    typeof value.size === "number" &&
    Number.isFinite(value.size) &&
    value.size >= 0 &&
    value.size <= MOBILE_ATTACHMENT_BYTES
  );
}
function savedFile(value: unknown): value is SavedFile {
  return (
    isStoredQueueAttachment(value) &&
    value.name.length <= INPUT_LIMITS.attachmentName &&
    value.mimeType.length <= INPUT_LIMITS.mimeType &&
    value.size <= MOBILE_ATTACHMENT_BYTES &&
    value.fileName.length <= 255 &&
    (!isDynamicRecord(value) || value.uploadedId === undefined || id(value.uploadedId))
  );
}
function read(storage: NativeAudienceStorage): NativeAudiencePending[] {
  const raw = storage.get(KEY);
  if (!raw) return [];
  if (new TextEncoder().encode(raw).byteLength > BYTE_LIMIT) invalid();
  const values = JSON.parse(raw);
  if (!Array.isArray(values) || values.length > ENTRY_LIMIT) invalid();
  const entries = values.map((value): NativeAudiencePending => {
    if (
      !isDynamicRecord(value) ||
      typeof value.scope !== "string" ||
      !value.scope ||
      value.scope.length > 2048 ||
      !Array.isArray(value.sources) ||
      value.sources.length > 10 ||
      !value.sources.every(sourceFile) ||
      !Array.isArray(value.files) ||
      value.files.length > 10 ||
      !value.files.every(savedFile) ||
      !(value.uploadingId === null || id(value.uploadingId)) ||
      typeof value.submitted !== "boolean" ||
      !Array.isArray(value.stops) ||
      value.stops.length > 100
    )
      invalid();
    const input = parseChannelAudienceInput(value.input);
    if (!/^[a-zA-Z0-9_-]+$/u.test(input.operationId)) invalid();
    const files: SavedFile[] = value.files;
    const sources: SourceFile[] = value.sources;
    const result = value.result === null ? null : decodeChannelAudienceResult(value.result);
    if (
      result &&
      ("status" in result
        ? result.channelId !== input.channelId || result.operationId !== input.operationId
        : result.channel.id !== input.channelId)
    )
      invalid();
    const stops = value.stops.map((stop): SavedStop => {
      if (
        !isDynamicRecord(stop) ||
        !id(stop.taskId) ||
        !id(stop.operationId) ||
        typeof stop.done !== "boolean" ||
        !result ||
        "status" in result ||
        !result.targets.some((target) => target.taskId === stop.taskId)
      )
        invalid();
      return { taskId: stop.taskId, operationId: stop.operationId, done: stop.done };
    });
    if (
      new Set(sources.map((file) => file.id)).size !== sources.length ||
      files.some(
        (file, index) =>
          file.id !== sources[index]?.id ||
          file.name !== sources[index]?.name ||
          file.mimeType !== sources[index]?.mimeType ||
          file.size !== sources[index]?.size,
      ) ||
      (value.submitted && files.length !== sources.length) ||
      (result && !value.submitted) ||
      new Set(files.map((file) => file.id)).size !== files.length ||
      new Set(stops.map((stop) => stop.taskId)).size !== stops.length ||
      new Set(stops.map((stop) => stop.operationId)).size !== stops.length ||
      (value.uploadingId && !files.some((file) => file.id === value.uploadingId)) ||
      (value.submitted && (value.uploadingId !== null || files.some((file) => !file.uploadedId))) ||
      input.attachmentDraftIds.length !== files.filter((file) => file.uploadedId).length ||
      input.attachmentDraftIds.some(
        (draftId, index) => draftId !== files.filter((file) => file.uploadedId)[index]?.uploadedId,
      )
    )
      invalid();
    return {
      scope: value.scope,
      input,
      files,
      sources,
      uploadingId: value.uploadingId,
      submitted: value.submitted,
      result,
      stops,
    };
  });
  if (new Set(entries.map((entry) => JSON.stringify([entry.scope, entry.input.channelId]))).size !== entries.length)
    invalid();
  return entries;
}

/** One owned, persistent request. A receipt miss and an upload failure never imply non-acceptance. */
export class NativeChannelAudience {
  private state: NativeAudienceState;
  private listeners = new Set<() => void>();
  private disposed = false;
  private settlement: { owner: NativeAudiencePending; result: ChannelAudienceResult } | null = null;
  constructor(
    private store: MobileChannelStore,
    private scope: string,
    private serverId: string,
    private channelId: string,
    private operationId: () => string,
    private storage: NativeAudienceStorage,
    private files: NativeAudienceFiles,
  ) {
    try {
      this.state = {
        pending: read(storage).find((entry) => entry.scope === scope && entry.input.channelId === channelId) ?? null,
        busy: false,
        draftOwnerOperationId: null,
        cancelRequested: false,
        localConfirmationPending: false,
        error: null,
      };
    } catch (error) {
      this.state = {
        pending: null,
        busy: false,
        draftOwnerOperationId: null,
        cancelRequested: false,
        localConfirmationPending: false,
        error,
      };
    }
  }
  get = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<NativeAudienceState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  private save(pending: NativeAudiencePending | null, owner: NativeAudiencePending | null) {
    const entries = read(this.storage);
    const previous = entries.find((entry) => entry.scope === this.scope && entry.input.channelId === this.channelId);
    if (JSON.stringify(previous ?? null) !== JSON.stringify(owner))
      throw new Error(sourceText("error.backend.channelAudiencePending"));
    const next = entries.filter((entry) => entry !== previous);
    if (pending) next.push(pending);
    const raw = JSON.stringify(next);
    if (next.length > ENTRY_LIMIT || new TextEncoder().encode(raw).byteLength > BYTE_LIMIT)
      throw new Error(sourceText("error.backend.channelAudienceStorageFull"));
    read({ get: () => raw, set: () => undefined });
    this.storage.set(KEY, raw);
    this.publish({ pending });
  }
  private async run(action: () => Promise<void>) {
    if (this.disposed || this.state.busy) throw new Error(sourceText("error.backend.channelAudiencePending"));
    this.publish({ busy: true, error: null, cancelRequested: false });
    try {
      await action();
    } catch (error) {
      this.publish({ error });
      throw error;
    } finally {
      this.publish({ busy: false });
    }
  }
  async send(
    text: string,
    files: ChatAttachment[],
    replyToMessageId: string | null,
    upload?: {
      cancelled: () => boolean;
      progress: (completed: number) => void;
      fileProgress?: (fraction: number) => void;
    },
  ) {
    await this.run(async () => {
      if (!this.store.get(this.serverId).canAudience)
        throw new Error(sourceText("error.backend.channelAudienceUnsupported"));
      const previous = this.state.pending;
      if (previous) {
        if (!previous.result || previous.stops.some((stop) => !stop.done))
          throw new Error(sourceText("error.backend.channelAudiencePending"));
        this.save(null, previous);
        await Promise.allSettled(previous.files.map((file) => this.files.remove(previous.input.operationId, file)));
      }
      const audience = channelAudienceSelection(text);
      if (!audience) throw new Error(sourceText("error.backend.channelAudienceUnsupported"));
      const input = parseChannelAudienceInput({
        channelId: this.channelId,
        operationId: this.operationId(),
        text,
        replyToMessageId,
        audience,
        attachmentDraftIds: [],
      });
      let pending: NativeAudiencePending = {
        scope: this.scope,
        input,
        files: [],
        sources: files.map(({ id, name, mimeType, size }) => ({ id, name, mimeType, size })),
        uploadingId: null,
        submitted: false,
        result: null,
        stops: [],
      };
      // Reserve capacity before local file I/O. No command or upload precedes durable ownership.
      this.save(pending, null);
      this.publish({ draftOwnerOperationId: input.operationId });
      for (const file of files) {
        const saved = await this.files.write(input.operationId, file);
        const next = { ...pending, files: [...pending.files, saved] };
        try {
          this.save(next, pending);
        } catch (error) {
          await this.files.remove(input.operationId, saved).catch(() => undefined);
          throw error;
        }
        pending = next;
      }
      await this.submit(pending, upload);
    });
  }
  private async submit(
    pending: NativeAudiencePending,
    upload?: {
      cancelled: () => boolean;
      progress: (completed: number) => void;
      fileProgress?: (fraction: number) => void;
    },
  ) {
    if (pending.result || pending.uploadingId || pending.files.length !== pending.sources.length)
      throw new Error(sourceText("error.backend.channelAudiencePending"));
    upload?.progress(pending.input.attachmentDraftIds.length);
    for (const file of pending.files) {
      if (file.uploadedId) continue;
      if (this.disposed || this.state.cancelRequested || upload?.cancelled())
        throw new Error(sourceText("error.remote.attachmentUploadCancelled"));
      const base64 = await this.files.read(pending.input.operationId, file);
      if (this.disposed || this.state.cancelRequested || upload?.cancelled())
        throw new Error(sourceText("error.remote.attachmentUploadCancelled"));
      const uploading = { ...pending, uploadingId: file.id };
      this.save(uploading, pending);
      pending = uploading;
      const uploaded = await this.store.upload(
        this.serverId,
        { name: file.name, mimeType: file.mimeType, base64 },
        upload?.fileProgress,
      );
      const next = {
        ...pending,
        uploadingId: null,
        files: pending.files.map((item) => (item.id === file.id ? { ...item, uploadedId: uploaded.id } : item)),
        input: { ...pending.input, attachmentDraftIds: [...pending.input.attachmentDraftIds, uploaded.id] },
      };
      this.save(next, pending);
      pending = next;
      upload?.progress(pending.input.attachmentDraftIds.length);
    }
    if (this.disposed || this.state.cancelRequested || upload?.cancelled())
      throw new Error(sourceText("error.remote.attachmentUploadCancelled"));
    const submitted = { ...pending, submitted: true };
    this.save(submitted, pending);
    await this.settle(submitted, await this.store.audience(this.serverId, submitted.input));
  }
  cancelPreparation = () => {
    if (this.state.busy && this.state.pending && !this.state.pending.submitted) this.publish({ cancelRequested: true });
  };
  private async settle(owner: NativeAudiencePending, result: ChannelAudienceResult) {
    if (
      "status" in result
        ? result.channelId !== this.channelId || result.operationId !== owner.input.operationId
        : result.channel.id !== this.channelId
    )
      invalid();
    this.settlement = { owner, result };
    this.publish({ localConfirmationPending: true });
    this.save({ ...owner, result }, owner);
    this.settlement = null;
    this.publish({ localConfirmationPending: false });
    void this.store.refresh(this.serverId, this.channelId);
  }
  check = () =>
    this.run(async () => {
      if (this.settlement) {
        await this.settle(this.settlement.owner, this.settlement.result);
        return;
      }
      const owner = this.state.pending;
      if (!owner?.submitted || owner.result) return;
      const result = await this.store.audienceReceipt(this.serverId, this.channelId, owner.input.operationId);
      if (result) await this.settle(owner, result);
    });
  retry = () =>
    this.run(async () => {
      if (this.settlement) {
        await this.settle(this.settlement.owner, this.settlement.result);
        return;
      }
      const owner = this.state.pending;
      if (owner) await this.submit(owner);
    });
  /** Closing unknown submitted work is forbidden. Closing unsent work does not cancel an unknown upload. */
  close = () =>
    this.run(async () => {
      const owner = this.state.pending;
      if (!owner || (owner.submitted && !owner.result) || owner.stops.some((stop) => !stop.done))
        throw new Error(sourceText("error.backend.channelAudiencePending"));
      this.save(null, owner);
      await Promise.allSettled(owner.files.map((file) => this.files.remove(owner.input.operationId, file)));
      // Source drafts can belong to a changed composer. Keep them within host quotas.
    });
  stop = (targets: readonly ChannelAudienceTarget[]) =>
    this.run(async () => {
      const pending = this.state.pending;
      if (!pending?.result || "status" in pending.result) return;
      let owner: NativeAudiencePending = pending;
      const accepted = pending.result.targets;
      if (
        targets.some(
          (target) => !accepted.some((item) => item.taskId === target.taskId && item.agentId === target.agentId),
        )
      )
        invalid();
      for (const target of targets) {
        if (this.disposed) return;
        let stop = owner.stops.find((item) => item.taskId === target.taskId);
        if (stop?.done) continue;
        if (!stop) {
          stop = { taskId: target.taskId, operationId: this.operationId(), done: false };
          const next: NativeAudiencePending = { ...owner, stops: [...owner.stops, stop] };
          this.save(next, owner);
          owner = next;
        }
        await this.store.command(this.serverId, {
          type: "stop",
          channelId: this.channelId,
          taskId: target.taskId,
          operationId: stop.operationId,
          recipientAgentId: null,
        });
        const next: NativeAudiencePending = {
          ...owner,
          stops: owner.stops.map((item) => (item.taskId === target.taskId ? { ...item, done: true } : item)),
        };
        this.save(next, owner);
        owner = next;
      }
    });
  dispose() {
    this.disposed = true;
    this.listeners.clear();
  }
}
