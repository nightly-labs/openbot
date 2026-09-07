import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { FailureCode } from "@openbot/contracts/analytics-failures";
import type { AgentEvent, ConversationSnapshot } from "@openbot/contracts/ipc";
import { sortConversationMessages } from "../conversation-snapshots";
import type { GeneratedAttachmentSource, MailboxStore } from "../mailbox-store";
import { isWithin, rebaseLegacyWorkspacePath, sharedPathFromInput, workspacePathFromInput } from "../workspace-paths";
import type { ConversationRuntime } from "./conversation-runtime";
import { type OpenBotToolResponse, openBotToolResult } from "./routine-tools";

export interface AttachmentGatewayHooks {
  emit(event: AgentEvent): void;
  emitError(code: FailureCode, error: unknown, agentId?: string): void;
}

/**
 * Where a path a tool named is allowed to point.
 *
 * The default is the attachment policy: the file must resolve inside this agent's own workspace or the
 * OpenBot shared directory, and a symlink anywhere on the way is refused outright.
 *
 * `allowAnyReadablePath` is the browser-upload policy. `openbot_browser.upload_files` hands a local
 * file to a page, and the file the user names is almost never one the agent already copied into its
 * workspace, so containment would make the tool unusable. It grants no capability an agent does not
 * already have -- agents run with `danger-full-access` and could copy the file into the workspace first
 * and reach the same bytes -- and it drops exactly two checks: the containment guard, and the symlink
 * pre-check that would refuse a path reached through a link the agent does not own. Everything that
 * makes the open itself safe still runs: the file must be a regular file, it is opened `O_NOFOLLOW` on
 * its fully resolved path, and its dev/ino are re-validated after the open, so a path swapped
 * mid-flight is still rejected.
 */
export interface AttachmentSourceScope {
  allowAnyReadablePath: boolean;
}

const WORKSPACE_OR_SHARED: AttachmentSourceScope = { allowAnyReadablePath: false };

export interface AttachmentGatewayOptions {
  conversation: ConversationRuntime;
  mailbox: MailboxStore;
  /** `AgentStore.sharedRoot`, passed as a string so this class never opens the store. */
  sharedRoot: string;
  hooks: AttachmentGatewayHooks;
}

/**
 * The `attach_files_to_response` tool: opens agent-workspace files with
 * TOCTOU-safe checks and stages them as a completed `agent_attachment`
 * message on the sender's conversation.
 *
 * Owns the in-flight dedup map keyed by
 * `responseAttachmentMessageId(threadId, turnId, callId)`, so a retried tool
 * call joins the running command instead of staging the files twice. Path
 * policy (workspace-or-shared, no symlinks, `O_NOFOLLOW`, dev/ino
 * re-validation after open) lives in `#openSource` — the one reason this
 * file changes.
 */
export class AttachmentGateway {
  readonly #conversation: ConversationRuntime;
  readonly #mailbox: MailboxStore;
  readonly #sharedRoot: string;
  readonly #hooks: AttachmentGatewayHooks;
  readonly #inFlight = new Map<string, Promise<OpenBotToolResponse>>();

  constructor(options: AttachmentGatewayOptions) {
    this.#conversation = options.conversation;
    this.#mailbox = options.mailbox;
    this.#sharedRoot = options.sharedRoot;
    this.#hooks = options.hooks;
  }

