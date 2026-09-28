import { currentText } from "@openbot/ui/text";

/** A provider quotes what it was given, so an error can carry a whole request body back. */
const ERROR_DESCRIPTION_LIMIT = 300;

/** One sentence a reader can act on, whichever surface shows it. */
export function readableAgentError(message: string): string {
  const { t, errorMessage } = currentText();
  const readable = errorMessage(message, t("agent.error.continueFailed"));
  if (readable.length <= ERROR_DESCRIPTION_LIMIT) return readable;
  return `${readable.slice(0, ERROR_DESCRIPTION_LIMIT - 1).trimEnd()}…`;
}
