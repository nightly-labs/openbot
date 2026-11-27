import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { itemTypeCountsAsUnread } from "@openbot/contracts/conversation-read";
import {
  AGENT_RUNTIME_TEXT_LIMIT,
  type ChannelCommand,
  type ChannelSummary,
  canAdministerServer,
  type SidebarLayoutSnapshot,
  type SidebarPin,
  type TeamMemberSummary,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import { encodeTeamCapabilitiesV10, TEAM_CURRENT_CAPABILITIES } from "@openbot/contracts/team-protocol/current";
import type { ServerAppearance } from "@openbot/contracts/team-protocol/host-appearance-v1";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_CAPABILITIES_HEADER,
  TEAM_PROTOCOL_VERSION_HEADER,
} from "@openbot/contracts/team-protocol/v1";
import { TEAM_ABSENT_CAPABILITIES_HEADER, TEAM_PROTOCOL_V10 } from "@openbot/contracts/team-protocol/v10";
import type { WatchCommand, WatchErrorCode, WatchResult, WatchSnapshot } from "@openbot/contracts/watch-protocol";
import { localizeSourceText } from "@openbot/i18n/mobile";
import { Effect, Option, Result, Schema } from "effect";
import type { TeamApiAgents } from "./team-api/dependencies";
import { seesChannel } from "./team-api/route-channels";
import { buildHostWatchSnapshot, type WatchText, watchAvatarName, watchTextFor } from "./watch-relay-snapshot";
import type { WatchWidgetPushService } from "./watch-widget-push";

const AVATAR_REPLY_LIMIT = 48_000;
const SESSION_LIFETIME_MS = 60_000;
const CALL_TIMEOUT_MS = 15_000;
const READ_PAGE_LIMIT = 50;
const FULL_REPLY_PAGE_LIMIT = 20;
const FULL_REPLY_CACHE_LIMIT = 64;

export const WATCH_READ_OPTIONS = {
  excludeRoutineEvents: false,
  excludeRoutineRunEvents: false,
  excludeHostedSiteEvents: false,
  excludeRoutineQuietAnswers: false,
  excludeSettingLinks: false,
};

export interface WatchRelayTeamApi {
  port(): number | null;
  appVersion(): string;
  serverName(): string | null;
  serverAppearance(): ServerAppearance | null;
  agents: Pick<
    TeamApiAgents,
    | "listAgents"
    | "getRuntimeSnapshot"
    | "pendingPrompts"
    | "pendingApproval"
    | "listConversationReads"
    | "readConversationPageFor"
    | "resolveAvatar"
  >;
  layout(): SidebarLayoutSnapshot | null;
  listChannels(memberId: string): ChannelSummary[];
  pins(memberId: string, hidden: ReadonlySet<string>): readonly SidebarPin[];
  hiddenAgentIds(member: Pick<TeamMemberSummary, "id" | "role">): ReadonlySet<string>;
  channelHiddenAgentIds(member: Pick<TeamMemberSummary, "id" | "role">): ReadonlySet<string>;
  openSession(input: {
    sessionId: string;
    membershipId: string;
    userId: string;
    role: TeamMemberSummary["role"];
    expiresAt: number;
  }): { sessionToken: string };
  closeSession(sessionId: string): void;
}

export interface WatchRelayMember {
  id: string;
  userId: string;
  role: TeamMemberSummary["role"];
}

export interface WatchRelayContext {
  hostId: string;
  watchKey: string;
  language: string | undefined;
}

class WatchLoopbackError extends Schema.TaggedError<WatchLoopbackError>()("WatchLoopbackError", {
  cause: Schema.Defect(),
}) {}

type LoopbackBody =
  | { throughMessageId: string }
  | { requestId: string | number; decision: "accept" | "decline" }
  | { requestId: string | number; answers: Record<string, string[]> }
  | { text: string; attachmentDraftIds: string[]; replyToMessageId: null; clientMessageId: string }
  | { turnId: string }
  | { channelId: string }
  | ChannelCommand;

interface LoopbackReply {
  status: number;
  error: string | null;
  body: unknown;
}

export interface WatchCommandReply {
  result: WatchResult;
  snapshot: WatchSnapshot | null;
}

export function visibleWatchChannels(
  api: Pick<WatchRelayTeamApi, "listChannels" | "channelHiddenAgentIds">,
  member: Pick<WatchRelayMember, "id" | "role">,
): ChannelSummary[] {
  const hidden = canAdministerServer(member.role)
    ? new Set<string>()
    : api.channelHiddenAgentIds({ id: member.id, role: member.role });
  return api.listChannels(member.id).filter((channel) => !channel.archived && seesChannel(channel.members, hidden));
}

