import { registerSecretValue } from "@openbot/logging";
import { Schema } from "effect";
import { causeHelpers } from "../backend/effect-boundary";

/**
 * A failure of the WhatsApp account connection. The original error stays as the cause for the native
 * boundary; it can be a Baileys error, whose `output.statusCode` names WhatsApp's reason.
 */
export class WhatsAppAccountOperationError extends Schema.TaggedError<WhatsAppAccountOperationError>()(
  "WhatsAppAccountOperationError",
  { cause: Schema.Defect() },
) {}

export const {
  io: whatsappAccountCall,
  sync: whatsappAccountDecode,
  rewrap: toWhatsAppAccountOperationError,
} = causeHelpers(WhatsAppAccountOperationError);

/** The status code of a Baileys error, as WhatsApp or Baileys set it, or null. */
export function whatsappStatusCode(error: unknown): number | null {
  if (error && typeof error === "object" && "output" in error) {
    const output = error.output;
    if (output && typeof output === "object" && "statusCode" in output && typeof output.statusCode === "number")
      return output.statusCode;
  }
  return null;
}

/** The message of a thrown value, with the status code of a Baileys error. */
export function whatsappErrorMessage(error: unknown): string {
  const code = whatsappStatusCode(error);
  const message =
    error && typeof error === "object" && "message" in error && typeof error.message === "string"
      ? error.message
      : String(error);
  return code === null ? message : `${message} (${code})`;
}

/**
 * A problem that an agent explains to the user rather than retries, such as an unknown chat or
 * sending turned off. Its message is English for the agent, never shown in the interface.
 */
export class WhatsAppAccountToolError extends Error {}

export function whatsappToolFailure(message: string): WhatsAppAccountOperationError {
  return new WhatsAppAccountOperationError({ cause: new WhatsAppAccountToolError(message) });
}

/**
 * The digits of a phone number in international form, or null. WhatsApp numbers have 7 to 15 digits
 * with the country code (E.164). A leading "00" is the international prefix.
 */
export function phoneDigits(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\+?[\d\s\-().]+$/u.test(trimmed)) return null;
  let digits = trimmed.replace(/\D/gu, "");
  if (!trimmed.startsWith("+") && digits.startsWith("00")) digits = digits.slice(2);
  return /^[1-9]\d{6,14}$/u.test(digits) ? digits : null;
}

/** Registers a phone number for redaction, in the forms that a log line can carry. */
export function registerPhoneNumber(digits: string): void {
  registerSecretValue(digits);
  registerSecretValue(`+${digits}`);
}

/** The phone number with its middle hidden, for anything that leaves the main process. */
export function maskPhoneNumber(digits: string | null): string | null {
  if (!digits) return null;
  if (digits.length < 7) return "+***";
  return `+${digits.slice(0, 4)}***${digits.slice(-3)}`;
}
