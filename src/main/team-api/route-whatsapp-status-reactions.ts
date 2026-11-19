import {
  WHATSAPP_STATUS_REACTIONS_CAPABILITY,
  WHATSAPP_STATUS_REACTIONS_ROUTES,
} from "@openbot/contracts/team-protocol/whatsapp-status-reactions-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import { parseSetWhatsAppStatusReactionsInput } from "../ipc/messaging-inputs";
import type { TeamApiConnectors } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

const ROUTES: ReadonlySet<string> = new Set(Object.values(WHATSAPP_STATUS_REACTIONS_ROUTES));

export async function routeWhatsAppStatusReactions(
  context: TeamApiRequestContext,
  connectors: TeamApiConnectors | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || !ROUTES.has(url.pathname)) return "unmatched";
  if (!connectors || !capabilities.has(WHATSAPP_STATUS_REACTIONS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.connectorsUnsupported"));
  requireAdmin(member);
  const body = await readJson(request);
  const { messaging } = connectors;
  if (url.pathname === WHATSAPP_STATUS_REACTIONS_ROUTES.list)
    return json(200, {
      numbers: messaging.whatsappOverview().accounts.map((account) => ({
        workspaceId: account.workspaceId,
        statusReactions: account.statusReactions !== false,
      })),
    });
  let input: ReturnType<typeof parseSetWhatsAppStatusReactionsInput>;
  try {
    input = parseSetWhatsAppStatusReactionsInput(body);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "A WhatsApp request is invalid.");
  }
  await runCauseEffect(messaging.setWhatsAppStatusReactions(input.workspaceId, input.statusReactions));
  return json(200, {});
}
