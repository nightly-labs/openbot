import {
  isPasswordManagerId,
  type PasswordManagerConnectMethod,
  type PasswordManagerStatus,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import {
  PASSWORD_MANAGERS_CAPABILITY,
  PASSWORD_MANAGERS_KEY_LIMIT,
  PASSWORD_MANAGERS_LIMIT,
  PASSWORD_MANAGERS_PASSWORD_LIMIT,
  PASSWORD_MANAGERS_ROUTES,
  PASSWORD_MANAGERS_URL_LIMIT,
  PASSWORD_MANAGERS_VAULT_LIMIT,
  PASSWORD_MANAGERS_VAULT_NAME_LIMIT,
} from "@openbot/contracts/team-protocol/password-managers-v1";
import { sourceText } from "@openbot/i18n/source";
import { registerSecretValue } from "@openbot/logging";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiPasswordManagers } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin, stringField } from "./request-helpers";

const ROUTES: ReadonlySet<string> = new Set(Object.values(PASSWORD_MANAGERS_ROUTES));
const ERROR_LIMIT = 2_000;

/** The wire status of `password-managers-v1`, cut to the codec's bounds. A longer sign-in page is left out. */
function wireStatus(status: PasswordManagerStatus): PasswordManagerStatus {
  return {
    ...status,
    signInUrl: status.signInUrl && status.signInUrl.length <= PASSWORD_MANAGERS_URL_LIMIT ? status.signInUrl : null,
    vaultNames: status.vaultNames
      .slice(0, PASSWORD_MANAGERS_VAULT_LIMIT)
      .map((name) => name.slice(0, PASSWORD_MANAGERS_VAULT_NAME_LIMIT)),
    error: status.error?.slice(0, ERROR_LIMIT) ?? null,
  };
}

function connectMethod(body: DynamicRecord): PasswordManagerConnectMethod {
  const value = body.method;
  if (!isDynamicRecord(value)) throw new HttpError(400, "method is required.");
  const kind = stringField(value, "kind", false, 64);
  if (kind === "browser") return { kind };
  if (kind === "key") {
    const key = stringField(value, "key", false, PASSWORD_MANAGERS_KEY_LIMIT);
    registerSecretValue(key);
    return { kind, key };
  }
  if (kind === "extra-password") {
    const password = stringField(value, "password", false, PASSWORD_MANAGERS_PASSWORD_LIMIT);
    registerSecretValue(password, { allowShort: true });
    return { kind, password };
  }
  throw new HttpError(400, sourceText("error.connector.passwordManagerMethod"));
}

/**
 * The password managers of this host, which an owner or administrator connects from their own
 * computer or phone. Frozen by `password-managers-v1`.
 *
 * An access key or an extra password arrives once, in the connect body; no answer carries it.
 * `requireAdmin` runs on every route.
 */
export async function routePasswordManagers(
  context: TeamApiRequestContext,
  managers: TeamApiPasswordManagers | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || !ROUTES.has(url.pathname)) return "unmatched";
  if (!managers || !capabilities.has(PASSWORD_MANAGERS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.connectorsUnsupported"));
  requireAdmin(member);
  // `readJson` has already run the body through the `password-managers-v1` codec.
  const body = await readJson(request);
  if (url.pathname === PASSWORD_MANAGERS_ROUTES.list) {
    return json(200, { managers: managers.list().slice(0, PASSWORD_MANAGERS_LIMIT).map(wireStatus) });
  }
  const manager = stringField(body, "manager", false, 64);
  if (!isPasswordManagerId(manager)) throw new HttpError(400, sourceText("error.connector.passwordManagerUnknown"));
  switch (url.pathname) {
    case PASSWORD_MANAGERS_ROUTES.connect: {
      const input = { manager, method: connectMethod(body) };
      const refused = managers.refusal(input.manager, input.method);
      if (refused) throw new HttpError(400, refused);
      return json(200, wireStatus(await runCauseEffect(managers.connect(input))));
    }
    case PASSWORD_MANAGERS_ROUTES.cancel:
      return json(200, wireStatus(await runCauseEffect(managers.cancel(manager))));
    default:
      return json(200, wireStatus(await runCauseEffect(managers.disconnect(manager))));
  }
}
