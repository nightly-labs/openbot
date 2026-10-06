import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { isCanonicalInviteUrl } from "@openbot/contracts/invite-links";
import { isValidHostname as isSharedValidHostname } from "@openbot/contracts/validation";
import { Effect, Fiber, Option, Result, Schema } from "effect";
import { type RenderedEmail, renderSignInCodeEmail, renderTeamInviteEmail } from "./email-templates";

export interface SmtpEmailConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  from: string;
}

export interface SmtpEmailMessage {
  email: string;
  code: string;
  expiresAt: number;
}

export interface SmtpTeamInviteMessage {
  email: string;
  inviterEmail: string;
  serverName: string;
  inviteUrl: string;
  role: "admin" | "member";
}

interface PreparedEmailMessage {
  email: string;
  content: RenderedEmail;
}

interface SmtpAttemptState {
  submissionStarted: boolean;
  accepted: boolean;
}

interface SmtpSocket {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  opened: Promise<unknown>;
  close(): void | Promise<void>;
}

// Carries the reply that refused a stage. `message` keeps the same `smtp_<stage>_failed` shape the
// service logs and tests read, so only the added fields are new.
class SmtpReplyError extends Schema.TaggedError<SmtpReplyError>()("SmtpReplyError", {
  stage: Schema.String,
  replyCode: Schema.Number,
  replyText: Schema.String,
  message: Schema.String,
}) {
  constructor(stage: string, replyCode: number, replyText: string) {
    super({ stage, replyCode, replyText, message: `smtp_${stage}_failed` });
  }
}
class SmtpError extends Schema.TaggedError<SmtpError>()("SmtpError", { message: Schema.String }) {
  constructor(message: string) {
    super({ message });
  }
}
export type SmtpFailure = SmtpError | SmtpReplyError;
function smtpCall<A>(operation: () => Promise<A>): Effect.Effect<A, SmtpFailure> {
  return Effect.tryPromise({ try: operation, catch: normalizeSmtpError });
}
function smtpValidate<A>(operation: () => A): Effect.Effect<A, SmtpFailure> {
  return Effect.try({ try: operation, catch: normalizeSmtpError });
}

export type SmtpConnector = (
  address: { hostname: string; port: number },
  options: { secureTransport: "on"; allowHalfOpen: false },
) => SmtpSocket;

export const EMAIL_CODE_DELIVERY_BUDGET_MS = 25_000;
// `auth-service` answers 429 for this message instead of a permanent 502. Every delivery method
// raises it, so the service stays free of provider detail.
export const RATE_LIMITED_DELIVERY_ERROR = "email_delivery_rate_limited";
// A sender-limit refusal that arrives with a permanent 5xx reply. Namecheap Private Email answers
// `554 5.7.1 <DATA>: Data command rejected: Reject: too many messages from sender in last 60
// minutes` when the hourly quota of the sending mailbox is spent, which is a temporary condition
// reported with a permanent code. Recipient-side limits such as `552 Mailbox quota exceeded` must
// not match: the sender can do nothing about those, and a countdown would be a lie.
const SENDER_LIMIT_REPLY = /too many (?:messages|emails|recipients)|(?:sending|send|message|rate) limit|rate limited/iu;
const SMTP_TIMEOUT_MS = 7_500;
const SMTP_CLOSE_TIMEOUT_MS = 250;
const SMTP_MAX_ATTEMPTS = 3;
const EMAIL_PATTERN = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+$/iu;

export const sendPrivateEmailCode = Effect.fn("Smtp.sendPrivateEmailCode ")(function* (
  config: SmtpEmailConfig,
  message: SmtpEmailMessage,
  connector?: SmtpConnector,
) {
  yield* smtpValidate(() => {
    validateConfig(config);
    validateEmail(message.email, "recipient");
    if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/u.test(message.code)) {
      throw new Error("smtp_invalid_code");
    }
  });
  return yield* sendPrivateEmail(
    config,
    {
      email: message.email,
      content: renderSignInCodeEmail({
        code: message.code,
        expiresInMinutes: Math.max(1, Math.ceil((message.expiresAt - Date.now()) / 60_000)),
      }),
    },
    connector,
  );
});

