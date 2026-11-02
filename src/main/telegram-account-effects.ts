import { registerSecretValue } from "@openbot/logging";
import { Schema } from "effect";
import { causeHelpers } from "../backend/effect-boundary";

/**
 * A failure of the Telegram account connection. The original error stays as the cause for the
 * native boundary; it can be a GramJS RPC error, whose `errorMessage` names Telegram's reason.
 */
export class TelegramAccountOperationError extends Schema.TaggedError<TelegramAccountOperationError>()(
  "TelegramAccountOperationError",
  { cause: Schema.Defect() },
) {}

export const {
  io: telegramAccountCall,
  sync: telegramAccountDecode,
  rewrap: toTelegramAccountOperationError,
} = causeHelpers(TelegramAccountOperationError);

/** Telegram's reason for an RPC error, or the message of any other thrown value. */
export function telegramErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    if ("errorMessage" in error && typeof error.errorMessage === "string" && error.errorMessage)
      return error.errorMessage;
    if ("message" in error && typeof error.message === "string" && error.message) return error.message;
  }
  return String(error);
}

/** Telegram's answers when the session itself is no longer valid. */
export const TELEGRAM_SESSION_ENDED: ReadonlySet<string> = new Set([
  "AUTH_KEY_UNREGISTERED",
  "AUTH_KEY_INVALID",
  "SESSION_REVOKED",
  "SESSION_EXPIRED",
  "USER_DEACTIVATED",
  "USER_DEACTIVATED_BAN",
]);

/**
 * A problem that an agent explains to the user rather than retries, such as an unknown chat or
 * sending turned off. Its message is English for the agent, never shown in the interface.
 */
export class TelegramAccountToolError extends Error {}

export function telegramToolFailure(message: string): TelegramAccountOperationError {
  return new TelegramAccountOperationError({ cause: new TelegramAccountToolError(message) });
}

/** An api_id is a positive 32-bit number that Telegram gives; anything else is not one. */
export const TELEGRAM_MAX_API_ID = 2 ** 31 - 1;

/**
 * Registers one sign-in value for redaction, after it is checked: a code and a two-step password can
 * be short, so they are registered as short secrets, but only when they have a plausible shape. A
 * mistyped value such as "+" or "1" never becomes a pattern that would hide unrelated text.
 */
export function registerSubmittedValue({
  field,
  value,
}: {
  field: "phone" | "code" | "password";
  value: string;
}): void {
  if (field === "password") {
    if (value.length >= 4) registerSecretValue(value, { allowShort: true });
    return;
  }
  if (field === "code") {
    const code = value.replace(/\s/gu, "");
    if (/^[0-9A-Za-z-]{3,12}$/u.test(code)) registerSecretValue(code, { allowShort: true });
    return;
  }
  const phone = value.replace(/[\s\-().+]/gu, "");
  if (/^\d{6,16}$/u.test(phone)) registerSecretValue(phone);
}
