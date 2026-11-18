import {
  parseDeleteBrowserProxyInput,
  parseSaveBrowserProxyInput,
  parseSetBrowserProfileProxyInput,
} from "@openbot/contracts/ipc";
import {
  BROWSER_PROXIES_CAPABILITY,
  BROWSER_PROXIES_ROUTES,
} from "@openbot/contracts/team-protocol/browser-proxies-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import { BrowserProfileRejectedError } from "../browser-profile-service";
import type { TeamApiBrowserProfiles } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

const ROUTES = new Set<string>(Object.values(BROWSER_PROXIES_ROUTES));

/**
 * The saved proxies of this computer's named browser profiles, changed from a joined server. A proxy
 * can hold a sign-in, so only an owner or admin can use these routes. The password goes in only; no
 * answer holds it. An admin can add only the computer of their own membership: the request member,
 * never an id from the body. Frozen by `browser-proxies-v1`.
 */
export async function routeBrowserProxies(
  context: TeamApiRequestContext,
  profiles: TeamApiBrowserProfiles | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || !ROUTES.has(url.pathname)) return "unmatched";
  if (!profiles || !capabilities.has(BROWSER_PROXIES_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.agentSettingsUnsupported"));
  requireAdmin(member);
  // `readJson` has already run the body through the browser-proxies wire codec.
  const body = await readJson(request);
  try {
    switch (url.pathname) {
      case BROWSER_PROXIES_ROUTES.list:
        return json(200, profiles.listProxies(member.id));
      case BROWSER_PROXIES_ROUTES.computer:
        return json(200, await runCauseEffect(profiles.saveOwnComputer(member.id)));
      case BROWSER_PROXIES_ROUTES.save:
        return json(200, await runCauseEffect(profiles.saveProxy(parse(() => parseSaveBrowserProxyInput(body)))));
      case BROWSER_PROXIES_ROUTES.delete:
        await runCauseEffect(profiles.deleteProxy(parse(() => parseDeleteBrowserProxyInput(body))));
        return json(200, {});
      default:
        await runCauseEffect(profiles.setProfileProxy(parse(() => parseSetBrowserProfileProxyInput(body))));
        return json(200, {});
    }
  } catch (error) {
    // A refused address, a missing proxy or profile, and the limit are catalog text for the admin.
    // Any other failure stays private: the server answers it with its generic error.
    if (error instanceof BrowserProfileRejectedError) throw new HttpError(409, error.message);
    throw error;
  }
}

function parse<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Invalid browser proxy request.");
  }
}