export const sendPrivateTeamInvite = Effect.fn("Smtp.sendPrivateTeamInvite ")(function* (
  config: SmtpEmailConfig,
  message: SmtpTeamInviteMessage,
  connector?: SmtpConnector,
) {
  yield* smtpValidate(() => {
    validateEmail(message.email, "recipient");
    validateEmail(message.inviterEmail, "inviter");
    if (
      !message.serverName.trim() ||
      message.serverName.length > INPUT_LIMITS.serverName ||
      hasHeaderBreak(message.serverName)
    ) {
      throw new Error("smtp_invalid_server_name");
    }
    if (!isCanonicalInviteUrl(message.inviteUrl)) {
      throw new Error("smtp_invalid_invite_url");
    }
  });
  return yield* sendPrivateEmail(
    config,
    {
      email: message.email,
      content: renderTeamInviteEmail({
        inviterEmail: message.inviterEmail,
        serverName: message.serverName,
        inviteUrl: message.inviteUrl,
        role: message.role,
      }),
    },
    connector,
  );
});

const sendPrivateEmail = Effect.fn("SmtpEmail.send")(function* (
  config: SmtpEmailConfig,
  message: PreparedEmailMessage,
  connector?: SmtpConnector,
): Effect.fn.Return<void, SmtpFailure> {
  yield* smtpValidate(() => validateConfig(config));
  yield* smtpValidate(() => validateEmail(message.email, "recipient"));
  const { subject } = message.content;
  if (!subject || subject.length > 160 || hasHeaderBreak(subject)) return yield* new SmtpError("smtp_invalid_subject");
  const connect = connector ?? (yield* smtpCall(loadCloudflareConnector));
  for (let attempt = 1; attempt <= SMTP_MAX_ATTEMPTS; attempt += 1) {
    const result = yield* Effect.result(sendPrivateEmailAttempt(config, message, connect));
    if (Result.isSuccess(result)) return;
    const smtpError = result.failure;
    if (smtpError instanceof SmtpReplyError && isSenderRateLimited(smtpError)) {
      console.warn("Email delivery refused by a sender limit:", {
        stage: smtpError.stage,
        replyCode: smtpError.replyCode,
      });
      return yield* new SmtpError(RATE_LIMITED_DELIVERY_ERROR);
    }
    if (!isRetryableSmtpError(smtpError) || attempt === SMTP_MAX_ATTEMPTS) return yield* smtpError;
    yield* Effect.sleep(attempt * 250);
  }
});

const sendPrivateEmailAttempt = Effect.fn("SmtpEmail.attempt")(function* (
  config: SmtpEmailConfig,
  message: PreparedEmailMessage,
  connect: SmtpConnector,
): Effect.fn.Return<void, SmtpFailure> {
  const state: SmtpAttemptState = { submissionStarted: false, accepted: false };
  const outcome: { error: SmtpFailure | null; closeConfirmed: boolean } = { error: null, closeConfirmed: false };
  yield* Effect.acquireUseRelease(
    Effect.gen(function* () {
      const socket = yield* smtpValidate(() =>
        connect({ hostname: config.host, port: config.port }, { secureTransport: "on", allowHalfOpen: false }),
      );
      const session = yield* Effect.forkChild(Effect.result(runSmtpSession(socket, config, message, state)), {
        uninterruptible: false,
        startImmediately: true,
      });
      return { socket, session };
    }),
    ({ session }) =>
      Effect.gen(function* () {
        // Observe the deadline without stopping the session before socket closure confirms its final state.
        const result = yield* Fiber.join(session).pipe(
          Effect.timeoutOrElse({
            duration: SMTP_TIMEOUT_MS,
            orElse: () => Effect.succeed(Result.fail(new SmtpError("smtp_timeout"))),
          }),
        );
        if (Result.isFailure(result) && !state.accepted) {
          outcome.error =
            state.submissionStarted && result.failure.message !== "smtp_message_failed"
              ? new SmtpError("smtp_delivery_unknown")
              : result.failure;
        }
      }),
    ({ socket, session }) =>
      Effect.gen(function* () {
        outcome.closeConfirmed = yield* closeSmtpSocket(socket);
        yield* Fiber.interrupt(session);
      }),
  );
  if (state.accepted) return;
  if (outcome.error && !isRetryableSmtpError(outcome.error)) return yield* outcome.error;
  if (state.submissionStarted || !outcome.closeConfirmed) return yield* new SmtpError("smtp_delivery_unknown");
  if (outcome.error) return yield* outcome.error;
  return yield* new SmtpError("smtp_delivery_unknown");
});

