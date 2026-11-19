import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { isCanonicalInviteUrl } from "@openbot/contracts/invite-links";
import { isValidHostname as isSharedValidHostname } from "@openbot/contracts/validation";
import { Effect, Fiber, Option, Result, Schema } from "effect";
import {
  type ContactMessageEmailInput,
  type LicenseEmailInput,
  type RenderedEmail,
  renderContactMessageEmail,
  renderLicenseEmail,
  renderSignInCodeEmail,
  renderTeamInviteEmail,
  renderWelcomeEmail,
  type WelcomeEmailInput,
} from "./email-templates";

interface EmailRelay {
  fetch(request: Request): Promise<Response>;
}

export interface SmtpEmailConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  from: string;
  relay?: EmailRelay;
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

export type SmtpContactMessage = ContactMessageEmailInput;

export interface SmtpWelcomeMessage extends WelcomeEmailInput {
  email: string;
}

export type SmtpLicenseMessage = LicenseEmailInput & { email: string };

export interface PreparedEmailMessage {
  email: string;
  replyTo?: string;
  content: RenderedEmail;
}

interface SmtpAttemptState {
  submissionStarted: boolean;
  accepted: boolean;
  replyAt: Record<string, number>;
}

interface SmtpSocket {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  opened: Promise<unknown>;
  close(): void | Promise<void>;
}

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
export const RATE_LIMITED_DELIVERY_ERROR = "email_delivery_rate_limited";
export const AMBIGUOUS_DELIVERY_ERRORS: ReadonlySet<string> = new Set([
  "smtp_delivery_unknown",
  "email_delivery_unknown",
]);
const SENDER_LIMIT_REPLY = /too many (?:messages|emails|recipients)|(?:sending|send|message|rate) limit|rate limited/iu;
const SMTP_TIMEOUT_MS = 7_500;
const SMTP_CLOSE_TIMEOUT_MS = 250;
const SMTP_MAX_ATTEMPTS = 3;
const RELAY_URL = "https://openbot-email-relay.internal/send";
const RELAY_TIMEOUT_MS = EMAIL_CODE_DELIVERY_BUDGET_MS + 5_000;
const EMAIL_PATTERN = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+$/iu;

export const prepareEmailCode = Effect.fn("Email.prepareCode")(function* (
  message: SmtpEmailMessage,
): Effect.fn.Return<PreparedEmailMessage, SmtpFailure> {
  yield* smtpValidate(() => {
    validateEmail(message.email, "recipient");
    if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/u.test(message.code)) {
      throw new Error("smtp_invalid_code");
    }
  });
  return {
    email: message.email,
    content: renderSignInCodeEmail({
      code: message.code,
      expiresInMinutes: Math.max(1, Math.ceil((message.expiresAt - Date.now()) / 60_000)),
    }),
  };
});

export const prepareTeamInvite = Effect.fn("Email.prepareTeamInvite")(function* (
  message: SmtpTeamInviteMessage,
): Effect.fn.Return<PreparedEmailMessage, SmtpFailure> {
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
  return {
    email: message.email,
    content: renderTeamInviteEmail({
      inviterEmail: message.inviterEmail,
      serverName: message.serverName,
      inviteUrl: message.inviteUrl,
      role: message.role,
    }),
  };
});

export const prepareWelcomeEmail = Effect.fn("Email.prepareWelcome")(function* (
  message: SmtpWelcomeMessage,
): Effect.fn.Return<PreparedEmailMessage, SmtpFailure> {
  yield* smtpValidate(() => {
    if (
      !message.serverName.trim() ||
      message.serverName.length > INPUT_LIMITS.serverName ||
      hasHeaderBreak(message.serverName)
    ) {
      throw new Error("smtp_invalid_server_name");
    }
  });
  return { email: message.email, content: renderWelcomeEmail({ plan: message.plan, serverName: message.serverName }) };
});

export function prepareLicenseEmail(message: SmtpLicenseMessage): Effect.Effect<PreparedEmailMessage> {
  return Effect.sync(() => ({ email: message.email, content: renderLicenseEmail(message) }));
}

export function prepareContactMessage(
  recipient: string,
  message: SmtpContactMessage,
): Effect.Effect<PreparedEmailMessage> {
  return Effect.sync(() => ({ email: recipient, replyTo: message.email, content: renderContactMessageEmail(message) }));
}

