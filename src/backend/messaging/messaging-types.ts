import { AGENT_PROVIDERS, agentProviderName } from "@openbot/contracts/agent-providers";
import type { MessagingConnectionState, MessagingPlatform } from "@openbot/contracts/ipc";
import type { DiscordApiRequest, DiscordDelivery, DiscordEmbed } from "@openbot/contracts/signal-protocol/discord-api";
import type {
  TelegramCallMethod,
  TelegramCallParams,
  TelegramCallResult,
} from "@openbot/contracts/signal-protocol/telegram-route";
import { isFixedSourceText, matchingSourceKeys, sourceText } from "@openbot/i18n/source";
import { type Effect, Schema } from "effect";
import type { MessagingOperationFailed } from "./messaging-service";
import type { MessagingAnswerFile } from "./messaging-threads";

export interface MessageTarget {
  platformChannelId: string;
  replyThreadId: string | null;
}

export interface MessagingPlace {
  id: string;
  name: string;
  kind: "channel" | "private" | "thread" | "chat";
  readOnly?: true;
}

export interface MessagingPlaces {
  places: MessagingPlace[];
  note?: string;
}

export interface InboundFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
  path?: string;
}

export const CANCEL_TEXT = /^(cancel|stop)$/i;

export function chatFailureReason(error: string | null | undefined): string | null {
  if (!error) return null;
  if (isFixedSourceText(error)) return matchingSourceKeys(error).some((key) => key.startsWith("error.")) ? error : null;
  const signInExpired = AGENT_PROVIDERS.some(
    (provider) => error === sourceText("error.provider.signInExpired", { provider: agentProviderName(provider) }),
  );
  return signInExpired ? error : null;
}

export interface InboundMessage {
  dedupKey: string;
  platformChannelId: string;
  threadKey: string;
  target: MessageTarget;
  platformMessageId: string;
  isDirect: boolean;
  requiresLink: boolean;
  authorId: string;
  text: string;
  mentionedUserIds: string[];
  files: InboundFile[];
  authorRoleIds?: readonly string[] | null;
  replyTo?: InboundQuote | null;
}

interface InboundQuote {
  authorName: string;
  text: string;
  mentionedUserIds: string[];
  sentAt: string;
  messageId?: string;
  files?: InboundFile[];
}

interface InboundActionBase {
  token: string;
  actorId: string;
  target: MessageTarget;
  platformMessageId: string;
  replyHandle?: string;
}

export type InboundAction =
  | (InboundActionBase & { type: "approval"; decision: "accept" | "decline" })
  | (InboundActionBase & { type: "stop" });

interface MessageButton {
  action: "accept" | "decline" | "stop";
  label: string;
  token: string;
  style?: "primary" | "danger";
}

export interface MessageBody {
  text: string;
  buttons?: MessageButton[];
  embeds?: DiscordEmbed[];
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
  files?: InboundFile[];
}

export interface HistoryFilter {
  query?: string;
  before?: string;
}

export interface RecentMessages {
  messages: ContextEntry[];
  note?: string;
}

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
  readonly searchesHistory?: boolean;
  identify(): Effect.Effect<ConnectionIdentity, MessagingAdapterError>;
  post(target: MessageTarget, body: MessageBody): Effect.Effect<string, MessagingAdapterError>;
  edit(target: MessageTarget, messageId: string, body: MessageBody): Effect.Effect<string, MessagingAdapterError>;
  remove?(target: MessageTarget, messageId: string): Effect.Effect<void, MessagingAdapterError>;
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
  addEmoji?(target: MessageTarget, messageId: string, emoji: string): Effect.Effect<void, MessagingAdapterError>;
  postAnswer(
    target: MessageTarget,
    markdown: string,
    replaceMessageId: string | null,
  ): Effect.Effect<string, MessagingAdapterError>;
  postEmbeds?(
    target: MessageTarget,
    markdown: string,
    embeds: DiscordEmbed[],
  ): Effect.Effect<string, MessagingAdapterError>;
  rememberPost?(target: MessageTarget, postId: string, text: string): void;
  upload(
    target: MessageTarget,
    files: MessagingAnswerFile[],
  ): Effect.Effect<{ skipped: string[]; firstId: string | null }, MessagingAdapterError>;
  postFileWithText?(
    target: MessageTarget,
    markdown: string,
    file: MessagingAnswerFile,
  ): Effect.Effect<string | null, MessagingAdapterError>;
  history(
    platformChannelId: string,
    threadKey: string,
    afterId: string | null,
    beforeId: string,
  ): Effect.Effect<ContextEntry[], MessagingAdapterError>;
  recent(
    platformChannelId: string,
    threadKey: string | null,
    limit: number,
    filter?: HistoryFilter,
  ): Effect.Effect<RecentMessages, MessagingAdapterError>;
  download(file: InboundFile, destination: string, maxBytes: number): Effect.Effect<void, MessagingAdapterError>;
  authorName(userId: string): Effect.Effect<string, MessagingAdapterError>;
  placeName(platformChannelId: string): Effect.Effect<string, MessagingAdapterError>;
  places(): Effect.Effect<MessagingPlaces, MessagingAdapterError>;
  placeId?(placeId: string): string;
  directChat?(target: MessageTarget): { userId: string; threadKey: string } | null;
  roles?(): Effect.Effect<Array<{ id: string; name: string }>, MessagingAdapterError>;
  mention(userId: string): string;
  joinPublicPlaces?(): Effect.Effect<void, MessagingAdapterError>;
  joinPlace?(platformChannelId: string): Effect.Effect<void, MessagingAdapterError>;
}

