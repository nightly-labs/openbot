// The seam between the platform-agnostic messaging core and one chat platform. A platform is one
// `MessagingDriver`: an adapter for its API and a transport for its inbound events. The OpenBot
// Slack app uses the Events API: Slack posts to Signal, Signal checks Slack's signature, and passes
// each request of a workspace linked to this host over the `MessagingIngress` socket, which the host
// opens. The OpenBot Discord app's Gateway connection is in Signal, which holds the bot token: Signal
// passes each guild's events over the same socket and makes the host's Discord calls. A Telegram
// driver would use long polling (`getUpdates`). No transport needs a public endpoint on the host.

import type { MessagingConnectionState, MessagingPlatform } from "@openbot/contracts/ipc";
import type { DiscordApiRequest, DiscordDelivery } from "@openbot/contracts/signal-protocol/discord-api";
import { type Effect, Schema } from "effect";
import type { MessagingOperationFailed } from "./messaging-service";
import type { MessagingAnswerFile } from "./messaging-threads";

/** Where a post goes: a platform channel, and the thread in it or the top level. */
export interface MessageTarget {
  platformChannelId: string;
  replyThreadId: string | null;
}

export interface InboundFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
}

/** One message that addresses OpenBot, in the same shape for every platform. */
export interface InboundMessage {
  /** Stable for one message across redeliveries. */
  dedupKey: string;
  platformChannelId: string;
  /** Names the conversation: one link, and so one execution thread, per key and channel. */
  threadKey: string;
  target: MessageTarget;
  platformMessageId: string;
  isDirect: boolean;
  /** True for a reply that does not name OpenBot: it counts only in a conversation that already has an agent. */
  requiresLink: boolean;
  authorId: string;
  text: string;
  files: InboundFile[];
}

interface InboundActionBase {
  token: string;
  actorId: string;
  target: MessageTarget;
  platformMessageId: string;
  /** What the platform needs to answer the press privately, such as a Discord interaction id. */
  replyHandle?: string;
}

export type InboundAction =
  | (InboundActionBase & { type: "approval"; decision: "accept" | "decline" })
  | (InboundActionBase & { type: "stop" });

interface MessageButton {
  action: "accept" | "decline" | "stop";
  label: string;
  /** Opaque and single use. It maps to the request only in the host's memory. */
  token: string;
  style?: "primary" | "danger";
}

export interface MessageBody {
  text: string;
  buttons?: MessageButton[];
}

export type StatusReaction = "received" | "done" | "failed" | "stopped";

export interface ConnectionIdentity {
  workspaceId: string;
  workspaceName: string;
  botUserId: string;
  appId: string;
  missingScopes: string[];
}

export interface ContextEntry {
  id: string;
  authorName: string;
  text: string;
  sentAt: string;
}

/** A failure the connection cannot recover from alone. The user must act. */
export class MessagingConnectionError extends Error {
  constructor(readonly state: Extract<MessagingConnectionState, "invalid_token">) {
    super(state);
  }
}

export class MessagingAdapterError extends Schema.TaggedError<MessagingAdapterError>()("MessagingAdapterError", {
  cause: Schema.Defect(),
}) {}

export interface MessagingAdapter {
  readonly platform: MessagingPlatform;
  identify(): Effect.Effect<ConnectionIdentity, MessagingAdapterError>;
  post(target: MessageTarget, body: MessageBody): Effect.Effect<string, MessagingAdapterError>;
  edit(target: MessageTarget, messageId: string, body: MessageBody): Effect.Effect<void, MessagingAdapterError>;
  /** A post that only `userId` sees. `replyHandle` is the one of the press that it answers, if any. */
  postPrivate(
    target: MessageTarget,
    userId: string,
    text: string,
    replyHandle?: string,
  ): Effect.Effect<void, MessagingAdapterError>;
  react(
    target: MessageTarget,
    messageId: string,
    reaction: StatusReaction,
    on: boolean,
  ): Effect.Effect<void, MessagingAdapterError>;
  /**
   * Posts the agent's answer, in as many posts as the platform needs. The first part replaces
   * `replaceMessageId` when it is given.
   */
  postAnswer(
    target: MessageTarget,
    markdown: string,
    replaceMessageId: string | null,
  ): Effect.Effect<void, MessagingAdapterError>;
  /** Uploads files to the conversation, and returns the names it did not send. */
  upload(target: MessageTarget, files: MessagingAnswerFile[]): Effect.Effect<string[], MessagingAdapterError>;
  /** Earlier messages of the conversation, oldest first, after `afterId` and before `beforeId`. */
  history(
    platformChannelId: string,
    threadKey: string,
    afterId: string | null,
    beforeId: string,
  ): Effect.Effect<ContextEntry[], MessagingAdapterError>;
  /** Downloads one file to `destination`. Refuses a file larger than `maxBytes`. */
  download(file: InboundFile, destination: string, maxBytes: number): Effect.Effect<void, MessagingAdapterError>;
  authorName(userId: string): Effect.Effect<string, MessagingAdapterError>;
  placeName(platformChannelId: string): Effect.Effect<string, MessagingAdapterError>;
  mention(userId: string): string;
  /** Joins every public place the platform lets OpenBot join without an invitation. */
  joinPublicPlaces?(): Effect.Effect<void, MessagingAdapterError>;
  /** Joins one public place, such as a channel that was just created. */
  joinPlace?(platformChannelId: string): Effect.Effect<void, MessagingAdapterError>;
}