const failure = (error: WatchErrorCode, message: string): WatchCommandReply => ({
  result: { ok: false, error, message },
  snapshot: null,
});

export interface WatchRelayCommandsOptions {
  widgetPush?: Pick<WatchWidgetPushService, "register">;
  now?: () => number;
}

export class WatchRelayCommands {
  readonly #api: WatchRelayTeamApi;
  readonly #widgetPush: Pick<WatchWidgetPushService, "register"> | null;
  readonly #now: () => number;
  readonly #fullReplies = new Map<string, string>();

  constructor(api: WatchRelayTeamApi, options: WatchRelayCommandsOptions = {}) {
    this.#api = api;
    this.#widgetPush = options.widgetPush ?? null;
    this.#now = options.now ?? Date.now;
  }

  snapshot(member: WatchRelayMember, context: WatchRelayContext, text: WatchText): WatchSnapshot {
    const access = { id: member.id, role: member.role };
    const hidden = this.#api.hiddenAgentIds(access);
    const visible = (agentId: string) => !hidden.has(agentId);
    const { agents } = this.#api;
    const runtime = agents.getRuntimeSnapshot();
    return buildHostWatchSnapshot({
      hostId: context.hostId,
      serverName: this.#api.serverName() ?? context.hostId,
      appearance: this.#api.serverAppearance(),
      watchKey: context.watchKey,
      agents: agents.listAgents().filter((agent) => visible(agent.id)),
      runtime: {
        ...runtime,
        activeTurns: runtime.activeTurns.filter((item) => visible(item.agentId)),
        work: runtime.work.filter((item) => visible(item.agentId)),
        latestMessages: runtime.latestMessages
          .filter((item) => visible(item.agentId))
          .map((item) => ({ ...item, text: this.#fullReplies.get(item.id) ?? item.text })),
        pendingPrompts: runtime.pendingPrompts.filter((item) => visible(item.agentId)),
        pendingApprovals: runtime.pendingApprovals.filter((item) => visible(item.agentId)),
        pendingBrowserTakeovers: runtime.pendingBrowserTakeovers.filter((item) => visible(item.agentId)),
      },
      prompts: agents.pendingPrompts().filter((item) => visible(item.agentId)),
      wholeApproval: (requestId) => agents.pendingApproval(requestId),
      reads: Object.fromEntries(
        Object.entries(agents.listConversationReads(member.id, WATCH_READ_OPTIONS)).filter(([agentId]) =>
          visible(agentId),
        ),
      ),
      pins: this.#api.pins(member.id, hidden),
      layout: this.#api.layout(),
      channels: this.#visibleChannels(member),
      avatar: (agentId) => this.#avatarName(agentId),
      text,
      now: this.#now(),
    });
  }

  readonly run = Effect.fn("WatchRelayCommands.run")(function* (
    this: WatchRelayCommands,
    member: WatchRelayMember,
    command: WatchCommand,
    context: WatchRelayContext,
  ): Effect.fn.Return<WatchCommandReply> {
    const text = watchTextFor(context.language);
    const { t } = text;
    if (command.type === "widgetPush") {
      if (!this.#widgetPush) return failure("failed", "");
      this.#widgetPush.register(member, { token: command.token, environment: command.environment });
      return { result: { ok: true }, snapshot: null };
    }
    if (command.type !== "avatars") yield* this.#loadFullReplies(member);
    const done = (): WatchCommandReply => ({ result: { ok: true }, snapshot: this.snapshot(member, context, text) });
    if (command.type === "refresh") return done();
    if (command.type === "avatars")
      return { result: { ok: true, avatars: yield* this.#avatars(member, command.names) }, snapshot: null };
    if (command.type === "pair" || command.type === "open") return failure("failed", "");
    if (command.type === "sendChannel" || command.type === "readChannel") {
      const channelReply = yield* this.#channelCommand(member, command);
      if (channelReply === "inactive") return failure("inactive", t("mobile.watch.error.inactive"));
      if (channelReply.status >= 200 && channelReply.status < 300) return done();
      const message = channelReply.error
        ? localizeSourceText(channelReply.error, text.locale)
        : t("mobile.watch.error.failed");
      return failure("failed", message);
    }
    const { agentId } = command;
    const shown = this.snapshot(member, context, text);
    const agent = shown.state === "ready" ? shown.agents.find((item) => item.id === agentId) : undefined;
    if (!agent) return failure("inactive", t("mobile.watch.error.inactive"));
    const call = (path: string, body: LoopbackBody) => this.#call(member, path, body);
    let reply: LoopbackReply;
    switch (command.type) {
      case "read": {
        const boundary = yield* this.#readBoundary(member, agentId).pipe(Effect.result);
        if (Result.isFailure(boundary)) return failure("failed", t("mobile.watch.error.failed"));
        const throughMessageId = boundary.success;
        if (throughMessageId === null) return done();
        reply = yield* call(TEAM_API_ROUTES.agent.conversationRead(agentId), { throughMessageId });
        break;
      }
      case "approve":
      case "deny": {
        const approval = this.#api.agents
          .getRuntimeSnapshot()
          .pendingApprovals.find((item) => item.agentId === agentId && String(item.requestId) === command.requestId);
        if (!approval) return failure("inactive", t("mobile.watch.error.inactive"));
        if (
          command.type === "approve" &&
          (agent.wait?.kind !== "approval" || agent.wait.requestId !== command.requestId || !agent.wait.whole)
        )
          return failure("failed", t("mobile.watch.approval.tooLong"));
        reply = yield* call(TEAM_API_ROUTES.respond.approval, {
          requestId: approval.requestId,
          decision: command.type === "approve" ? "accept" : "decline",
        });
        break;
      }
      case "answer": {
        const prompt = this.#api.agents
          .pendingPrompts()
          .find((item) => item.agentId === agentId && String(item.requestId) === command.requestId);
        if (!prompt) return failure("inactive", t("mobile.watch.error.inactive"));
        const answerable = new Set(
          prompt.questions.filter((question) => !question.isSecret).map((question) => question.id),
        );
        if (
          agent.wait?.kind !== "question" ||
          agent.wait.requestId !== command.requestId ||
          !Object.keys(command.answers).every((questionId) => answerable.has(questionId))
        )
          return failure("failed", t("mobile.watch.error.failed"));
        reply = yield* call(TEAM_API_ROUTES.respond.prompt, { requestId: prompt.requestId, answers: command.answers });
        break;
      }
      case "send":
        reply = yield* call(TEAM_API_ROUTES.agent.messages(agentId), {
          text: command.text,
          attachmentDraftIds: [],
          replyToMessageId: null,
          clientMessageId: command.messageId ?? randomUUID(),
        });
        break;
      case "stop":
        reply = yield* call(TEAM_API_ROUTES.agent.interrupt(agentId), { turnId: command.turnId });
        break;
    }
    if (reply.status >= 200 && reply.status < 300) return done();
    if (reply.status === 409) return failure("inactive", t("mobile.watch.error.inactive"));
    const message = reply.error ? localizeSourceText(reply.error, text.locale) : t("mobile.watch.error.failed");
    return failure("failed", message);
  });

  readonly #loadFullReplies = Effect.fn("WatchRelayCommands.loadFullReplies")(function* (
    this: WatchRelayCommands,
    member: WatchRelayMember,
  ) {
    const hidden = this.#api.hiddenAgentIds({ id: member.id, role: member.role });
    const runtime = this.#api.agents.getRuntimeSnapshot();
    const streaming = new Set(runtime.activeTurns.map((turn) => turn.agentId));
    const clipped = runtime.latestMessages.filter(
      (item) =>
        !hidden.has(item.agentId) &&
        !streaming.has(item.agentId) &&
        item.text.length >= AGENT_RUNTIME_TEXT_LIMIT &&
        !this.#fullReplies.has(item.id),
    );
    for (const item of clipped) {
      const page = yield* this.#api.agents
        .readConversationPageFor(item.agentId, member.id, undefined, FULL_REPLY_PAGE_LIMIT)
        .pipe(Effect.option);
      if (Option.isNone(page)) continue;
      const message = page.value.messages.find((candidate) => candidate.id === item.id);
      if (!message) continue;
      this.#fullReplies.set(item.id, message.text);
      for (const key of this.#fullReplies.keys()) {
        if (this.#fullReplies.size <= FULL_REPLY_CACHE_LIMIT) break;
        this.#fullReplies.delete(key);
      }
    }
  });

  readonly #channelCommand = Effect.fn("WatchRelayCommands.channelCommand")(function* (
    this: WatchRelayCommands,
    member: WatchRelayMember,
    command: Extract<WatchCommand, { type: "sendChannel" | "readChannel" }>,
  ) {
    const { channelId } = command;
    if (!this.#visibleChannels(member).some((channel) => channel.id === channelId)) return "inactive" as const;
    if (command.type === "sendChannel") {
      return yield* this.#call(member, CHANNEL_ROUTES.command, {
        type: "send",
        operationId: command.messageId ?? randomUUID(),
        channelId,
        text: command.text,
        recipientAgentId: null,
        replyToMessageId: null,
        attachmentDraftIds: [],
      });
    }
    const page = yield* this.#call(member, CHANNEL_ROUTES.read, { channelId });
    const throughSequence = isDynamicRecord(page.body) ? page.body.throughSequence : undefined;
    if (page.status !== 200 || !isNumber(throughSequence)) return page;
    return yield* this.#call(member, CHANNEL_ROUTES.command, {
      type: "read",
      operationId: randomUUID(),
      channelId,
      throughSequence,
    });
  });

