import { Cause, Effect, Exit, Option, Schema } from "effect";
import type { AccountAnalytics, EmailKind, EmailResult } from "./account-analytics";
import {
  AMBIGUOUS_DELIVERY_ERRORS,
  RATE_LIMITED_DELIVERY_ERROR,
  type SmtpEmailConfig,
  sendPrivateContactMessage,
  sendPrivateEmailCode,
  sendPrivateTeamInvite,
  sendPrivateWelcomeEmail,
} from "./smtp-email-delivery";
import type {
  ContactMessageDelivery,
  EmailCodeDelivery,
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
  | "EMAIL_DELIVERY_WEBHOOK_URL"
  | "EMAIL_DELIVERY_WEBHOOK_SECRET"
>;

export function createEmailCodeDelivery(
  bindings: EmailDeliveryBindings,
  analytics: AccountAnalytics,
): EmailCodeDelivery | null {
  const smtp = readSmtpConfig(bindings);
  if (smtp) {
    return {
      send: (message) => tracked(analytics, "sign_in_code", sendPrivateEmailCode(smtp, message)),
    };
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
  const smtp = readSmtpConfig(bindings);
  return smtp ? { send: (message) => tracked(analytics, "team_invite", sendPrivateTeamInvite(smtp, message)) } : null;
}

export function createContactMessageDelivery(
  bindings: EmailDeliveryBindings,
  analytics: AccountAnalytics,
): ContactMessageDelivery | null {
  const smtp = readSmtpConfig(bindings);
  return smtp ? { send: (message) => tracked(analytics, "contact", sendPrivateContactMessage(smtp, message)) } : null;
}

export function createWelcomeEmailDelivery(
  bindings: EmailDeliveryBindings,
  analytics: AccountAnalytics,
): WelcomeEmailDelivery | null {
  const smtp = readSmtpConfig(bindings);
  return smtp ? { send: (message) => tracked(analytics, "welcome", sendPrivateWelcomeEmail(smtp, message)) } : null;
}

/**
 * Sends one `email_sent` event with the result of an SMTP send, so a dashboard can show the use of the
 * hourly quota of the mailbox. The webhook path does not use the mailbox, so it sends none.
 */
function tracked<E extends { message: string }>(
  analytics: AccountAnalytics,
  kind: EmailKind,
  send: Effect.Effect<void, E>,
): Effect.Effect<void, E> {
  return Effect.onExit(send, (exit) =>
    Effect.sync(() => analytics.track(null, { name: "email_sent", kind, result: sendResult(exit) })),
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
  };
}