export interface TransportSink {
  state(state: MessagingConnectionState, detail?: { retryAt?: string; migratedTo?: string }): void;
  message(message: InboundMessage): void;
  action(action: InboundAction): void;
  placeCreated?(platformChannelId: string): void;
  renamed?(workspaceName: string): void;
}

export interface MessagingTransport {
  start(sink: TransportSink): void;
  reconnect(): void;
  stop(): Effect.Effect<void>;
  deliver?(delivery: IngressDelivery): Effect.Effect<IngressAnswer>;
}

export type IngressDelivery = (
  | { platform: "slack"; kind: "events" | "interactivity"; retryNum: number | null; body: Uint8Array }
  | { platform: "discord"; delivery: DiscordDelivery }
  | { platform: "telegram"; botId: string; body: Uint8Array; linked: boolean }
) & {
  queued?: boolean;
};

export interface IngressAnswer {
  status: 200 | 400 | 401 | 404 | 503;
  contentType?: "application/json" | "text/plain";
  body?: string;
}

export type IngressState = "online" | "connecting" | "signed_out" | "no_host" | "unavailable";

export type IngressFailure = "refused" | "certificate";

export type IngressHandler = (
  workspaceId: string,
  delivery: IngressDelivery,
) => Effect.Effect<IngressAnswer, MessagingOperationFailed>;

export interface TelegramGateway {
  available(): boolean;
  call<M extends TelegramCallMethod>(
    botId: string,
    method: M,
    params: TelegramCallParams[M],
  ): Effect.Effect<TelegramCallResult, MessagingAdapterError>;
  download(fileToken: string, destination: string, maxBytes: number): Effect.Effect<void, MessagingAdapterError>;
  upload(uploadToken: string, path: string): Effect.Effect<number, MessagingAdapterError>;
}

export class TelegramCallError extends Error {
  readonly code: string;
  constructor(
    readonly errorCode: number,
    description: string,
    readonly retryAfter: number | null,
  ) {
    super(description);
    this.name = "TelegramCallError";
    this.code = `telegram_${errorCode}`;
  }
}

export class WhatsAppRefusedError extends Error {
  readonly code: string;
  constructor(errorCode: string) {
    super(`WhatsApp refused the message: ${errorCode}`);
    this.name = "WhatsAppRefusedError";
    this.code = `whatsapp_${errorCode}`;
  }
}

export class WhatsAppAnswerPartlySent extends Error {
  constructor(cause: unknown) {
    super("A part of the WhatsApp answer was sent.", { cause });
    this.name = "WhatsAppAnswerPartlySent";
  }
}

export interface MessagingIngress {
  acquire(platform: MessagingPlatform): () => void;
  state(): IngressState;
  failure?(): IngressFailure | null;
  onState(listener: (state: IngressState) => void): () => void;
  handle(handler: IngressHandler | null): void;
  readonly telegram: TelegramGateway;
  reconnect(): void;
  discord<A>(
    request: DiscordApiRequest,
    decode: (value: unknown) => A,
    file?: DiscordUploadFile,
  ): Effect.Effect<A, MessagingAdapterError>;
  onDiscordRoutes(listener: (guildIds: ReadonlySet<string>) => void): () => void;
  onLinkedRoutes(platform: LinkedRoutePlatform, listener: (ids: ReadonlySet<string> | null) => void): () => void;
}

export type LinkedRoutePlatform = "slack" | "telegram";

export interface DiscordUploadFile {
  bytes: Uint8Array;
  mimeType: string;
}

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
  connectionId: string;
  rateLimited(retryAt: string): void;
}

export interface MessagingDriver {
  readonly platform: MessagingPlatform;
  readonly requiredCredential: string;
  createAdapter(credentials: Record<string, string>, options: MessagingDriverOptions): MessagingAdapter;
  createTransport(credentials: Record<string, string>, identity: ConnectionIdentity): MessagingTransport;
}