  #visibleChannels(member: WatchRelayMember): ChannelSummary[] {
    return visibleWatchChannels(this.#api, member);
  }

  readonly #readBoundary = Effect.fn("WatchRelayCommands.readBoundary")(function* (
    this: WatchRelayCommands,
    member: WatchRelayMember,
    agentId: string,
  ) {
    const page = yield* this.#api.agents.readConversationPageFor(agentId, member.id, undefined, READ_PAGE_LIMIT);
    const messages = page.messages;
    const boundary =
      messages.findLast((message) => message.author !== "user" && itemTypeCountsAsUnread(message.itemType)) ??
      messages.at(-1);
    return boundary?.id ?? null;
  });

  #avatarName(agentId: string): string | null {
    const avatar = this.#api.agents.resolveAvatar(agentId);
    return avatar ? watchAvatarName(agentId, avatar) : null;
  }

  readonly #avatars = Effect.fn("WatchRelayCommands.avatars")(function* (
    this: WatchRelayCommands,
    member: WatchRelayMember,
    names: readonly string[],
  ) {
    const hidden = this.#api.hiddenAgentIds({ id: member.id, role: member.role });
    const files = new Map<string, string>();
    for (const agent of this.#api.agents.listAgents()) {
      if (hidden.has(agent.id)) continue;
      const avatar = this.#api.agents.resolveAvatar(agent.id);
      const name = avatar ? watchAvatarName(agent.id, avatar) : null;
      if (avatar && name) files.set(name, avatar.path);
    }
    const avatars: Record<string, string> = {};
    let size = 0;
    for (const name of names) {
      const path = files.get(name);
      if (!path) continue;
      const data = yield* Effect.tryPromise(() => readFile(path)).pipe(
        Effect.map((bytes) => bytes.toString("base64")),
        Effect.catch(() => Effect.succeed(null)),
      );
      if (data === null || size + data.length > AVATAR_REPLY_LIMIT) continue;
      avatars[name] = data;
      size += data.length;
    }
    return avatars;
  });

  readonly #call = Effect.fn("WatchRelayCommands.call")(function* (
    this: WatchRelayCommands,
    member: WatchRelayMember,
    path: string,
    body: LoopbackBody,
  ): Effect.fn.Return<LoopbackReply> {
    const port = this.#api.port();
    if (port === null) return { status: 503, error: null, body: null };
    const sessionId = `watch-${randomUUID()}`;
    return yield* Effect.acquireUseRelease(
      Effect.sync(() =>
        this.#api.openSession({
          sessionId,
          membershipId: member.id,
          userId: member.userId,
          role: member.role,
          expiresAt: this.#now() + SESSION_LIFETIME_MS,
        }),
      ),
      ({ sessionToken }) =>
        Effect.tryPromise({
          try: async (signal) => {
            const forwarded = encodeTeamCapabilitiesV10([...TEAM_CURRENT_CAPABILITIES]);
            const response = await fetch(`http://127.0.0.1:${port}${path}`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${sessionToken}`,
                "Content-Type": "application/json",
                [TEAM_PROTOCOL_VERSION_HEADER]: String(TEAM_PROTOCOL_V10),
                [TEAM_APP_VERSION_HEADER]: this.#api.appVersion(),
                [TEAM_CAPABILITIES_HEADER]: forwarded.capabilities.join(","),
                ...(forwarded.absent.length ? { [TEAM_ABSENT_CAPABILITIES_HEADER]: forwarded.absent.join(",") } : {}),
              },
              body: JSON.stringify(body),
              redirect: "error",
              signal: AbortSignal.any([signal, AbortSignal.timeout(CALL_TIMEOUT_MS)]),
            });
            const text = await response.text();
            const parsed = text ? JSON.parse(text) : null;
            return {
              status: response.status,
              error: isDynamicRecord(parsed) && isString(parsed.error) ? parsed.error : null,
              body: parsed,
            };
          },
          catch: (cause) => new WatchLoopbackError({ cause }),
        }).pipe(Effect.catch(() => Effect.succeed<LoopbackReply>({ status: 503, error: null, body: null }))),
      () => Effect.sync(() => this.#api.closeSession(sessionId)),
    );
  });
}