export interface TransportSink {
  state(state: MessagingConnectionState, detail?: { retryAt?: string }): void;
  message(message: InboundMessage): void;
  action(action: InboundAction): void;
  /** A public place was created that OpenBot can join. */
  placeCreated?(platformChannelId: string): void;
}

export interface MessagingTransport {
  start(sink: TransportSink): void;
  /** Reconnects now, such as after the computer wakes. */
  reconnect(): void;
  stop(): Effect.Effect<void>;
  /** Handles one request that the ingress relay brought, for a transport that gets its events that way. */
  deliver?(delivery: IngressDelivery): Effect.Effect<IngressAnswer>;
}

/**
 * One event that Signal passed on. For Slack, the HTTP request that Slack sent to its request URL,
 * whose signature Signal has checked. For Discord, a Gateway event that Signal normalized; it has no
 * answer.
 */
export type IngressDelivery =
  | { platform: "slack"; kind: "events" | "interactivity"; retryNum: number | null; body: Uint8Array }
  | { platform: "discord"; delivery: DiscordDelivery };

/** The HTTP answer the platform gets. A body only for a URL check or a button reply. */
export interface IngressAnswer {
  status: 200 | 400 | 401 | 404 | 503;
  contentType?: "application/json" | "text/plain";
  body?: string;
}

/** `unavailable` has a reason the user can act on: sign in, name this computer, or wait for Signal. */
export type IngressState = "online" | "connecting" | "signed_out" | "no_host" | "unavailable";

/** Handles one request for a workspace, by the platform's workspace id (a Slack team or Discord guild). */
export type IngressHandler = (
  workspaceId: string,
  delivery: IngressDelivery,
) => Effect.Effect<IngressAnswer, MessagingOperationFailed>;

/**
 * The relay that brings a platform's HTTP requests to this host: Signal's `ingress` socket, which
 * the main process owns. It is open while anything holds it.
 */
export interface MessagingIngress {
  /**
   * Keeps the relay open until the returned function runs. The relay asks Signal for the routes of
   * the platforms that hold it.
   */
  acquire(platform: MessagingPlatform): () => void;
  state(): IngressState;
  onState(listener: (state: IngressState) => void): () => void;
  /** Sets the one handler of the requests the relay receives, or removes it. */
  handle(handler: IngressHandler | null): void;
  /**
   * Opens the socket again, such as after the computer wakes, or after a workspace was connected or
   * disconnected: Signal learns the workspaces of this host when the socket connects.
   */
  reconnect(): void;
  /**
   * Makes one Discord call through Signal, which holds the bot token, with the session of the open
   * socket. Waits a short time for the session when the socket is still connecting. `decode` checks
   * the JSON body of the answer.
   */
  discord<A>(
    request: DiscordApiRequest,
    decode: (value: unknown) => A,
    file?: DiscordUploadFile,
  ): Effect.Effect<A, MessagingAdapterError>;
}

/** The bytes of one `upload` call. */
export interface DiscordUploadFile {
  bytes: Uint8Array;
  mimeType: string;
}

/** A Discord call that Signal or Discord refused, with Signal's code. */
export class DiscordApiError extends Error {
  constructor(
    readonly op: string,
    readonly code: string,
    readonly retryAfterMs?: number,
  ) {
    super(`Discord ${op} failed: ${code}`);
  }
}

export interface MessagingDriverOptions {
  /** Called when the platform asks the host to wait, with the time it can try again. */
  rateLimited(retryAt: string): void;
}

export interface MessagingDriver {
  readonly platform: MessagingPlatform;
  /** The stored value without which a connection cannot start, such as Slack's bot token. */
  readonly requiredCredential: string;
  createAdapter(credentials: Record<string, string>, options: MessagingDriverOptions): MessagingAdapter;
  createTransport(credentials: Record<string, string>, identity: ConnectionIdentity): MessagingTransport;
}
