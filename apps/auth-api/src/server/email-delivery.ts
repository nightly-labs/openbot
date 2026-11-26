import { Cause, Effect, Exit, Option, Result, Schema } from "effect";
import type { AccountAnalytics, EmailKind, EmailResult } from "./account-analytics";
import {
  AMBIGUOUS_DELIVERY_ERRORS,
  AUTOMATED_EMAIL_HEADERS,
  EMAIL_CODE_DELIVERY_BUDGET_MS,
  type PreparedEmailMessage,
  prepareContactMessage,
  prepareEmailCode,
  prepareLicenseEmail,
  prepareOwnerTransferEmail,
  prepareTeamInvite,
  prepareWelcomeEmail,
  RATE_LIMITED_DELIVERY_ERROR,
  type SmtpEmailConfig,
  type SmtpFailure,
  sendPrivateEmail,
} from "./smtp-email-delivery";
import type {
  ContactMessageDelivery,
  EmailCodeDelivery,
  LicenseEmailDelivery,
  OwnerTransferEmailDelivery,
  TeamInviteEmailDelivery,
  WelcomeEmailDelivery,
  WorkerBindings,
} from "./types";

export class EmailDeliveryError extends Schema.TaggedError<EmailDeliveryError>()("EmailDeliveryError", {
  message: Schema.String,
}) {}

export type EmailDeliveryBindings = Pick<
  WorkerBindings,
  | "EMAIL_SMTP_HOST"
  | "EMAIL_SMTP_PORT"
  | "EMAIL_SMTP_USERNAME"
  | "EMAIL_SMTP_PASSWORD"
  | "EMAIL_SMTP_OVERFLOW_USERNAME"
  | "EMAIL_SMTP_OVERFLOW_PASSWORD"
  | "EMAIL_FROM"
  | "EMAIL_REPLY_TO"
  | "EMAIL_LICENSE_FROM"
  | "EMAIL_LICENSE_REPLY_TO"
  | "EMAIL_RELAY"
  | "EMAIL_FALLBACK"
  | "EMAIL_DELIVERY_WEBHOOK_URL"
  | "EMAIL_DELIVERY_WEBHOOK_SECRET"
>;

interface EmailSenders {
  smtp: SmtpEmailConfig;
  overflow: SmtpEmailConfig | null;
  fallback: SendEmail | null;
  inbox: string;
}

export function createEmailCodeDelivery(
  bindings: EmailDeliveryBindings,
  analytics: AccountAnalytics,
): EmailCodeDelivery | null {
  const senders = readEmailSenders(bindings);
  if (senders) {
    return { send: (message) => deliver(analytics, "sign_in_code", senders, prepareEmailCode(message)) };
  }

  const webhookUrl = bindings.EMAIL_DELIVERY_WEBHOOK_URL?.trim();
  if (!webhookUrl) return null;
  const url = new URL(webhookUrl);
  if (url.protocol !== "https:") {
    throw new Error("EMAIL_DELIVERY_WEBHOOK_URL must use HTTPS.");
  }
  const secret = bindings.EMAIL_DELIVERY_WEBHOOK_SECRET?.trim();
  const send = Effect.fn("EmailDelivery.sendCode")(function* (message: Parameters<EmailCodeDelivery["send"]>[0]) {
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(secret ? { Authorization: `Bearer ${secret}` } : {}) },
          body: JSON.stringify(message),
          signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
        }),
      catch: () => new EmailDeliveryError({ message: "email_delivery_unknown" }),
    });
    if (response.status === 429) return yield* new EmailDeliveryError({ message: RATE_LIMITED_DELIVERY_ERROR });
    if (!response.ok) return yield* new EmailDeliveryError({ message: "email_delivery_webhook_failed" });
  });
  return { send };
}

export function createTeamInviteEmailDelivery(
  bindings: EmailDeliveryBindings,
  analytics: AccountAnalytics,
): TeamInviteEmailDelivery | null {
  const senders = readEmailSenders(bindings);
  return senders ? { send: (message) => deliver(analytics, "team_invite", senders, prepareTeamInvite(message)) } : null;
}

export function createOwnerTransferEmailDelivery(
  bindings: EmailDeliveryBindings,
  analytics: AccountAnalytics,
): OwnerTransferEmailDelivery | null {
  const senders = readEmailSenders(bindings);
  return senders
    ? { send: (message) => deliver(analytics, "owner_transfer", senders, prepareOwnerTransferEmail(message)) }
    : null;
}

