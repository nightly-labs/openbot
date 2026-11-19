import {
  PROVIDER_SIGN_OUT_CAPABILITY,
  PROVIDER_SIGN_OUT_ROUTES,
} from "@openbot/contracts/team-protocol/provider-sign-out-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import { parseProviderId } from "../ipc/app-inputs";
import type { TeamApiProviderSignOut } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

export async function routeProviderSignOut(
  context: TeamApiRequestContext,
  signOut: TeamApiProviderSignOut | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || url.pathname !== PROVIDER_SIGN_OUT_ROUTES.signOut) return "unmatched";
  if (!signOut || !capabilities.has(PROVIDER_SIGN_OUT_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.providersUnsupported"));
  requireAdmin(member);
  const body = await readJson(request);
  await runCauseEffect(signOut.signOutProvider(parseProviderId(body.provider)));
  return json(200, {});
}
