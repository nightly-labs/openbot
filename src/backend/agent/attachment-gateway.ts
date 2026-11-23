import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import { sortConversationMessages } from "@openbot/contracts/conversation-order";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AgentEvent, AttachmentSummary, ConversationSnapshot } from "@openbot/contracts/ipc";
import { Deferred, Effect, Result } from "effect";
import {
  type AttachmentOperationError,
  attachmentCall,
  attachmentFailure,
  attachmentResult,
  attachmentSync,
} from "../attachment-effects";
import type { GeneratedAttachmentSource, MailboxStore } from "../mailbox-store";
import { isWithin, rebaseLegacyWorkspacePath, sharedPathFromInput, workspacePathFromInput } from "../workspace-paths";
import type { ConversationRuntime } from "./conversation-runtime";
import { type AgentLibraryFolders, placeInLibraryFolder } from "./library-folder-tools";
import { type OpenBotToolResponse, openBotToolResult } from "./routine-tools";
import { effectiveAgentFolders } from "./workspace-sandbox";

export interface AttachmentGatewayHooks {
  emit(event: AgentEvent): void;
  emitError(code: string, error: unknown, agentId?: string): void;
}

export interface AttachmentSourceScope {
  allowAnyReadablePath: boolean;
}

const WORKSPACE_OR_SHARED: AttachmentSourceScope = { allowAnyReadablePath: false };

const ANSWER_FILE_BYTES = 25 * 1024 * 1024;
const MAX_ANSWER_FILES = INPUT_LIMITS.attachments;

export interface AttachmentGatewayOptions {
  conversation: ConversationRuntime;
  mailbox: MailboxStore;
  sharedRoot: string;
  libraryFolders?: AgentLibraryFolders | null;
  hooks: AttachmentGatewayHooks;
}

export class AttachmentGateway {
  readonly #conversation: ConversationRuntime;
  readonly #mailbox: MailboxStore;
  readonly #sharedRoot: string;
  readonly #libraryFolders: AgentLibraryFolders | null;
  readonly #hooks: AttachmentGatewayHooks;
  readonly #inFlight = new Map<string, Deferred.Deferred<OpenBotToolResponse, AttachmentOperationError>>();

  constructor(options: AttachmentGatewayOptions) {
    this.#conversation = options.conversation;
    this.#mailbox = options.mailbox;
    this.#sharedRoot = options.sharedRoot;
    this.#libraryFolders = options.libraryFolders ?? null;
    this.#hooks = options.hooks;
  }

