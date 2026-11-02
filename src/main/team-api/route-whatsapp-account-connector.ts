import type { WhatsAppAccountConnectorStatus } from "@openbot/contracts/ipc";
import {
  WHATSAPP_ACCOUNT_CONNECTOR_CAPABILITY,
  WHATSAPP_ACCOUNT_CONNECTOR_ROUTES,
  WHATSAPP_ACCOUNT_CONNECTOR_VALUE_LIMIT,
} from "@openbot/contracts/team-protocol/whatsapp-account-connector-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import { phoneDigits, registerPhoneNumber } from "../whatsapp-account-effects";
import type { TeamApiWhatsAppAccountConnector } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin, stringField } from "./request-helpers";

const ROUTES: ReadonlySet<string> = new Set(Object.values(WHATSAPP_ACCOUNT_CONNECTOR_ROUTES));
const ERROR_LIMIT = 2_000;

/** The wire status of `whatsapp-account-connector-v1`. Text is cut to the codec's bounds. */
function wireStatus(status: WhatsAppAccountConnectorStatus) {
  return {
    state: status.state,
    method: status.method,
    qrCode: status.qrCode && status.qrCode.length <= 1_024 ? status.qrCode : null,
    qrExpiresAt: status.qrExpiresAt === null ? null : Math.max(0, Math.round(status.qrExpiresAt)),
    pairingCode: status.pairingCode?.slice(0, 16) ?? null,
    account: status.account
      ? { name: status.account.name.slice(0, 256), phone: status.account.phone?.slice(0, 32) ?? null }
      : null,
    history: status.history
      ? {
          chats: Math.max(0, Math.round(status.history.chats)),
          messages: Math.max(0, Math.round(status.history.messages)),
        }
      : null,
    sendingEnabled: status.sendingEnabled,
    error: status.error?.slice(0, ERROR_LIMIT) ?? null,
  };
}

/**
 * The WhatsApp account connection of this host, which an owner or administrator links from their own
 * computer. Frozen by `whatsapp-account-connector-v1`.
 *
 * The phone number of a link with a code arrives in the submit body; no answer carries it. It is
 * registered for redaction before anything else reads it. `requireAdmin` runs on every route.
 */
export async function routeWhatsAppAccountConnector(
  context: TeamApiRequestContext,
  connector: TeamApiWhatsAppAccountConnector | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || !ROUTES.has(url.pathname)) return "unmatched";
  if (!connector || !capabilities.has(WHATSAPP_ACCOUNT_CONNECTOR_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.connectorsUnsupported"));
  requireAdmin(member);
  // `readJson` has already run the body through the `whatsapp-account-connector-v1` codec.
  const body = await readJson(request);
  switch (url.pathname) {
    case WHATSAPP_ACCOUNT_CONNECTOR_ROUTES.connect:
      return json(
        200,
        wireStatus(await runCauseEffect(connector.connect({ method: body.method === "phone" ? "phone" : "qr" }))),
      );
    case WHATSAPP_ACCOUNT_CONNECTOR_ROUTES.submit: {
      if (body.field !== "phone") throw new HttpError(400, "field is required.");
      const value = stringField(body, "value", true, WHATSAPP_ACCOUNT_CONNECTOR_VALUE_LIMIT);
      const digits = phoneDigits(value);
      if (digits) registerPhoneNumber(digits);
      return json(200, wireStatus(await runCauseEffect(connector.submit({ field: "phone", value }))));
    }
    case WHATSAPP_ACCOUNT_CONNECTOR_ROUTES.cancel:
      return json(200, wireStatus(connector.cancel()));
    case WHATSAPP_ACCOUNT_CONNECTOR_ROUTES.disconnect:
      return json(200, wireStatus(await runCauseEffect(connector.disconnect())));
    case WHATSAPP_ACCOUNT_CONNECTOR_ROUTES.setSending:
      return json(200, wireStatus(await runCauseEffect(connector.setSending(body.enabled === true))));
    default:
      return json(200, wireStatus(connector.status()));
  }
}
