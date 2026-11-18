import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { redactText } from "@openbot/logging";
import type { z } from "zod";

/** Thrown when browser tool arguments fail schema validation. The message is for the model; `userMessage` is for banners. */
export class BrowserToolArgumentsError extends Error {
  readonly userMessage: string;

  constructor(modelMessage: string, userMessage: string) {
    super(modelMessage);
    this.name = "BrowserToolArgumentsError";
    this.userMessage = userMessage;
  }
}

export function isBrowserToolArgumentsError(error: unknown): error is BrowserToolArgumentsError {
  return error instanceof BrowserToolArgumentsError;
}

export function browserArgumentsUserMessage(): string {
  return sourceText("error.agent.browserArgumentsInvalidUser");
}

/** The text providers read from a browser tool failure, without a wrapper class name. */
export function browserToolFailureText(error: unknown): string {
  if (isBrowserToolArgumentsError(error)) return error.message;
  const cause = typeof error === "object" && error !== null && "cause" in error ? error.cause : null;
  if (isBrowserToolArgumentsError(cause)) return cause.message;
  return redactText(String(error));
}

function zodArgumentDetail(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "arguments"}: ${issue.message}`).join("; ");
}

function browserArgumentHint(tool: string, args: unknown, error: z.ZodError): string {
  if (tool === "open" || !isDynamicRecord(args)) return "";
  const url = typeof args.url === "string" ? args.url.trim() : "";
  if (!url) return "";
  const missingTabId = error.issues.some(
    (issue) =>
      issue.path[0] === "tabId" && (issue.code === "invalid_type" || issue.message.includes("received undefined")),
  );
  const rejectedUrl = error.issues.some(
    (issue) =>
      issue.code === "unrecognized_keys" && "keys" in issue && Array.isArray(issue.keys) && issue.keys.includes("url"),
  );
  if (missingTabId || rejectedUrl) return sourceText("error.agent.browserArgumentsHintUrlWithoutTab");
  return "";
}

export function formatBrowserToolArgumentFailure(
  tool: string,
  args: unknown,
  error: z.ZodError,
): BrowserToolArgumentsError {
  const detail = zodArgumentDetail(error);
  const hint = browserArgumentHint(tool, args, error);
  const modelMessage = sourceText("error.agent.browserArgumentsInvalid", {
    tool,
    detail,
    hint: hint || " ",
  });
  return new BrowserToolArgumentsError(modelMessage, browserArgumentsUserMessage());
}