  readonly attachFiles = Effect.fn("AttachmentGateway.attachFiles")(function* (
    this: AttachmentGateway,
    senderAgentId: string,
    params: { threadId: string; turnId: string; callId: string },
    paths: string[],
    messageId: string,
    folder?: string,
  ) {
    const inFlight = this.#inFlight.get(messageId);
    if (inFlight) return yield* Deferred.await(inFlight);
    const completion = Deferred.makeUnsafe<OpenBotToolResponse, AttachmentOperationError>();
    this.#inFlight.set(messageId, completion);
    const exit = yield* Effect.exit(this.#attachFilesToResponse(senderAgentId, params, paths, messageId, folder));
    yield* Deferred.done(completion, exit);
    if (this.#inFlight.get(messageId) === completion) this.#inFlight.delete(messageId);
    return yield* exit;
  }, Effect.uninterruptible).bind(this);

  openSources(
    agentId: string,
    paths: string[],
    scope: AttachmentSourceScope,
  ): Effect.Effect<GeneratedAttachmentSource[], AttachmentOperationError> {
    return this.#openSources(agentId, paths, scope);
  }

  readonly attachAnswerFiles = Effect.fn("AttachmentGateway.attachAnswerFiles")(function* (
    this: AttachmentGateway,
    agentId: string,
    snapshot: ConversationSnapshot,
    answer: ConversationSnapshot["messages"][number],
    paths: string[],
  ) {
    const attachedNames = new Set(
      snapshot.messages
        .filter((message) => message.turnId === answer.turnId)
        .flatMap((message) => (message.attachments ?? []).map((attachment) => attachment.name)),
    );
    const sources: GeneratedAttachmentSource[] = [];
    for (const path of paths) {
      if (sources.length === MAX_ANSWER_FILES) break;
      if (attachedNames.has(basename(path))) continue;
      const opened = yield* Effect.result(this.#openSourceEffect(agentId, path, WORKSPACE_OR_SHARED));
      if (Result.isFailure(opened)) continue;
      const source = opened.success;
      const metadata = yield* Effect.result(attachmentCall(() => source.handle.stat()));
      if (
        Result.isSuccess(metadata) &&
        metadata.success.size <= ANSWER_FILE_BYTES &&
        !sources.some((kept) => kept.path === source.path)
      )
        sources.push(source);
      else yield* attachmentCall(() => source.handle.close()).pipe(Effect.ignore);
    }
    if (sources.length === 0) return;
    yield* Effect.gen({ self: this }, function* () {
      const staged = yield* this.#mailbox
        .stageGeneratedAttachments({ sources, ownerAgentId: agentId, ownerThreadId: snapshot.threadId })
        .pipe(Effect.mapError((failure) => attachmentFailure(failure.cause)));
      const { attachments } = yield* this.#withoutTurnCopies(snapshot, answer.turnId, staged);
      if (attachments.length === 0) return;
      const previous = answer.attachments;
      answer.attachments = [...(previous ?? []), ...attachments];
      try {
        const persisted = this.#mailbox.persistGeneratedAttachmentsWithConversation(
          snapshot,
          "response.path-attachments-added",
          { turnId: answer.turnId, messageId: answer.id, attachmentCount: attachments.length },
          attachments.map((attachment) => attachment.id),
        );
        snapshot.revision = persisted.revision;
      } catch (error) {
        if (previous) answer.attachments = previous;
        else delete answer.attachments;
        yield* this.#mailbox
          .discardStagedGeneratedAttachments(attachments.map((attachment) => attachment.id))
          .pipe(Effect.mapError((failure) => attachmentFailure(failure.cause)));
        return yield* attachmentFailure(error);
      }
    }).pipe(
      Effect.ensuring(
        attachmentCall(() => Promise.allSettled(sources.map((source) => source.handle.close()))).pipe(Effect.orDie),
      ),
    );
  }, Effect.uninterruptible).bind(this);

  readonly #withoutTurnCopies = Effect.fn("AttachmentGateway.withoutTurnCopies")(function* (
    this: AttachmentGateway,
    snapshot: ConversationSnapshot,
    turnId: string | undefined,
    staged: AttachmentSummary[],
  ) {
    if (turnId === undefined) return { attachments: staged, shown: [] };
    const shownByDigest = new Map<string, AttachmentSummary>();
    for (const message of snapshot.messages) {
      if (message.turnId !== turnId) continue;
      for (const attachment of message.attachments ?? []) {
        const digest = this.#mailbox.attachmentSha256(attachment.id);
        if (digest && !shownByDigest.has(digest)) shownByDigest.set(digest, attachment);
      }
    }
    const attachments: AttachmentSummary[] = [];
    const shown: AttachmentSummary[] = [];
    const copies: string[] = [];
    for (const attachment of staged) {
      const digest = this.#mailbox.attachmentSha256(attachment.id);
      const original = digest ? shownByDigest.get(digest) : undefined;
      if (original) {
        shown.push(original);
        copies.push(attachment.id);
      } else attachments.push(attachment);
    }
    if (copies.length > 0) yield* this.#mailbox.discardStagedGeneratedAttachments(copies).pipe(Effect.ignore);
    return { attachments, shown };
  });