export function createContactMessageDelivery(
  bindings: EmailDeliveryBindings,
  analytics: AccountAnalytics,
): ContactMessageDelivery | null {
  const senders = readEmailSenders(bindings);
  return senders
    ? {
        send: (message) => deliver(analytics, "contact", senders, prepareContactMessage(senders.inbox, message)),
      }
    : null;
}

export function createWelcomeEmailDelivery(
  bindings: EmailDeliveryBindings,
  analytics: AccountAnalytics,
): WelcomeEmailDelivery | null {
  const senders = readEmailSenders(bindings);
  return senders ? { send: (message) => deliver(analytics, "welcome", senders, prepareWelcomeEmail(message)) } : null;
}

export function createLicenseEmailDelivery(
  bindings: EmailDeliveryBindings,
  analytics: AccountAnalytics,
): LicenseEmailDelivery | null {
  const senders = readEmailSenders(bindings);
  if (!senders) return null;
  const from = bindings.EMAIL_LICENSE_FROM?.trim() || senders.smtp.from;
  const licenseSenders = {
    ...senders,
    smtp: { ...senders.smtp, from },
    inbox: bindings.EMAIL_LICENSE_REPLY_TO?.trim() || from,
  };
  return { send: (message) => deliver(analytics, "license", licenseSenders, prepareLicenseEmail(message)) };
}

const deliver = Effect.fn("EmailDelivery.deliver")(function* (
  analytics: AccountAnalytics,
  kind: EmailKind,
  senders: EmailSenders,
  prepare: Effect.Effect<PreparedEmailMessage, SmtpFailure>,
): Effect.fn.Return<void, SmtpFailure | EmailDeliveryError> {
  const prepared = yield* Effect.result(prepare);
  if (Result.isFailure(prepared)) {
    analytics.track(null, { name: "email_sent", kind, result: "failed" });
    return yield* prepared.failure;
  }
  const message = withInboxReply(senders, prepared.success);
  const startedAt = Date.now();
  const primary = yield* Effect.result(tracked(analytics, "email_sent", kind, sendPrivateEmail(senders.smtp, message)));
  if (Result.isSuccess(primary)) return;
  const smtp = yield* Effect.result(sendThroughOverflow(analytics, kind, senders, message, primary.failure, startedAt));
  if (Result.isSuccess(smtp)) return;
  if (!senders.fallback || !canFallBack(smtp.failure.message)) return yield* smtp.failure;
  const remainingMs = EMAIL_CODE_DELIVERY_BUDGET_MS - (Date.now() - startedAt);
  if (remainingMs < MIN_SEND_MS) return yield* smtp.failure;
  console.warn("Email delivery falls back to Cloudflare:", { kind, reason: smtp.failure.message });
  const fallback = yield* Effect.result(
    tracked(
      analytics,
      "email_fallback_sent",
      kind,
      sendThroughCloudflare(
        senders.fallback,
        senders.smtp.from,
        message,
        Math.min(CLOUDFLARE_SEND_TIMEOUT_MS, remainingMs),
      ),
    ),
  );
  if (Result.isSuccess(fallback)) return;
  return yield* AMBIGUOUS_DELIVERY_ERRORS.has(fallback.failure.message) ? fallback.failure : smtp.failure;
});

const sendThroughOverflow = Effect.fn("EmailDelivery.overflow")(function* (
  analytics: AccountAnalytics,
  kind: EmailKind,
  senders: EmailSenders,
  message: PreparedEmailMessage,
  primaryFailure: SmtpFailure,
  startedAt: number,
): Effect.fn.Return<void, SmtpFailure | EmailDeliveryError> {
  const remainingMs = EMAIL_CODE_DELIVERY_BUDGET_MS - (Date.now() - startedAt);
  if (!senders.overflow || primaryFailure.message !== RATE_LIMITED_DELIVERY_ERROR || remainingMs < MIN_SEND_MS) {
    return yield* primaryFailure;
  }
  yield* tracked(
    analytics,
    "email_sent",
    kind,
    sendPrivateEmail(senders.overflow, message).pipe(
      Effect.timeoutOrElse({
        duration: remainingMs,
        orElse: () => Effect.fail(new EmailDeliveryError({ message: "email_delivery_unknown" })),
      }),
    ),
  );
});

function canFallBack(message: string): boolean {
  return (
    !AMBIGUOUS_DELIVERY_ERRORS.has(message) &&
    !message.startsWith("smtp_invalid_") &&
    message !== "smtp_port_must_be_465" &&
    message !== "smtp_recipient_failed"
  );
}

