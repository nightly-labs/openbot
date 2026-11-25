import {
  WHATSAPP_READ_ONLY_CAPABILITY,
  WHATSAPP_READ_ONLY_ROUTES,
} from "@openbot/contracts/team-protocol/whatsapp-read-only-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import { parseSetWhatsAppSenderReadOnlyInput } from "../ipc/messaging-inputs";
import type { TeamApiConnectors } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

const ROUTES: ReadonlySet<string> = new Set(Object.values(WHATSAPP_READ_ONLY_ROUTES));

export async function routeWhatsAppReadOnly(
  context: TeamApiRequestContext,
  connectors: TeamApiConnectors | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || !ROUTES.has(url.pathname)) return "unmatched";
  if (!connectors || !capabilities.has(WHATSAPP_READ_ONLY_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.connectorsUnsupported"));
  requireAdmin(member);
  const body = await readJson(request);
  const { messaging } = connectors;
  if (url.pathname === WHATSAPP_READ_ONLY_ROUTES.list)
    return json(200, {
      numbers: messaging.whatsappOverview().accounts.map((account) => ({
        workspaceId: account.workspaceId,
        readOnly: account.allowedSenders.filter((sender) => sender.readOnly === true).map((sender) => sender.id),
      })),
    });
  let input: ReturnType<typeof parseSetWhatsAppSenderReadOnlyInput>;
  try {
    input = parseSetWhatsAppSenderReadOnlyInput(body);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "A WhatsApp request is invalid.");
  }
  await runCauseEffect(messaging.setWhatsAppSenderReadOnly(input.workspaceId, input.senderId, input.readOnly));
  return json(200, {});
}