  pendingCommands(): Effect.Effect<OpenBotToolResponse, AttachmentOperationError>[] {
    return [...this.#inFlight.values()].map(Deferred.await);
  }

  dispose(): void {
    this.#inFlight.clear();
  }

  readonly #attachFilesToResponse = Effect.fn("AttachmentGateway.attachFilesToResponse")(function* (
    this: AttachmentGateway,
    senderAgentId: string,
    params: { threadId: string; turnId: string; callId: string },
    paths: string[],
    messageId: string,
    folder: string | undefined,
  ): Effect.fn.Return<OpenBotToolResponse, AttachmentOperationError> {
    const publicThreadId = this.#conversation.publicThreadId(senderAgentId, params.threadId);
    const snapshot = this.#conversation.ensureSnapshot(senderAgentId, publicThreadId);
    const existing = snapshot.messages.find((message) => message.id === messageId);
    if (existing) return yield* this.#attachedResult(senderAgentId, messageId, existing.attachments ?? [], [], folder);

    return yield* Effect.acquireUseRelease(
      this.#openSources(senderAgentId, paths, WORKSPACE_OR_SHARED),
      (sources) =>
        Effect.gen({ self: this }, function* () {
          const staged = yield* this.#mailbox
            .stageGeneratedAttachments({
              sources,
              ownerAgentId: senderAgentId,
              ownerThreadId: publicThreadId,
            })
            .pipe(Effect.mapError((failure) => attachmentFailure(failure.cause)));
          const { attachments, shown } = yield* this.#withoutTurnCopies(snapshot, params.turnId, staged);
          const alreadyShown = shown.map((attachment) => ({ id: attachment.id, name: attachment.name }));
          if (attachments.length === 0) {
            return yield* this.#attachedResult(senderAgentId, null, [], alreadyShown, folder);
          }
          const message: ConversationSnapshot["messages"][number] = {
            id: messageId,
            turnId: params.turnId,
            author: "assistant",
            source: "assistant",
            text: "",
            createdAt: new Date().toISOString(),
            status: "completed",
            itemType: "agent_attachment",
            attachments,
          };
          snapshot.messages.push(message);
          sortConversationMessages(snapshot.messages);
          try {
            const persisted = this.#mailbox.persistGeneratedAttachmentsWithConversation(
              snapshot,
              "response.attachments-added",
              {
                turnId: params.turnId,
                messageId,
                attachmentCount: attachments.length,
              },
              attachments.map((attachment) => attachment.id),
            );
            snapshot.revision = persisted.revision;
            this.#conversation.rememberConversationSignature(snapshot);
          } catch (error) {
            const messageIndex = snapshot.messages.findIndex((candidate) => candidate.id === messageId);
            if (messageIndex >= 0) snapshot.messages.splice(messageIndex, 1);
            yield* this.#mailbox
              .discardStagedGeneratedAttachments(attachments.map((attachment) => attachment.id))
              .pipe(Effect.mapError((failure) => attachmentFailure(failure.cause)));
            return yield* attachmentFailure(error);
          }
          try {
            this.#hooks.emit({ type: "conversation", snapshot: structuredClone(snapshot) });
          } catch (error) {
            try {
              this.#hooks.emitError("conversation_publication_failed", error, senderAgentId);
            } catch {}
          }
          return yield* this.#attachedResult(senderAgentId, messageId, attachments, alreadyShown, folder);
        }),
      (sources) =>
        attachmentCall(() => Promise.allSettled(sources.map((source) => source.handle.close()))).pipe(Effect.orDie),
    );
  });

  readonly #attachedResult = Effect.fn("AttachmentGateway.attachedResult")(function* (
    this: AttachmentGateway,
    senderAgentId: string,
    messageId: string | null,
    attachments: readonly { id: string; name: string }[],
    alreadyShown: readonly { id: string; name: string }[],
    folder: string | undefined,
  ): Effect.fn.Return<OpenBotToolResponse, AttachmentOperationError> {
    const placed =
      folder === undefined
        ? null
        : yield* placeInLibraryFolder(
            this.#libraryFolders,
            senderAgentId,
            folder,
            [...attachments, ...alreadyShown].map((attachment) => attachment.id),
          );
    return yield* attachmentCall(() =>
      openBotToolResult({
        status: "attached",
        ...(messageId === null ? {} : { messageId }),
        attachments: attachments.map((attachment) => ({ id: attachment.id, name: attachment.name })),
        ...(alreadyShown.length > 0 ? { alreadyShown } : {}),
        ...(placed === null ? {} : { folder: placed }),
      }),
    );
  });

  readonly #openSources = Effect.fn("AttachmentGateway.openSources")(function* (
    this: AttachmentGateway,
    agentId: string,
    paths: string[],
    scope: AttachmentSourceScope,
  ): Effect.fn.Return<GeneratedAttachmentSource[], AttachmentOperationError> {
    const results = yield* Effect.forEach(
      paths,
      (path) => Effect.result(this.#openSourceEffect(agentId, path, scope)),
      { concurrency: "unbounded" },
    );
    const sources = results.flatMap((result) => (Result.isSuccess(result) ? [result.success] : []));
    const failure = results.find(Result.isFailure);
    if (failure) {
      yield* attachmentCall(() => Promise.allSettled(sources.map((source) => source.handle.close())));
      return yield* failure.failure;
    }
    if (sources.length !== new Set(sources.map((source) => source.path)).size) {
      yield* attachmentCall(() => Promise.allSettled(sources.map((source) => source.handle.close())));
      return yield* attachmentFailure(new Error("Duplicate attachment paths are not allowed."));
    }
    return yield* attachmentCall(() => sources);
  });

  readonly #openSourceEffect = Effect.fn("AttachmentGateway.openSource")(function* (
    this: AttachmentGateway,
    agentId: string,
    inputPath: string,
    scope: AttachmentSourceScope,
  ): Effect.fn.Return<GeneratedAttachmentSource, AttachmentOperationError> {
    const agent = yield* attachmentSync(() => this.#conversation.requireKnownAgent(agentId));
    const value = inputPath.trim();
    const [workspaceRoot, sharedRoot] = yield* attachmentCall(() =>
      Promise.all([realpath(agent.workspacePath), realpath(this.#sharedRoot)]),
    );
    const folderRoots = yield* attachmentCall(async () =>
      (await Promise.allSettled(effectiveAgentFolders(agent).map((folder) => realpath(folder)))).flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      ),
    );
    const normalized = value.replaceAll("\\", "/");
    const sharedReference = ["~/OpenBot/Shared/", "OpenBot/Shared/", "Shared/"].some((prefix) =>
      normalized.startsWith(prefix),
    );
    const candidates = isAbsolute(value)
      ? [value, rebaseLegacyWorkspacePath(agent.workspacePath, agent.id, value)].filter((path) => path !== null)
      : sharedReference
        ? [sharedPathFromInput(this.#sharedRoot, value)]
        : [workspacePathFromInput(agent.workspacePath, agent.id, value), sharedPathFromInput(this.#sharedRoot, value)];

    const reasons: string[] = [];
    for (const candidate of candidates) {
      try {
        if (
          !scope.allowAnyReadablePath &&
          attachmentResult(yield* Effect.result(attachmentCall(() => lstat(candidate)))).isSymbolicLink()
        ) {
          reasons.push("the path is a symbolic link");
          continue;
        }
        const resolved = attachmentResult(yield* Effect.result(attachmentCall(() => realpath(candidate))));
        if (
          !scope.allowAnyReadablePath &&
          ![workspaceRoot, sharedRoot, ...folderRoots].some((root) => isWithin(root, resolved))
        ) {
          reasons.push("the file is outside these folders");
          continue;
        }
        const authorizedMetadata = attachmentResult(yield* Effect.result(attachmentCall(() => lstat(resolved))));
        if (authorizedMetadata.isSymbolicLink() || !authorizedMetadata.isFile()) {
          reasons.push("the path is not a regular file");
          continue;
        }
        let retained = false;
        return attachmentResult(
          yield* Effect.result(
            Effect.acquireUseRelease(
              attachmentCall(() => open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW)),
              (handle) =>
                Effect.gen(function* () {
                  const openedMetadata = yield* attachmentCall(() => handle.stat());
                  if (
                    !openedMetadata.isFile() ||
                    openedMetadata.dev !== authorizedMetadata.dev ||
                    openedMetadata.ino !== authorizedMetadata.ino
                  ) {
                    return yield* attachmentFailure(new Error("The attachment changed while it was being opened."));
                  }
                  retained = true;
                  return { path: resolved, handle };
                }),
              (handle) => (retained ? Effect.void : attachmentCall(() => handle.close()).pipe(Effect.orDie)),
            ),
          ),
        );
      } catch (error) {
        reasons.push(sourceFailureReason(error));
      }
    }
    if (lostBackslashes(value)) {
      reasons.unshift("the path lost its backslashes; write it with forward slashes, such as C:/Users/…");
    }
    return yield* attachmentFailure(
      new Error(
        `${
          scope.allowAnyReadablePath
            ? "Upload files must exist, be regular files, and be readable by OpenBot."
            : "Attachment files must exist inside this agent's workspace or the OpenBot shared directory."
        } Reason: ${[...new Set(reasons)].join("; ")}.`,
      ),
    );
  });
}

function lostBackslashes(path: string): boolean {
  return /^[a-z]:(?![\\/])/iu.test(path) || [...path].some((character) => character.charCodeAt(0) < 0x20);
}

function sourceFailureReason(error: unknown): string {
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return "syscall" in error && typeof error.syscall === "string" ? `${error.code} from ${error.syscall}` : error.code;
  }
  return error instanceof Error ? error.message.replace(/\.$/, "") : String(error);
}
