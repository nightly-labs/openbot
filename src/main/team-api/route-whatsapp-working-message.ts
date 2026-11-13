import {
  WHATSAPP_WORKING_MESSAGE_CAPABILITY,
  WHATSAPP_WORKING_MESSAGE_ROUTES,
} from "@openbot/contracts/team-protocol/whatsapp-working-message-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import { parseSetWhatsAppWorkingMessageInput } from "../ipc/messaging-inputs";
import type { TeamApiConnectors } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

const ROUTES: ReadonlySet<string> = new Set(Object.values(WHATSAPP_WORKING_MESSAGE_ROUTES));

/**
 * Whether this host posts "Waiting" and "Working on it…" in a WhatsApp chat while a request runs,
 * for each number that it linked. Frozen by `whatsapp-working-message-v1`. `requireAdmin` runs on
 * both routes.
 */
export async function routeWhatsAppWorkingMessage(
  context: TeamApiRequestContext,
  connectors: TeamApiConnectors | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || !ROUTES.has(url.pathname)) return "unmatched";
  if (!connectors || !capabilities.has(WHATSAPP_WORKING_MESSAGE_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.connectorsUnsupported"));
  requireAdmin(member);
  // `readJson` has already run the body through the `whatsapp-working-message-v1` codec.
  const body = await readJson(request);
  const { messaging } = connectors;
  if (url.pathname === WHATSAPP_WORKING_MESSAGE_ROUTES.list)
    return json(200, {
      numbers: messaging.whatsappOverview().accounts.map((account) => ({
        workspaceId: account.workspaceId,
        workingMessage: account.workingMessage !== false,
      })),
    });
  let input: ReturnType<typeof parseSetWhatsAppWorkingMessageInput>;
  try {
    input = parseSetWhatsAppWorkingMessageInput(body);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "A WhatsApp request is invalid.");
  }
  await runCauseEffect(messaging.setWhatsAppWorkingMessage(input.workspaceId, input.workingMessage));
  return json(200, {});
}
