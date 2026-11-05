import {
  WHATSAPP_CONNECTOR_CAPABILITY,
  WHATSAPP_CONNECTOR_ROUTES,
} from "@openbot/contracts/team-protocol/whatsapp-connector-v1";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { runCauseEffect } from "../../backend/effect-boundary";
import {
  parseAnswerWhatsAppRequestInput,
  parseMessagingWorkspaceInput,
  parseRemoveWhatsAppSenderInput,
  parseSetMessagingEnabledInput,
  parseSetWhatsAppOwnNumberInput,
  parseStartWhatsAppLinkInput,
  parseWhatsAppSenderInput,
} from "../ipc/messaging-inputs";
import type { TeamApiConnectors } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

const ROUTES: ReadonlySet<string> = new Set(Object.values(WHATSAPP_CONNECTOR_ROUTES));

/** The codec checked the shape; the IPC parser checks the values, such as a phone number. */
function parse<T>(parser: (value: unknown) => T, body: unknown): T {
  try {
    return parser(body);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "A WhatsApp request is invalid.");
  }
}

/**
 * The WhatsApp numbers of this host, which an administrator links and manages from their own
 * computer. Frozen by `whatsapp-connector-v1`. This host's session gets the QR code or the pairing
 * code and answers it; the client shows it. No answer carries a stored key. `requireAdmin` runs on
 * every route.
 */
export async function routeWhatsAppConnector(
  context: TeamApiRequestContext,
  connectors: TeamApiConnectors | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || !ROUTES.has(url.pathname)) return "unmatched";
  if (!connectors || !capabilities.has(WHATSAPP_CONNECTOR_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.connectorsUnsupported"));
  requireAdmin(member);
  // `readJson` has already run the body through the `whatsapp-connector-v1` codec.
  const body = await readJson(request);
  const { messaging } = connectors;
  switch (url.pathname) {
    case WHATSAPP_CONNECTOR_ROUTES.overview:
      return json(200, messaging.whatsappOverview());
    case WHATSAPP_CONNECTOR_ROUTES.linkStart:
      return json(200, await runCauseEffect(messaging.startWhatsAppLink(parse(parseStartWhatsAppLinkInput, body))));
    case WHATSAPP_CONNECTOR_ROUTES.linkState:
      return json(200, messaging.whatsappLinkState());
    case WHATSAPP_CONNECTOR_ROUTES.linkCancel:
      await runCauseEffect(messaging.cancelWhatsAppLink());
      return json(200, {});
    case WHATSAPP_CONNECTOR_ROUTES.disconnect: {
      const { workspaceId } = parse(parseMessagingWorkspaceInput, body);
      await runCauseEffect(messaging.disconnectWhatsAppNumber(workspaceId));
      return json(200, {});
    }
    case WHATSAPP_CONNECTOR_ROUTES.reconnect: {
      const { workspaceId } = parse(parseMessagingWorkspaceInput, body);
      // A WhatsApp number opens no page: it starts its session again.
      await runCauseEffect(Effect.asVoid(messaging.reconnect("whatsapp", workspaceId, false)));
      return json(200, {});
    }
    case WHATSAPP_CONNECTOR_ROUTES.enabled: {
      const { workspaceId, enabled } = parse(parseSetMessagingEnabledInput, body);
      await runCauseEffect(messaging.setEnabled("whatsapp", workspaceId, enabled));
      return json(200, {});
    }
    case WHATSAPP_CONNECTOR_ROUTES.orchestrator:
      // The orchestrator starts on a new agent's default provider and model, as the host picks it.
      return json(200, await runCauseEffect(messaging.addWhatsAppOrchestrator({})));
    case WHATSAPP_CONNECTOR_ROUTES.groups: {
      const { workspaceId } = parse(parseMessagingWorkspaceInput, body);
      return json(200, await runCauseEffect(messaging.listWhatsAppGroups(workspaceId)));
    }
    case WHATSAPP_CONNECTOR_ROUTES.senderAdd: {
      const { workspaceId, sender } = parse(parseWhatsAppSenderInput, body);
      await runCauseEffect(messaging.addWhatsAppSender(workspaceId, sender));
      return json(200, {});
    }
    case WHATSAPP_CONNECTOR_ROUTES.senderRemove: {
      const { workspaceId, senderId } = parse(parseRemoveWhatsAppSenderInput, body);
      await runCauseEffect(messaging.removeWhatsAppSender(workspaceId, senderId));
      return json(200, {});
    }
    case WHATSAPP_CONNECTOR_ROUTES.requestAnswer: {
      const { workspaceId, code, approve } = parse(parseAnswerWhatsAppRequestInput, body);
      await runCauseEffect(messaging.answerWhatsAppRequest(workspaceId, code, approve));
      return json(200, {});
    }
    default: {
      const { workspaceId, ownNumber } = parse(parseSetWhatsAppOwnNumberInput, body);
      await runCauseEffect(messaging.setWhatsAppOwnNumber(workspaceId, ownNumber));
      return json(200, {});
    }
  }
}