export const AUTOMATED_EMAIL_HEADERS = {
  "Auto-Submitted": "auto-generated",
  "X-Auto-Response-Suppress": "All",
} as const;

export const sendPrivateEmail = Effect.fn("SmtpEmail.send")(function* (
  config: SmtpEmailConfig,
  message: PreparedEmailMessage,
  connector?: SmtpConnector,
): Effect.fn.Return<void, SmtpFailure> {
  yield* smtpValidate(() => validateConfig(config));
  yield* smtpValidate(() => validateEmail(message.email, "recipient"));
  const { replyTo } = message;
  if (replyTo !== undefined) yield* smtpValidate(() => validateEmail(replyTo, "reply_to"));
  const { subject } = message.content;
  if (!subject || subject.length > 160 || hasHeaderBreak(subject)) return yield* new SmtpError("smtp_invalid_subject");
  if (config.relay) return yield* sendThroughRelay(config.relay, config, message);
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

const RelayedEmail = Schema.Struct({
  config: Schema.Struct({
    host: Schema.String,
    port: Schema.Number,
    username: Schema.String,
    password: Schema.String,
    from: Schema.String,
  }),
  message: Schema.Struct({
    email: Schema.String,
    replyTo: Schema.optionalKey(Schema.String),
    content: Schema.Struct({
      subject: Schema.String,
      preheader: Schema.String,
      text: Schema.String,
      html: Schema.String,
    }),
  }),
});
const RelayFailure = Schema.Struct({ error: Schema.String });
const DELIVERY_ERROR_PATTERN = /^(?:smtp|email_delivery)_[a-z_]+$/u;

const sendThroughRelay = Effect.fn("SmtpEmail.relay")(function* (
  relay: EmailRelay,
  config: SmtpEmailConfig,
  message: PreparedEmailMessage,
): Effect.fn.Return<void, SmtpFailure> {
  const { relay: _relay, ...smtp } = config;
  const unknown = () => new SmtpError("smtp_delivery_unknown");
  const failure = yield* Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        relay.fetch(
          new Request(RELAY_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ config: smtp, message }),
            signal,
          }),
        ),
      catch: unknown,
    });
    if (response.status === 204) return null;
    const body = yield* Effect.tryPromise({ try: () => response.json(), catch: unknown });
    const decoded = Schema.decodeUnknownOption(RelayFailure)(body);
    if (Option.isNone(decoded) || !DELIVERY_ERROR_PATTERN.test(decoded.value.error)) return unknown();
    return new SmtpError(decoded.value.error);
  }).pipe(Effect.timeoutOrElse({ duration: RELAY_TIMEOUT_MS, orElse: () => Effect.fail(unknown()) }));
  if (failure) return yield* failure;
});

export const sendRelayedEmail = Effect.fn("SmtpEmail.sendRelayed")(function* (
  request: Request,
  connector?: SmtpConnector,
): Effect.fn.Return<void, SmtpFailure> {
  const invalid = () => new SmtpError("smtp_invalid_relay_request");
  const body = yield* Effect.tryPromise({ try: () => request.json(), catch: invalid });
  const { config, message } = yield* Schema.decodeUnknownEffect(RelayedEmail)(body).pipe(Effect.mapError(invalid));
  return yield* sendPrivateEmail(config, message, connector);
});

const sendPrivateEmailAttempt = Effect.fn("SmtpEmail.attempt")(function* (
  config: SmtpEmailConfig,
  message: PreparedEmailMessage,
  connect: SmtpConnector,
): Effect.fn.Return<void, SmtpFailure> {
  const startedAt = Date.now();
  const state: SmtpAttemptState = { submissionStarted: false, accepted: false, replyAt: {} };
  const outcome: { error: SmtpFailure | null } = { error: null };
  yield* Effect.acquireUseRelease(
    Effect.gen(function* () {
      const socket = yield* smtpValidate(() =>
        connect({ hostname: config.host, port: config.port }, { secureTransport: "on", allowHalfOpen: false }),
      );
      const session = yield* Effect.forkChild(
        Effect.result(runSmtpSession(socket, config, message, state, startedAt)),
        {
          uninterruptible: false,
          startImmediately: true,
        },
      );
      return { socket, session };
    }),
    ({ session }) =>
      Effect.gen(function* () {
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
        yield* Fiber.interrupt(session);
        yield* closeSmtpSocket(socket);
      }),
  );
  console.info("SMTP session timing:", {
    accepted: state.accepted,
    totalMs: Date.now() - startedAt,
    replyAtMs: state.replyAt,
  });
  if (state.accepted) return;
  if (outcome.error && !isRetryableSmtpError(outcome.error)) return yield* outcome.error;
  if (state.submissionStarted) return yield* new SmtpError("smtp_delivery_unknown");
  if (outcome.error) return yield* outcome.error;
  return yield* new SmtpError("smtp_delivery_unknown");
});

