import { canAdministerServer } from "@openbot/contracts/ipc";
// The embedded browser, driven from a remote client: its tabs, and who is holding the wheel.
//
// Every handler forwards straight to `BrowserHost`. The validation here is only about the wire -
// a URL that is too long, a `focus` that is not a boolean - because whether a tab may be opened at
// all is the browser host's decision, made the same way for a local caller.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { type DynamicRecord, isBoolean } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  BROWSER_PAGE_STATE_CAPABILITY,
  BROWSER_PAGE_STATE_ROUTES,
} from "@openbot/contracts/team-protocol/browser-page-state-v1";
import {
  BROWSER_SIGN_IN_CAPABILITY,
  BROWSER_SIGN_IN_ROUTES,
  decodeBrowserSignInImport,
} from "@openbot/contracts/team-protocol/browser-sign-in-v1";
import {
  BROWSER_USER_CONTROL_CAPABILITY,
  BROWSER_USER_CONTROL_ROUTES,
} from "@openbot/contracts/team-protocol/browser-user-control-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiBrowser, TeamApiBrowserView } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { nullableString, parseBrowserBounds, pathIdentifier, readJson, stringField } from "./request-helpers";

export interface BrowserRouteDependencies {
  browser: TeamApiBrowser;
  browserView?: TeamApiBrowserView | undefined;
}

