import { TELEGRAM_ACCOUNT_API_HASH_PATTERN, type TelegramAccountConnectorStatus } from "@openbot/contracts/ipc";
import { isNumber } from "@openbot/contracts/runtime-values";
import {
  TELEGRAM_ACCOUNT_CONNECTOR_API_HASH_LIMIT,
  TELEGRAM_ACCOUNT_CONNECTOR_CAPABILITY,
  TELEGRAM_ACCOUNT_CONNECTOR_ROUTES,
  TELEGRAM_ACCOUNT_CONNECTOR_VALUE_LIMIT,
} from "@openbot/contracts/team-protocol/telegram-account-connector-v1";
import { sourceText } from "@openbot/i18n/source";
import { registerSecretValue } from "@openbot/logging";
import { runCauseEffect } from "../../backend/effect-boundary";
import { registerSubmittedValue } from "../telegram-account-effects";
import type { TeamApiTelegramAccountConnector } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { nullableString, readJson, requireAdmin, stringField } from "./request-helpers";

const ROUTES: ReadonlySet<string> = new Set(Object.values(TELEGRAM_ACCOUNT_CONNECTOR_ROUTES));
const ERROR_LIMIT = 2_000;

/** The wire status of `telegram-account-connector-v1`. Text is cut to the codec's bounds. */
function wireStatus(status: TelegramAccountConnectorStatus) {
  return {
    state: status.state,
    method: status.method,
    qrUrl: status.qrUrl && status.qrUrl.length <= 512 ? status.qrUrl : null,
    qrExpiresAt: status.qrExpiresAt === null ? null : Math.max(0, Math.round(status.qrExpiresAt)),
    codeViaApp: status.codeViaApp,
    passwordHint: status.passwordHint?.slice(0, 256) ?? null,
    account: status.account
      ? {
          name: status.account.name.slice(0, 256),
          username: status.account.username?.slice(0, 64) ?? null,
          phone: status.account.phone?.slice(0, 32) ?? null,
        }
      : null,
    sendingEnabled: status.sendingEnabled,
    error: status.error?.slice(0, ERROR_LIMIT) ?? null,
  };
}

function signInField(value: unknown): "phone" | "code" | "password" {
  if (value === "phone" || value === "code" || value === "password") return value;
  throw new HttpError(400, "field is required.");
}

/**
 * The Telegram account connection of this host, which an owner or administrator signs in from their
 * own computer. Frozen by `telegram-account-connector-v1`.
 *
 * The API credentials arrive in the connect body, and the phone number, the code and the two-step
 * password in the submit body, one each; no answer carries them. Each one is registered for
 * redaction before anything else reads it. `requireAdmin` runs on every route.
 */
export async function routeTelegramAccountConnector(
  context: TeamApiRequestContext,
  connector: TeamApiTelegramAccountConnector | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || !ROUTES.has(url.pathname)) return "unmatched";
  if (!connector || !capabilities.has(TELEGRAM_ACCOUNT_CONNECTOR_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.connectorsUnsupported"));
  requireAdmin(member);
  // `readJson` has already run the body through the `telegram-account-connector-v1` codec.
  const body = await readJson(request);
  switch (url.pathname) {
    case TELEGRAM_ACCOUNT_CONNECTOR_ROUTES.connect: {
      const apiHash = nullableString(body, "apiHash", TELEGRAM_ACCOUNT_CONNECTOR_API_HASH_LIMIT);
      if (apiHash && TELEGRAM_ACCOUNT_API_HASH_PATTERN.test(apiHash)) registerSecretValue(apiHash);
      const signInMethod = body.method === "phone" ? "phone" : "qr";
      const apiId = isNumber(body.apiId) ? body.apiId : null;
      return json(200, wireStatus(await runCauseEffect(connector.connect({ method: signInMethod, apiId, apiHash }))));
    }
    case TELEGRAM_ACCOUNT_CONNECTOR_ROUTES.submit: {
      const field = signInField(body.field);
      const value = stringField(body, "value", true, TELEGRAM_ACCOUNT_CONNECTOR_VALUE_LIMIT);
      registerSubmittedValue({ field, value });
      return json(200, wireStatus(connector.submit({ field, value })));
    }
    case TELEGRAM_ACCOUNT_CONNECTOR_ROUTES.cancel:
      return json(200, wireStatus(await runCauseEffect(connector.cancel())));
    case TELEGRAM_ACCOUNT_CONNECTOR_ROUTES.disconnect:
      return json(200, wireStatus(await runCauseEffect(connector.disconnect())));
    case TELEGRAM_ACCOUNT_CONNECTOR_ROUTES.setSending:
      return json(200, wireStatus(await runCauseEffect(connector.setSending(body.enabled === true))));
    default:
      return json(200, wireStatus(connector.status()));
  }
}
