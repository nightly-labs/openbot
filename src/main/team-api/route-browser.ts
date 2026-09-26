// The embedded browser, driven from a remote client: its tabs, and who is holding the wheel.
//
// Every handler forwards straight to `BrowserHost`. The validation here is only about the wire -
// a URL that is too long, a `focus` that is not a boolean - because whether a tab may be opened at
// all is the browser host's decision, made the same way for a local caller.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { isBoolean } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { sourceText } from "@openbot/i18n/source";
import type { TeamApiBrowser, TeamApiBrowserView } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { nullableString, parseBrowserBounds, pathIdentifier, readJson, stringField } from "./request-helpers";

export interface BrowserRouteDependencies {
  browser: TeamApiBrowser;
  browserView?: TeamApiBrowserView;
}

export async function routeBrowser(
  context: TeamApiRequestContext,
  { browser, browserView }: BrowserRouteDependencies,
): Promise<RouteOutcome> {
  const { method, url, request, member, sessionId, json, empty } = context;

  if (method === "GET" && url.pathname === TEAM_API_ROUTES.browser.tabs) {
    return json(200, browser.listTabs());
  }
  // Behind `browser-navigation`. A client without it reads the tab list and has to guess which tab
  // is active until the first `browser-changed` event arrives.
  if (method === "GET" && url.pathname === TEAM_API_ROUTES.browser.display) {
    return json(200, browser.getDisplayState());
  }
  if (method === "GET" && url.pathname === TEAM_API_ROUTES.browser.control) {
    return json(200, browser.getControlState());
  }
  if (method === "POST" && url.pathname === TEAM_API_ROUTES.browser.open) {
    const body = await readJson(request);
    const focus = body.focus ?? false;
    if (!isBoolean(focus)) throw new HttpError(400, "focus must be a boolean.");
    return json(
      201,
      await browser.open(
        stringField(body, "url", false, INPUT_LIMITS.browserUrl),
        nullableString(body, "ownerThreadId"),
        nullableString(body, "ownerAgentId"),
        focus,
      ),
    );
  }
  if (method === "POST" && url.pathname === TEAM_API_ROUTES.browser.activate) {
    const body = await readJson(request);
    await browser.activate(stringField(body, "tabId"));
    return empty(204);
  }
  if (method === "POST" && url.pathname === TEAM_API_ROUTES.browser.navigate) {
    const body = await readJson(request);
    const direction = stringField(body, "direction");
    if (direction !== "back" && direction !== "forward") {
      throw new HttpError(400, "Invalid browser navigation direction.");
    }
    await browser.navigate(stringField(body, "tabId"), direction);
    return empty(204);
  }
  // Behind `browser-navigation`: the released navigate route carries a direction only, so a client
  // without it opens a new tab for an address instead of moving the one the user is looking at.
  if (method === "POST" && url.pathname === TEAM_API_ROUTES.browser.load) {
    const body = await readJson(request);
    await browser.loadUrl(stringField(body, "tabId"), stringField(body, "url", false, INPUT_LIMITS.browserUrl));
    return empty(204);
  }
  if (method === "POST" && url.pathname === TEAM_API_ROUTES.browser.reload) {
    const body = await readJson(request);
    await browser.reload(stringField(body, "tabId"));
    return empty(204);
  }
  if (method === "POST" && url.pathname === TEAM_API_ROUTES.browser.close) {
    const body = await readJson(request);
    await browser.close(stringField(body, "tabId"));
    return empty(204);
  }
  if (method === "POST" && url.pathname === TEAM_API_ROUTES.browser.preview) {
    const body = await readJson(request);
    return json(200, await browser.capturePreview(stringField(body, "tabId")));
  }
  if (method === "POST" && url.pathname === TEAM_API_ROUTES.browser.visible) {
    const body = await readJson(request);
    if (!isBoolean(body.visible)) throw new HttpError(400, "visible is required.");
    await browser.setVisible({
      visible: body.visible,
      bounds: body.bounds === undefined ? undefined : parseBrowserBounds(body.bounds),
    });
    return empty(204);
  }

  // Behind `browser-view`. The session is only the agreement about which tab and who is watching;
  // the frames and the input are on the socket it answers with, which `browser-view-gateway.ts`
  // serves. A host with the view switched off answers 404, the same as a host too old to know it.
  if (method === "POST" && url.pathname === TEAM_API_ROUTES.browser.viewSessions) {
    if (!browserView) throw new HttpError(404, sourceText("error.team.browserViewUnavailable"));
    const body = await readJson(request);
    return json(
      201,
      browserView.createSession({
        memberId: member.id,
        teamSessionId: sessionId,
        tabId: stringField(body, "tabId"),
      }),
    );
  }
  const viewSessionMatch = /^\/v1\/browser\/view\/sessions\/([^/]+)$/u.exec(url.pathname);
  if (method === "DELETE" && viewSessionMatch) {
    if (!browserView) throw new HttpError(404, sourceText("error.team.browserViewUnavailable"));
    if (!(await browserView.closeMemberSession(pathIdentifier(viewSessionMatch[1], "sessionId"), member.id))) {
      throw new HttpError(404, sourceText("error.team.browserSessionNotFound"));
    }
    return empty(204);
  }

  return "unmatched";
}
