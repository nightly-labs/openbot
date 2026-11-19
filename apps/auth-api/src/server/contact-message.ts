import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Schema } from "effect";
import { CONTACT_LIMITS, contactTopicLabel } from "../lib/contact";
import { AuthServiceError, emailDeliveryFailure, isEmailDeliveryFailure, normalizeEmail } from "./auth-service";
import { sha256 } from "./crypto";
import type { AuthRepository, ContactMessageDelivery } from "./types";

export interface ContactMessageServices {
  repository: Pick<AuthRepository, "incrementRateLimit">;
  now: () => number;
  delivery: () => ContactMessageDelivery | null;
}

const ContactForm = Schema.Struct({
  name: Schema.optional(Schema.String),
  email: Schema.String,
  company: Schema.optional(Schema.String),
  topic: Schema.String,
  message: Schema.String,
});

const RATE_WINDOW_MS = 15 * 60_000;
const SENDER_LIMIT = 3;
const TOTAL_LIMIT = 15;

export const sendContactMessage = Effect.fn("ContactMessage.send")(function* (
  services: ContactMessageServices,
  input: DynamicRecord,
  sourceIp: string,
) {
  const invalid = () => new AuthServiceError(400, "invalid_contact", "The message is invalid.");
  const body = yield* Schema.decodeUnknownEffect(ContactForm)(input).pipe(Effect.mapError(invalid));
  const name = optionalLine(body.name, CONTACT_LIMITS.name);
  const company = optionalLine(body.company, CONTACT_LIMITS.company);
  const topic = contactTopicLabel(body.topic);
  const message = body.message.trim();
  if (name === undefined || company === undefined || !topic || !message || message.length > CONTACT_LIMITS.message)
    return yield* invalid();
  const email = yield* Effect.try({
    try: () => normalizeEmail(body.email),
    catch: (error) => (error instanceof AuthServiceError ? error : invalid()),
  });

  const now = services.now();
  const windowStart = Math.floor(now / RATE_WINDOW_MS) * RATE_WINDOW_MS;
  const limits = [
    [`contact:ip:${sourceIp}`, SENDER_LIMIT],
    ["contact:all", TOTAL_LIMIT],
  ] as const;
  for (const [key, limit] of limits) {
    const result = yield* services.repository.incrementRateLimit(yield* sha256(key), windowStart, limit);
    if (!result.allowed) {
      return yield* new AuthServiceError(
        429,
        "contact_rate_limited",
        "Too many messages were sent. Try again later.",
        Math.max(1, Math.ceil((windowStart + RATE_WINDOW_MS - now) / 1_000)),
      );
    }
  }

  const delivery = services.delivery();
  if (!delivery)
    return yield* new AuthServiceError(503, "email_delivery_not_configured", "Email delivery is unavailable.");
  yield* delivery
    .send({ name, email, company, topic, message })
    .pipe(
      Effect.mapError((error) =>
        isEmailDeliveryFailure(error)
          ? emailDeliveryFailure(error.message, "OpenBot could not send the message.")
          : new AuthServiceError(502, "email_delivery_failed", "OpenBot could not send the message."),
      ),
    );
});

function optionalLine(value: string | undefined, limit: number): string | null | undefined {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  return trimmed.length > limit || /[\r\n]/u.test(trimmed) ? undefined : trimmed;
}
