import {
  PROVIDER_HOST_SIGN_IN_CAPABILITY,
  PROVIDER_HOST_SIGN_IN_ROUTES,
} from "@openbot/contracts/team-protocol/provider-host-sign-in-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import { parseProviderId } from "../ipc/app-inputs";
import type { TeamApiProviderHostSignIns } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

const ROUTES: ReadonlySet<string> = new Set(Object.values(PROVIDER_HOST_SIGN_IN_ROUTES));

export async function routeProviderHostSignIn(
  context: TeamApiRequestContext,
  signIns: TeamApiProviderHostSignIns | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || !ROUTES.has(url.pathname)) return "unmatched";
  if (!signIns || !capabilities.has(PROVIDER_HOST_SIGN_IN_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.providersUnsupported"));
  requireAdmin(member);
  const provider = parseProviderId((await readJson(request)).provider);
  switch (url.pathname) {
    case PROVIDER_HOST_SIGN_IN_ROUTES.start:
      await runCauseEffect(signIns.start(provider));
      return json(200, {});
    case PROVIDER_HOST_SIGN_IN_ROUTES.status:
      return json(200, signIns.status(provider));
    default:
      await runCauseEffect(signIns.cancel(provider));
      return json(200, {});
  }
}
