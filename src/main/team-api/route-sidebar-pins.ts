import { parseSetSidebarPinsInput } from "@openbot/contracts/ipc";
import { SIDEBAR_PINS_CAPABILITY, SIDEBAR_PINS_ROUTES } from "@openbot/contracts/team-protocol/sidebar-pins-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiSidebarPins } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson } from "./request-helpers";

/**
 * Each member reads and saves, for themselves only, the chats that they pinned. The pins of an agent that
 * this peer cannot see are not in the list, and a save keeps them.
 */
export async function routeSidebarPins(
  context: TeamApiRequestContext,
  pins: TeamApiSidebarPins | undefined,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json, member } = context;
  if (method !== "POST" || !Object.values(SIDEBAR_PINS_ROUTES).some((path) => path === url.pathname))
    return "unmatched";
  if (!pins || !capabilities.has(SIDEBAR_PINS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.sidebarPinsUnsupported"));
  const body = await readJson(request);
  if (url.pathname === SIDEBAR_PINS_ROUTES.read) return json(200, pins.snapshot(member.id, hiddenAgentIds));
  const items = parsedPins(body);
  // A pin of an agent that this peer cannot see is not this peer's to save.
  const visible = items.filter((pin) => !(pin.kind === "agent" && hiddenAgentIds.has(pin.id)));
  const saved =
    url.pathname === SIDEBAR_PINS_ROUTES.seed
      ? pins.seed(member.id, visible, hiddenAgentIds)
      : pins.set(member.id, visible, hiddenAgentIds);
  return json(200, await runCauseEffect(saved));
}

/** The wire codec checks each pin; a list that holds one pin twice is also not a list to save. */
function parsedPins(body: unknown) {
  try {
    return parseSetSidebarPinsInput(body).items;
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Invalid pinned chats request.");
  }
}
