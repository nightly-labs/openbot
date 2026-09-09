import { redactText } from "@openbot/logging";

/** Format errors for display only. Keep the original error for logs and recovery decisions. */
export function userErrorMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const message = raw.trim().replace(/^(?:(?:Error invoking remote method '[^']+':|Error:)\s*)+/u, "");
  const code = message.match(/^(?:[a-z]+\s+)?(E[A-Z_]+)(?=[:\s]|$)/u)?.[1];

  if (
    /^(?:TypeError: )?(?:Failed to fetch|fetch failed|Network request failed|Load failed|NetworkError when attempting to fetch resource\.)$/iu.test(
      message,
    ) ||
    ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "ERR_NETWORK", "ERR_INTERNET_DISCONNECTED"].includes(
      code ?? "",
    )
  ) {
    return "Could not connect. Check your connection and try again.";
  }
  if (
    code === "ETIMEDOUT" ||
    code === "ERR_CONNECTION_TIMED_OUT" ||
    (error instanceof Error && error.name === "TimeoutError")
  ) {
    return "The request took too long. Check whether the action completed before you try again.";
  }
  if (code === "ENOSPC") {
    return "There is not enough storage space. Free some space on the computer running OpenBot, then try again.";
  }
  if (code === "EACCES" || code === "EPERM") {
    return "OpenBot does not have permission to complete this action. Check the file or folder permissions, then try again.";
  }
  if (code === "ENOENT") {
    return "A required file or folder could not be found. Restore it or choose another one, then try again.";
  }
  if (code === "EROFS") {
    return "This folder is read-only. Choose a folder you can write to, then try again.";
  }
  if (code === "EEXIST") {
    return "An item with this name already exists. Choose a different name, then try again.";
  }
  if (/^(?:HTTP )?401(?:\b|:)/u.test(message)) {
    return "Authentication failed. Check your account or server connection, then try again.";
  }
  if (/^(?:HTTP )?403(?:\b|:)/u.test(message)) {
    return "You do not have permission to complete this action. Ask the owner for access.";
  }
  if (/^(?:HTTP )?429(?:\b|:)/u.test(message)) {
    return "Too many requests. Wait a moment, then try again.";
  }
  if (/^(?:HTTP )?5\d\d(?:\b|:)/u.test(message)) {
    return "The service is unavailable. Wait a moment, then try again.";
  }

  // Preserve useful product validation messages, but do not display runtime output or paths.
  if (
    !message ||
    message.length > 400 ||
    /^(?:TypeError|SyntaxError|ReferenceError|RangeError):/u.test(message) ||
    error instanceof TypeError ||
    error instanceof SyntaxError ||
    error instanceof ReferenceError ||
    error instanceof RangeError ||
    /(?:\bSQLITE_\w+|\bERR_\w+|^E[A-Z_]+:|^Command failed|^spawn |\n\s*at |\[object Object\]|^\s*[<{[]|\/(?:Users|home|tmp|private|var|etc|usr)\/|[A-Za-z]:\\)/u.test(
      message,
    )
  ) {
    return fallback;
  }
  return redactText(message);
}