/** True when the socket confirms its close before the deadline. */
function closeSmtpSocket(socket: SmtpSocket): Effect.Effect<boolean> {
  return Effect.tryPromise(async () => socket.close()).pipe(
    Effect.timeoutOption(SMTP_CLOSE_TIMEOUT_MS),
    Effect.map(Option.isSome),
    Effect.orElseSucceed(() => false),
  );
}

function normalizeSmtpError(error: unknown): SmtpFailure {
  if (error instanceof SmtpReplyError || error instanceof SmtpError) return error;
  if (error instanceof Error && /^smtp_[a-z_]+$/u.test(error.message)) return new SmtpError(error.message);
  return wrapTransportError();
}

function wrapTransportError(): SmtpError {
  return new SmtpError("smtp_transport_failed");
}

// A 4xx reply is temporary by definition, so waiting is the right answer whichever stage refused.
// A 5xx reply counts only when it names a sender-side message limit.
function isSenderRateLimited(error: SmtpReplyError): boolean {
  if (error.replyCode >= 400 && error.replyCode < 500) return true;
  return SENDER_LIMIT_REPLY.test(error.replyText);
}

function isRetryableSmtpError(error: Error): boolean {
  return ["smtp_transport_failed", "smtp_timeout", "smtp_connection_closed"].includes(error.message);
}

const runSmtpSession = Effect.fn("SmtpEmail.session")(function* (
  socket: SmtpSocket,
  config: SmtpEmailConfig,
  message: PreparedEmailMessage,
  state: SmtpAttemptState,
): Effect.fn.Return<void, SmtpFailure> {
  yield* smtpCall(() => socket.opened);
  const reader = new SmtpResponseReader(socket.readable.getReader());
  const writer = socket.writable.getWriter();

  yield* reader.expect([220], "greeting");
  yield* writeCommand(writer, "EHLO openbot.run");
  yield* reader.expect([250], "ehlo");
  yield* writeCommand(writer, "AUTH LOGIN");
  yield* reader.expect([334], "auth_username");
  yield* writeCommand(writer, encodeBase64(config.username));
  yield* reader.expect([334], "auth_password");
  yield* writeCommand(writer, encodeBase64(config.password));
  yield* reader.expect([235], "auth");
  yield* writeCommand(writer, `MAIL FROM:<${config.from}>`);
  yield* reader.expect([250], "mail_from");
  yield* writeCommand(writer, `RCPT TO:<${message.email}>`);
  yield* reader.expect([250, 251], "recipient");
  yield* writeCommand(writer, "DATA");
  yield* reader.expect([354], "data");
  state.submissionStarted = true;
  yield* writeCommand(writer, `${createMimeMessage(config.from, message)}\r\n.`);
  yield* reader.expect([250], "message");
  state.accepted = true;
  yield* writeCommand(writer, "QUIT");
  yield* reader.expect([221], "quit");
});

class SmtpResponseReader {
  readonly #decoder = new TextDecoder();
  #buffer = "";

  constructor(private readonly reader: ReadableStreamDefaultReader<Uint8Array>) {}

  readonly expect = Effect.fn("SmtpResponseReader.expect")(function* (
    this: SmtpResponseReader,
    expectedCodes: number[],
    stage: string,
  ): Effect.fn.Return<void, SmtpFailure> {
    let responseCode: number | null = null;
    const lines: string[] = [];
    while (true) {
      const line = yield* this.#readLine();
      const match = /^(\d{3})([ -])/u.exec(line);
      if (!match) return yield* new SmtpError(`smtp_${stage}_invalid_response`);
      const lineCode = Number(match[1]);
      responseCode ??= lineCode;
      if (lineCode !== responseCode) return yield* new SmtpError(`smtp_${stage}_invalid_response`);
      lines.push(line);
      if (match[2] === " ") break;
    }
    if (!expectedCodes.includes(responseCode)) {
      return yield* new SmtpReplyError(stage, responseCode, lines.join(" "));
    }
  }).bind(this);

  readonly #readLine = Effect.fn("SmtpResponseReader.readLine")(function* (
    this: SmtpResponseReader,
  ): Effect.fn.Return<string, SmtpFailure> {
    while (true) {
      const lineEnd = this.#buffer.indexOf("\r\n");
      if (lineEnd >= 0) {
        const line = this.#buffer.slice(0, lineEnd);
        this.#buffer = this.#buffer.slice(lineEnd + 2);
        return line;
      }
      const chunk = yield* smtpCall(() => this.reader.read());
      if (chunk.done) return yield* new SmtpError("smtp_connection_closed");
      this.#buffer += this.#decoder.decode(chunk.value, { stream: true });
      if (this.#buffer.length > 64 * 1024) return yield* new SmtpError("smtp_response_too_large");
    }
  });
}