export async function routeBrowser(
  context: TeamApiRequestContext,
  { browser, browserView }: BrowserRouteDependencies,
): Promise<RouteOutcome> {
  const { method, url, request, member, sessionId, capabilities, json, empty } = context;
  // A private tab holds an administrator's MCP sign-in (`mcp-sign-in-v1`). A member could watch the
  // password, or finish the sign-in with their own account, so to a member that tab does not exist.
  const hidden = (tabId: string) => !canAdministerServer(member.role) && browser.isPrivate(tabId);
  const tabId = (body: DynamicRecord) => {
    const id = stringField(body, "tabId");
    if (hidden(id)) throw new HttpError(404, sourceText("error.backend.browserTabNotFound"));
    return id;
  };

  if (method === "GET" && url.pathname === TEAM_API_ROUTES.browser.tabs) {
    return json(
      200,
      browser.listTabs().filter((tab) => !hidden(tab.id)),
    );
  }
  // Behind `browser-navigation`. A client without it reads the tab list and has to guess which tab
  // is active until the first `browser-changed` event arrives.
  if (method === "GET" && url.pathname === TEAM_API_ROUTES.browser.display) {
    const display = browser.getDisplayState();
    const tabs = display.tabs.filter((tab) => !hidden(tab.id));
    const activeTabId = tabs.some((tab) => tab.id === display.activeTabId) ? display.activeTabId : null;
    return json(200, { tabs, activeTabId });
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
      await runCauseEffect(
        browser.open(
          stringField(body, "url", false, INPUT_LIMITS.browserUrl),
          nullableString(body, "ownerThreadId"),
          nullableString(body, "ownerAgentId"),
          focus,
        ),
      ),
    );
  }
  if (method === "POST" && url.pathname === TEAM_API_ROUTES.browser.activate) {
    const body = await readJson(request);
    await runCauseEffect(browser.activate(tabId(body)));
    return empty(204);
  }
  if (method === "POST" && url.pathname === TEAM_API_ROUTES.browser.navigate) {
    const body = await readJson(request);
    const direction = stringField(body, "direction");
    if (direction !== "back" && direction !== "forward") {
      throw new HttpError(400, "Invalid browser navigation direction.");
    }
    await runCauseEffect(browser.navigate(tabId(body), direction));
    return empty(204);
  }
  // Behind `browser-navigation`: the released navigate route carries a direction only, so a client
  // without it opens a new tab for an address instead of moving the one the user is looking at.
  if (method === "POST" && url.pathname === TEAM_API_ROUTES.browser.load) {
    const body = await readJson(request);
    await runCauseEffect(browser.loadUrl(tabId(body), stringField(body, "url", false, INPUT_LIMITS.browserUrl)));
    return empty(204);
  }
  if (method === "POST" && url.pathname === TEAM_API_ROUTES.browser.reload) {
    const body = await readJson(request);
    await runCauseEffect(browser.reload(tabId(body)));
    return empty(204);
  }
  if (method === "POST" && url.pathname === TEAM_API_ROUTES.browser.close) {
    const body = await readJson(request);
    await runCauseEffect(browser.close(tabId(body)));
    return empty(204);
  }
  if (method === "POST" && url.pathname === TEAM_API_ROUTES.browser.preview) {
    const body = await readJson(request);
    return json(200, await runCauseEffect(browser.capturePreview(tabId(body))));
  }
  if (method === "POST" && url.pathname === TEAM_API_ROUTES.browser.visible) {
    const body = await readJson(request);
    if (!isBoolean(body.visible)) throw new HttpError(400, "visible is required.");
    await runCauseEffect(
      browser.setVisible({
        visible: body.visible,
        ...(body.bounds === undefined ? {} : { bounds: parseBrowserBounds(body.bounds) }),
      }),
    );
    return empty(204);
  }

  // Behind `browser-user-control`. Any member who can see a tab takes or releases it; the answer is
  // the whole list of held tabs that this member can see, as the event sends it.
  if (method === "POST" && Object.values(BROWSER_USER_CONTROL_ROUTES).some((path) => path === url.pathname)) {
    if (!capabilities.has(BROWSER_USER_CONTROL_CAPABILITY))
      throw new HttpError(400, sourceText("error.backend.browserUserControlUnsupported"));
    const body = await readJson(request);
    if (url.pathname === BROWSER_USER_CONTROL_ROUTES.take)
      await runCauseEffect(browser.takeUserControl(tabId(body), { kind: "member", memberId: member.id, sessionId }));
    if (url.pathname === BROWSER_USER_CONTROL_ROUTES.release) browser.releaseUserControl(tabId(body));
    return json(200, {
      tabIds: browser
        .listTabs()
        .filter((tab) => tab.userControl && !hidden(tab.id))
        .map((tab) => tab.id),
    });
  }

  // Behind `browser-page-state`. A stop ends the load now, before the queued tab operations; the
  // answer is the history state of each tab that this member can see, as the event sends it.
  if (method === "POST" && Object.values(BROWSER_PAGE_STATE_ROUTES).some((path) => path === url.pathname)) {
    if (!capabilities.has(BROWSER_PAGE_STATE_CAPABILITY))
      throw new HttpError(400, sourceText("error.backend.browserStopUnsupported"));
    const body = await readJson(request);
    if (url.pathname === BROWSER_PAGE_STATE_ROUTES.stop) await runCauseEffect(browser.stop(tabId(body)));
    return json(200, {
      tabs: browser
        .listTabs()
        .filter((tab) => !hidden(tab.id))
        .map((tab) => ({ tabId: tab.id, canGoBack: tab.canGoBack === true, canGoForward: tab.canGoForward === true })),
    });
  }

  // Behind `browser-sign-in`. Any member who can see a tab gives it the cookies of a sign-in made on
  // their own device. The body holds cookie values: it is never logged, and the answer holds a count.
  if (method === "POST" && url.pathname === BROWSER_SIGN_IN_ROUTES.import) {
    if (!capabilities.has(BROWSER_SIGN_IN_CAPABILITY))
      throw new HttpError(400, sourceText("error.backend.browserSignInUnsupported"));
    const body = await readJson(request);
    const signIn = decodeBrowserSignInImport({ ...body, tabId: tabId(body) });
    return json(200, { cookies: await runCauseEffect(browser.importSignIn(signIn.tabId, signIn.cookies)) });
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
        tabId: tabId(body),
      }),
    );
  }
  const viewSessionMatch = /^\/v1\/browser\/view\/sessions\/([^/]+)$/u.exec(url.pathname);
  if (method === "DELETE" && viewSessionMatch) {
    if (!browserView) throw new HttpError(404, sourceText("error.team.browserViewUnavailable"));
    if (
      !(await runCauseEffect(
        browserView.closeMemberSession(pathIdentifier(viewSessionMatch[1], "sessionId"), member.id),
      ))
    ) {
      throw new HttpError(404, sourceText("error.team.browserSessionNotFound"));
    }
    return empty(204);
  }

  return "unmatched";
}