  attachFiles(
    senderAgentId: string,
    params: { threadId: string; turnId: string; callId: string },
    paths: string[],
    messageId: string,
  ): Promise<OpenBotToolResponse> {
    const inFlight = this.#inFlight.get(messageId);
    if (inFlight) return inFlight;
    const command = this.#attachFilesToResponse(senderAgentId, params, paths, messageId);
    this.#inFlight.set(messageId, command);
    return command.finally(() => {
      if (this.#inFlight.get(messageId) === command) this.#inFlight.delete(messageId);
    });
  }

  /**
   * Opens local files for a caller that stages them itself instead of attaching them to a conversation
   * -- `browser-uploads.ts` copies them into a private staging directory before a page ever sees them.
   * The handles belong to the caller, which must close every one it is given.
   */
  openSources(agentId: string, paths: string[], scope: AttachmentSourceScope): Promise<GeneratedAttachmentSource[]> {
    return this.#openSources(agentId, paths, scope);
  }

  pendingCommands(): Promise<OpenBotToolResponse>[] {
    return [...this.#inFlight.values()];
  }

  dispose(): void {
    this.#inFlight.clear();
  }

  async #attachFilesToResponse(
    senderAgentId: string,
    params: { threadId: string; turnId: string; callId: string },
    paths: string[],
    messageId: string,
  ): Promise<OpenBotToolResponse> {
    const publicThreadId = this.#conversation.publicThreadId(senderAgentId, params.threadId);
    const snapshot = this.#conversation.ensureSnapshot(senderAgentId, publicThreadId);
    const existing = snapshot.messages.find((message) => message.id === messageId);
    if (existing) {
      return openBotToolResult({
        status: "attached",
        messageId,
        attachments: (existing.attachments ?? []).map((attachment) => ({
          id: attachment.id,
          name: attachment.name,
        })),
      });
    }

    const sources = await this.#openSources(senderAgentId, paths, WORKSPACE_OR_SHARED);
    let attachments: Awaited<ReturnType<MailboxStore["stageGeneratedAttachments"]>>;
    try {
      attachments = await this.#mailbox.stageGeneratedAttachments({
        sources,
        ownerAgentId: senderAgentId,
        ownerThreadId: publicThreadId,
      });
    } finally {
      await Promise.allSettled(sources.map((source) => source.handle.close()));
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
      await this.#mailbox.discardStagedGeneratedAttachments(attachments.map((attachment) => attachment.id));
      throw error;
    }
    try {
      this.#hooks.emit({ type: "conversation", snapshot: structuredClone(snapshot) });
    } catch (error) {
      try {
        this.#hooks.emitError("conversation_publication_failed", error, senderAgentId);
      } catch {
        // A committed attachment remains successful even if event listeners fail.
      }
    }
    return openBotToolResult({
      status: "attached",
      messageId,
      attachments: attachments.map((attachment) => ({ id: attachment.id, name: attachment.name })),
    });
  }

  async #openSources(
    agentId: string,
    paths: string[],
    scope: AttachmentSourceScope,
  ): Promise<GeneratedAttachmentSource[]> {
    const results = await Promise.allSettled(paths.map((path) => this.#openSource(agentId, path, scope)));
    const sources = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") {
      await Promise.allSettled(sources.map((source) => source.handle.close()));
      throw failure.reason;
    }
    if (sources.length !== new Set(sources.map((source) => source.path)).size) {
      await Promise.allSettled(sources.map((source) => source.handle.close()));
      throw new Error("Duplicate attachment paths are not allowed.");
    }
    return sources;
  }

  async #openSource(
    agentId: string,
    inputPath: string,
    scope: AttachmentSourceScope,
  ): Promise<GeneratedAttachmentSource> {
    const agent = this.#conversation.requireKnownAgent(agentId);
    const value = inputPath.trim();
    const [workspaceRoot, sharedRoot] = await Promise.all([realpath(agent.workspacePath), realpath(this.#sharedRoot)]);
    const normalized = value.replaceAll("\\", "/");
    const sharedReference = ["~/OpenBot/Shared/", "OpenBot/Shared/", "Shared/"].some((prefix) =>
      normalized.startsWith(prefix),
    );
    // An absolute path may be one the provider's own transcript still names under this agent's pre-rename
    // workspace root. The rebased twin is just another candidate, so it goes through the same containment
    // and symlink checks below as the original.
    const candidates = isAbsolute(value)
      ? [value, rebaseLegacyWorkspacePath(agent.workspacePath, agent.id, value)].filter((path) => path !== null)
      : sharedReference
        ? [sharedPathFromInput(this.#sharedRoot, value)]
        : [workspacePathFromInput(agent.workspacePath, agent.id, value), sharedPathFromInput(this.#sharedRoot, value)];

    for (const candidate of candidates) {
      try {
        if (!scope.allowAnyReadablePath && (await lstat(candidate)).isSymbolicLink()) continue;
        const resolved = await realpath(candidate);
        if (!scope.allowAnyReadablePath && !isWithin(workspaceRoot, resolved) && !isWithin(sharedRoot, resolved)) {
          continue;
        }
        const authorizedMetadata = await lstat(resolved);
        if (authorizedMetadata.isSymbolicLink() || !authorizedMetadata.isFile()) continue;
        const handle = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const openedMetadata = await handle.stat();
          if (
            !openedMetadata.isFile() ||
            openedMetadata.dev !== authorizedMetadata.dev ||
            openedMetadata.ino !== authorizedMetadata.ino
          ) {
            throw new Error("The attachment changed while it was being opened.");
          }
          return { path: resolved, handle };
        } catch (error) {
          await handle.close();
          throw error;
        }
      } catch {
        // Try the other permitted root for relative paths.
      }
    }
    throw new Error(
      scope.allowAnyReadablePath
        ? "Upload files must exist, be regular files, and be readable by OpenBot."
        : "Attachment files must exist inside this agent's workspace or the OpenBot shared directory.",
    );
  }
}