function closeSmtpSocket(socket: SmtpSocket): Effect.Effect<void> {
  return Effect.tryPromise(async () => socket.close()).pipe(Effect.timeoutOption(SMTP_CLOSE_TIMEOUT_MS), Effect.ignore);
}

function normalizeSmtpError(error: unknown): SmtpFailure {
  if (error instanceof SmtpReplyError || error instanceof SmtpError) return error;
  if (error instanceof Error && /^smtp_[a-z_]+$/u.test(error.message)) return new SmtpError(error.message);
  return wrapTransportError();
}

function wrapTransportError(): SmtpError {
  return new SmtpError("smtp_transport_failed");
}

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
  startedAt: number,
): Effect.fn.Return<void, SmtpFailure> {
  yield* smtpCall(() => socket.opened);
  const reader = new SmtpResponseReader(socket.readable.getReader());
  const writer = socket.writable.getWriter();
  const expect = (expectedCodes: number[], stage: string) =>
    reader.expect(expectedCodes, stage).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          state.replyAt[stage] = Date.now() - startedAt;
        }),
      ),
    );

  yield* expect([220], "greeting");
  yield* writeCommand(writer, "EHLO openbot.run");
  const extensions = yield* expect([250], "ehlo");
  if (extensions.some((line) => /^AUTH\b.*\bPLAIN\b/iu.test(line))) {
    yield* writeCommand(writer, `AUTH PLAIN ${encodeBase64(`\0${config.username}\0${config.password}`)}`);
  } else {
    yield* writeCommand(writer, "AUTH LOGIN");
    yield* expect([334], "auth_username");
    yield* writeCommand(writer, encodeBase64(config.username));
    yield* expect([334], "auth_password");
    yield* writeCommand(writer, encodeBase64(config.password));
  }
  yield* expect([235], "auth");
  const mailFrom = `MAIL FROM:<${config.from}>`;
  const recipient = `RCPT TO:<${message.email}>`;
  if (extensions.some((line) => /^PIPELINING$/iu.test(line))) {
    yield* writeCommand(writer, `${mailFrom}\r\n${recipient}\r\nDATA`);
    yield* expect([250], "mail_from");
    yield* expect([250, 251], "recipient");
  } else {
    yield* writeCommand(writer, mailFrom);
    yield* expect([250], "mail_from");
    yield* writeCommand(writer, recipient);
    yield* expect([250, 251], "recipient");
    yield* writeCommand(writer, "DATA");
  }
  yield* expect([354], "data");
  state.submissionStarted = true;
  yield* writeCommand(writer, `${createMimeMessage(config.from, message)}\r\n.`);
  yield* expect([250], "message");
  state.accepted = true;
  yield* writeCommand(writer, "QUIT");
});

class SmtpResponseReader {
  readonly #decoder = new TextDecoder();
  #buffer = "";

  constructor(private readonly reader: ReadableStreamDefaultReader<Uint8Array>) {}

  readonly expect = Effect.fn("SmtpResponseReader.expect")(function* (
    this: SmtpResponseReader,
    expectedCodes: number[],
    stage: string,
  ): Effect.fn.Return<string[], SmtpFailure> {
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
    return lines.map((line) => line.slice(4));
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

function createMimeMessage(from: string, message: PreparedEmailMessage): string {
  const boundary = `openbot-${crypto.randomUUID()}`;
  return dotStuff(
    [
      `From: OpenBot <${from}>`,
      `To: <${message.email}>`,
      ...(message.replyTo ? [`Reply-To: <${message.replyTo}>`] : []),
      `Subject: ${encodeHeaderValue(message.content.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${crypto.randomUUID()}@openbot.run>`,
      ...Object.entries(AUTOMATED_EMAIL_HEADERS).map(([name, value]) => `${name}: ${value}`),
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
