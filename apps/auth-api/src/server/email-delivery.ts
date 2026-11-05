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
  | "EMAIL_FROM"
  | "EMAIL_LICENSE_FROM"
  | "EMAIL_RELAY"
  | "EMAIL_FALLBACK"
  | "EMAIL_DELIVERY_WEBHOOK_URL"
  | "EMAIL_DELIVERY_WEBHOOK_SECRET"
>;

/** The SMTP mailbox, and the Cloudflare Email Service binding that sends when the mailbox cannot. */
interface EmailSenders {
  smtp: SmtpEmailConfig;
  fallback: SendEmail | null;
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

export function createContactMessageDelivery(
  bindings: EmailDeliveryBindings,
  analytics: AccountAnalytics,
): ContactMessageDelivery | null {
  const senders = readEmailSenders(bindings);
  return senders
    ? {
        send: (message) => deliver(analytics, "contact", senders, prepareContactMessage(senders.smtp.from, message)),
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

/**
 * License emails go from `EMAIL_LICENSE_FROM` through the same SMTP account, so that account must be
 * allowed to send as it. An empty value uses `EMAIL_FROM`.
 */
export function createLicenseEmailDelivery(
  bindings: EmailDeliveryBindings,
  analytics: AccountAnalytics,
): LicenseEmailDelivery | null {
  const senders = readEmailSenders(bindings);
  if (!senders) return null;
  const licenseSenders = {
    ...senders,
    smtp: { ...senders.smtp, from: bindings.EMAIL_LICENSE_FROM?.trim() || senders.smtp.from },
  };
  return { send: (message) => deliver(analytics, "license", licenseSenders, prepareLicenseEmail(message)) };
}

/**
 * Sends through the SMTP mailbox, and through Cloudflare when SMTP surely did not send the message.
 * When both fail, the SMTP failure is the answer, so a sender limit keeps its countdown, unless the
 * Cloudflare send may have reached the recipient.
 *
 * The fallback uses only the time left in `EMAIL_CODE_DELIVERY_BUDGET_MS`: after it, a replay of the
 * sign-in request takes a code that is still pending as sent.
 */
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
  const message = prepared.success;
  const startedAt = Date.now();
  const smtp = yield* Effect.result(tracked(analytics, "email_sent", kind, sendPrivateEmail(senders.smtp, message)));
  if (Result.isSuccess(smtp)) return;
  if (!senders.fallback || !canFallBack(smtp.failure.message)) return yield* smtp.failure;
  const remainingMs = EMAIL_CODE_DELIVERY_BUDGET_MS - (Date.now() - startedAt);
  if (remainingMs < CLOUDFLARE_MIN_SEND_MS) return yield* smtp.failure;
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

// After these SMTP failures the message surely did not leave: a sender limit, a refusal of the
// sender or the message, or a connection that stopped before `DATA`. An unknown result may have
// reached the recipient, so a second send could deliver it twice. Invalid input or a refused
// recipient fails on any sender, and a configuration error must show in the logs, not hide behind
// the fallback.
function canFallBack(message: string): boolean {
  return (
    !AMBIGUOUS_DELIVERY_ERRORS.has(message) &&
    !message.startsWith("smtp_invalid_") &&
    message !== "smtp_port_must_be_465" &&
    message !== "smtp_recipient_failed"
  );
}

// The binding has no cancel signal. A send that passes this deadline may still reach the recipient.
const CLOUDFLARE_SEND_TIMEOUT_MS = 10_000;
// Below this, a send would end as unknown more often than it would succeed.
const CLOUDFLARE_MIN_SEND_MS = 2_000;

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

// Only an error code goes to the log: the error text can hold the address of the recipient.
function cloudflareErrorCode(error: unknown): string {
  const code = error instanceof Error && "code" in error ? error.code : undefined;
  if (typeof code === "string" && /^[A-Za-z0-9_.-]{1,64}$/u.test(code)) return code;
  return error instanceof Error ? error.name : typeof error;
}

/**
 * Sends one analytics event with the result of a send, so a dashboard can show the use of the hourly
 * quota of the mailbox (`email_sent`) and how often Cloudflare sends instead (`email_fallback_sent`).
 * The webhook path does not use the mailbox, so it sends none.
 */
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
  // A stopped send can stop after the server took the message.
  if (Cause.hasInterruptsOnly(exit.cause)) return "unknown";
  const error = Cause.findErrorOption(exit.cause);
  if (Option.isNone(error)) return "failed";
  if (error.value.message === RATE_LIMITED_DELIVERY_ERROR) return "rate_limited";
  return AMBIGUOUS_DELIVERY_ERRORS.has(error.value.message) ? "unknown" : "failed";
}

function readEmailSenders(bindings: EmailDeliveryBindings): EmailSenders | null {
  const smtp = readSmtpConfig(bindings);
  return smtp ? { smtp, fallback: bindings.EMAIL_FALLBACK ?? null } : null;
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