// Plain text first and HTML last: a client shows the last part it can render. Both parts are
// quoted-printable, so the message is 7-bit clean and no line passes the 998-octet limit, whatever
// the relay supports. `Auto-Submitted` (RFC 3834) and `X-Auto-Response-Suppress` (Exchange and
// Outlook) stop vacation and out-of-office replies to the sending mailbox.
function createMimeMessage(from: string, message: PreparedEmailMessage): string {
  const boundary = `openbot-${crypto.randomUUID()}`;
  return dotStuff(
    [
      `From: OpenBot <${from}>`,
      `To: <${message.email}>`,
      `Subject: ${encodeHeaderValue(message.content.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${crypto.randomUUID()}@openbot.run>`,
      "Auto-Submitted: auto-generated",
      "X-Auto-Response-Suppress: All",
      "MIME-Version: 1.0",
      "Content-Type: multipart/alternative;",
      ` boundary="${boundary}"`,
      "",
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: quoted-printable",
      "",
      encodeQuotedPrintable(message.content.text),
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: quoted-printable",
      "",
      encodeQuotedPrintable(message.content.html),
      `--${boundary}--`,
    ].join("\r\n"),
  );
}

// RFC 2047 encoded words for a subject with non-ASCII text, such as a server name in Polish. Each
// word holds whole characters and stays under the 75-character limit.
function encodeHeaderValue(value: string): string {
  if (/^[\x20-\x7e]*$/u.test(value)) return value;
  const words: string[] = [];
  let chunk = "";
  for (const character of value) {
    if (new TextEncoder().encode(chunk + character).length > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += character;
  }
  if (chunk) words.push(chunk);
  return words.map((word) => `=?UTF-8?B?${encodeBase64(word)}?=`).join("\r\n ");
}

// RFC 2045 quoted-printable over UTF-8, with lines of at most 76 characters.
function encodeQuotedPrintable(value: string): string {
  return value
    .replace(/\r?\n/gu, "\n")
    .split("\n")
    .map((line) => {
      const bytes = new TextEncoder().encode(line);
      const tokens: string[] = [];
      bytes.forEach((byte, index) => {
        const isLast = index === bytes.length - 1;
        const printable = byte >= 33 && byte <= 126 && byte !== 61;
        const trailingSpace = (byte === 32 || byte === 9) && isLast;
        tokens.push(
          printable || ((byte === 32 || byte === 9) && !trailingSpace)
            ? String.fromCharCode(byte)
            : `=${byte.toString(16).toUpperCase().padStart(2, "0")}`,
        );
      });
      const lines: string[] = [];
      let current = "";
      for (const token of tokens) {
        if (current.length + token.length > 75) {
          lines.push(`${current}=`);
          current = "";
        }
        current += token;
      }
      lines.push(current);
      return lines.join("\r\n");
    })
    .join("\r\n");
}

function dotStuff(value: string): string {
  return value
    .split("\r\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");
}

const writeCommand = Effect.fn("SmtpEmail.writeCommand")(
  (writer: WritableStreamDefaultWriter<Uint8Array>, value: string) =>
    smtpCall(() => writer.write(new TextEncoder().encode(`${value}\r\n`))),
);

function validateConfig(config: SmtpEmailConfig): void {
  if (!isValidHostname(config.host)) throw new Error("smtp_invalid_host");
  if (config.port !== 465) throw new Error("smtp_port_must_be_465");
  validateEmail(config.username, "username");
  validateEmail(config.from, "sender");
  if (!config.password || hasHeaderBreak(config.password)) throw new Error("smtp_invalid_password");
}

function validateEmail(value: string, field: string): void {
  if (value.length > INPUT_LIMITS.email || hasHeaderBreak(value) || !EMAIL_PATTERN.test(value)) {
    throw new Error(`smtp_invalid_${field}`);
  }
}

function isValidHostname(value: string): boolean {
  return !hasHeaderBreak(value) && isSharedValidHostname(value, false);
}

function hasHeaderBreak(value: string): boolean {
  return value.includes("\r") || value.includes("\n");
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function loadCloudflareConnector(): Promise<SmtpConnector> {
  const { connect } = await import("cloudflare:sockets");
  return connect;
}