const CLOUDFLARE_SEND_TIMEOUT_MS = 10_000;
const MIN_SEND_MS = 2_000;

const sendThroughCloudflare = Effect.fn("EmailDelivery.cloudflare")(function* (
  binding: SendEmail,
  from: string,
  message: PreparedEmailMessage,
  timeoutMs: number,
): Effect.fn.Return<void, EmailDeliveryError> {
  const { subject, text, html } = message.content;
  yield* Effect.tryPromise({
    try: () =>
      binding.send({
        from: { name: "OpenBot", email: from },
        to: message.email,
        ...(message.replyTo ? { replyTo: message.replyTo } : {}),
        subject,
        text,
        html,
        headers: { ...AUTOMATED_EMAIL_HEADERS },
      }),
    catch: (error) => {
      console.warn("Cloudflare email delivery failed:", cloudflareErrorCode(error));
      return new EmailDeliveryError({ message: "email_delivery_fallback_failed" });
    },
  }).pipe(
    Effect.timeoutOrElse({
      duration: timeoutMs,
      orElse: () => Effect.fail(new EmailDeliveryError({ message: "email_delivery_unknown" })),
    }),
  );
});

function cloudflareErrorCode(error: unknown): string {
  const code = error instanceof Error && "code" in error ? error.code : undefined;
  if (typeof code === "string" && /^[A-Za-z0-9_.-]{1,64}$/u.test(code)) return code;
  return error instanceof Error ? error.name : typeof error;
}

function tracked<E extends { message: string }>(
  analytics: AccountAnalytics,
  name: "email_sent" | "email_fallback_sent",
  kind: EmailKind,
  send: Effect.Effect<void, E>,
): Effect.Effect<void, E> {
  return Effect.onExit(send, (exit) =>
    Effect.sync(() => analytics.track(null, { name, kind, result: sendResult(exit) })),
  );
}

function sendResult(exit: Exit.Exit<void, { message: string }>): EmailResult {
  if (Exit.isSuccess(exit)) return "accepted";
  if (Cause.hasInterruptsOnly(exit.cause)) return "unknown";
  const error = Cause.findErrorOption(exit.cause);
  if (Option.isNone(error)) return "failed";
  if (error.value.message === RATE_LIMITED_DELIVERY_ERROR) return "rate_limited";
  return AMBIGUOUS_DELIVERY_ERRORS.has(error.value.message) ? "unknown" : "failed";
}

function readEmailSenders(bindings: EmailDeliveryBindings): EmailSenders | null {
  const smtp = readSmtpConfig(bindings);
  if (!smtp) return null;
  const inbox = bindings.EMAIL_REPLY_TO?.trim() || smtp.from;
  return { smtp, overflow: readOverflowSmtpConfig(bindings, smtp), fallback: bindings.EMAIL_FALLBACK ?? null, inbox };
}

function readOverflowSmtpConfig(bindings: EmailDeliveryBindings, primary: SmtpEmailConfig): SmtpEmailConfig | null {
  const username = bindings.EMAIL_SMTP_OVERFLOW_USERNAME?.trim();
  const password = bindings.EMAIL_SMTP_OVERFLOW_PASSWORD;
  if (!username || !password) return null;
  return { ...primary, username, password, from: username };
}

function withInboxReply(senders: EmailSenders, message: PreparedEmailMessage): PreparedEmailMessage {
  if (message.replyTo || senders.inbox === senders.smtp.from) return message;
  return { ...message, replyTo: senders.inbox };
}

function readSmtpConfig(bindings: EmailDeliveryBindings): SmtpEmailConfig | null {
  const values = {
    host: bindings.EMAIL_SMTP_HOST?.trim(),
    port: bindings.EMAIL_SMTP_PORT?.trim(),
    username: bindings.EMAIL_SMTP_USERNAME?.trim(),
    password: bindings.EMAIL_SMTP_PASSWORD,
    from: bindings.EMAIL_FROM?.trim(),
  };
  const configuredCount = Object.values(values).filter((value) => value !== undefined && value !== "").length;
  if (configuredCount === 0) return null;
  if (
    configuredCount !== Object.keys(values).length ||
    !values.host ||
    !values.port ||
    !values.username ||
    !values.password ||
    !values.from
  ) {
    throw new Error("SMTP email delivery configuration is incomplete.");
  }
  return {
    host: values.host,
    port: Number(values.port),
    username: values.username,
    password: values.password,
    from: values.from,
    ...(bindings.EMAIL_RELAY ? { relay: bindings.EMAIL_RELAY } : {}),
  };
}
