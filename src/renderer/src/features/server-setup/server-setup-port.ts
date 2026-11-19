import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { SERVER_SETUP_HEADER, SERVER_SETUP_ROUTES } from "@openbot/contracts/server-setup";

/**
 * The calls of the server setup page (`src/main/server-setup-page.ts`). Each answer is a flat record
 * of the answer lines of `ServerMode`. A failed request has `error` and, from the account service,
 * `message` in English.
 */
export interface SetupAnswer {
  ok: boolean;
  values: Record<string, string | number>;
}

/** No answer from the page: the server stopped, or the network failed. */
export const NO_ANSWER = "no_answer";

export function setupStatus(): Promise<SetupAnswer> {
  return call("GET", SERVER_SETUP_ROUTES.status);
}

export function setupLoginStart(email: string): Promise<SetupAnswer> {
  return call("POST", SERVER_SETUP_ROUTES.loginStart, { email });
}

export function setupLoginVerify(challenge: string, code: string): Promise<SetupAnswer> {
  return call("POST", SERVER_SETUP_ROUTES.loginVerify, { challenge, code });
}

/** Starts the account of the server again after an error, as the Retry button of the app does. */
export function setupRetry(): Promise<SetupAnswer> {
  return call("POST", SERVER_SETUP_ROUTES.retry, {});
}

export function text(answer: SetupAnswer, key: string): string | null {
  const value = answer.values[key];
  return isString(value) && value ? value : null;
}

export function number(answer: SetupAnswer, key: string): number | null {
  const value = answer.values[key];
  return isNumber(value) ? value : null;
}

async function call(method: "GET" | "POST", path: string, fields?: Record<string, string>): Promise<SetupAnswer> {
  const init: RequestInit = { method, credentials: "same-origin", cache: "no-store" };
  const headers: Record<string, string> = { [SERVER_SETUP_HEADER]: "1" };
  if (fields) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    init.body = new URLSearchParams(fields).toString();
  }
  init.headers = headers;
  try {
    const response = await fetch(path, init);
    return { ok: response.ok, values: answerValues(await response.json()) };
  } catch {
    return { ok: false, values: { error: NO_ANSWER } };
  }
}

/** Only the string and number values of an answer. */
function answerValues(value: unknown): Record<string, string | number> {
  const values: Record<string, string | number> = {};
  if (!isDynamicRecord(value)) return values;
  for (const [key, item] of Object.entries(value)) {
    if (isString(item) || isNumber(item)) values[key] = item;
  }
  return values;
}
