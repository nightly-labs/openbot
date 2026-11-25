import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { type BrowserControlState, canAdministerServer, type TeamRole } from "@openbot/contracts/ipc";
import { type DynamicRecord, isBoolean } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  BROWSER_PAGE_STATE_CAPABILITY,
  BROWSER_PAGE_STATE_ROUTES,
} from "@openbot/contracts/team-protocol/browser-page-state-v1";
import {
  BROWSER_PERMISSIONS_CAPABILITY,
  BROWSER_PERMISSIONS_ROUTES,
  decodeBrowserPermissionAnswer,
} from "@openbot/contracts/team-protocol/browser-permissions-v1";
import {
  BROWSER_SIGN_IN_STORAGE_CAPABILITY,
  BROWSER_SIGN_IN_STORAGE_ROUTES,
  decodeBrowserSignInStorageImport,
} from "@openbot/contracts/team-protocol/browser-sign-in-storage-v1";
import {
  BROWSER_SIGN_IN_CAPABILITY,
  BROWSER_SIGN_IN_ROUTES,
  decodeBrowserSignInImport,
} from "@openbot/contracts/team-protocol/browser-sign-in-v1";
import {
  BROWSER_TEACH_CAPABILITY,
  BROWSER_TEACH_MAX_STEPS,
  BROWSER_TEACH_ROUTES,
} from "@openbot/contracts/team-protocol/browser-teach-v1";
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
  blockedAgentIds: () => ReadonlySet<string>;
}

export function hiddenTabTest(
  browser: Pick<TeamApiBrowser, "isPrivate" | "listTabs">,
  role: TeamRole | null | undefined,
  blockedAgentIds: () => ReadonlySet<string>,
  owners?: ReadonlyMap<string, string | null>,
): (tabId: string) => boolean {
  if (canAdministerServer(role)) return () => false;
  let blocked: ReadonlySet<string> | undefined;
  let tabOwners = owners;
  return (tabId) => {
    if (browser.isPrivate(tabId)) return true;
    blocked ??= blockedAgentIds();
    if (blocked.size === 0) return false;
    tabOwners ??= new Map(browser.listTabs().map((tab) => [tab.id, tab.ownerAgentId]));
    const owner = tabOwners.get(tabId);
    return typeof owner === "string" && blocked.has(owner);
  };
}

export function visibleControlState(
  state: BrowserControlState,
  hidden: (tabId: string) => boolean,
): BrowserControlState {
  return state.sessions.some((session) => session.tabId !== null && hidden(session.tabId))
    ? { sessions: state.sessions.filter((session) => session.tabId === null || !hidden(session.tabId)) }
    : state;
}

export async function routeBrowser(
  context: TeamApiRequestContext,
  { browser, browserView, blockedAgentIds: readBlockedAgentIds }: BrowserRouteDependencies,
): Promise<RouteOutcome> {
  const { method, url, request, member, sessionId, capabilities, json, empty } = context;
  let blocked: ReadonlySet<string> | undefined;
  const blockedAgentIds = () => {
    blocked ??= readBlockedAgentIds();
    return blocked;
  };
  const hidden = hiddenTabTest(browser, member.role, blockedAgentIds);
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
  if (method === "GET" && url.pathname === TEAM_API_ROUTES.browser.display) {
    const display = browser.getDisplayState();
    const tabs = display.tabs.filter((tab) => !hidden(tab.id));
    const activeTabId = tabs.some((tab) => tab.id === display.activeTabId) ? display.activeTabId : null;
    return json(200, { tabs, activeTabId });
  }
  if (method === "GET" && url.pathname === TEAM_API_ROUTES.browser.control) {
    return json(200, visibleControlState(browser.getControlState(), hidden));
  }
  if (method === "POST" && url.pathname === TEAM_API_ROUTES.browser.open) {
    const body = await readJson(request);
    const focus = body.focus ?? false;
    if (!isBoolean(focus)) throw new HttpError(400, "focus must be a boolean.");
    const ownerAgentId = nullableString(body, "ownerAgentId");
    if (ownerAgentId !== null && blockedAgentIds().has(ownerAgentId))
      throw new HttpError(404, sourceText("error.team.agentNotFound"));
    return json(
      201,
      await runCauseEffect(
        browser.open(
          stringField(body, "url", false, INPUT_LIMITS.browserUrl),
          nullableString(body, "ownerThreadId"),
          ownerAgentId,
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

  if (method === "POST" && Object.values(BROWSER_TEACH_ROUTES).some((path) => path === url.pathname)) {
    if (!capabilities.has(BROWSER_TEACH_CAPABILITY))
      throw new HttpError(400, sourceText("error.backend.browserTeachUnsupported"));
    const body = await readJson(request);
    const holder = { kind: "member" as const, memberId: member.id, sessionId };
    if (url.pathname === BROWSER_TEACH_ROUTES.start) {
      await runCauseEffect(browser.startTeach(tabId(body), holder));
      return json(200, {});
    }
    if (!isBoolean(body.save)) throw new HttpError(400, "save is required.");
    return json(200, { steps: browser.stopTeach(tabId(body), holder, body.save).slice(0, BROWSER_TEACH_MAX_STEPS) });
  }

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

  if (method === "POST" && Object.values(BROWSER_PERMISSIONS_ROUTES).some((path) => path === url.pathname)) {
    if (!capabilities.has(BROWSER_PERMISSIONS_CAPABILITY))
      throw new HttpError(400, sourceText("error.backend.browserPermissionsUnsupported"));
    const body = await readJson(request);
    if (url.pathname === BROWSER_PERMISSIONS_ROUTES.answer) {
      const answer = decodeBrowserPermissionAnswer({ ...body, tabId: tabId(body) });
      if (answer.allow && !answer.location)
        throw new HttpError(400, sourceText("error.backend.browserLocationRequired"));
      await runCauseEffect(browser.answerPermission(answer));
    }
    return json(200, {
      requests: browser
        .listTabs()
        .filter((tab) => tab.permissionRequest && !hidden(tab.id))
        .flatMap((tab) => (tab.permissionRequest ? [{ tabId: tab.id, ...tab.permissionRequest }] : [])),
    });
  }

  if (method === "POST" && url.pathname === BROWSER_SIGN_IN_ROUTES.import) {
    if (!capabilities.has(BROWSER_SIGN_IN_CAPABILITY))
      throw new HttpError(400, sourceText("error.backend.browserSignInUnsupported"));
    const body = await readJson(request);
    const signIn = decodeBrowserSignInImport({ ...body, tabId: tabId(body) });
    const result = await runCauseEffect(browser.importSignIn(signIn.tabId, signIn.cookies));
    return json(200, { cookies: result.cookies });
  }
  if (method === "POST" && url.pathname === BROWSER_SIGN_IN_STORAGE_ROUTES.import) {
    if (!capabilities.has(BROWSER_SIGN_IN_STORAGE_CAPABILITY))
      throw new HttpError(400, sourceText("error.backend.browserSignInUnsupported"));
    const body = await readJson(request);
    const signIn = decodeBrowserSignInStorageImport({ ...body, tabId: tabId(body) });
    return json(200, await runCauseEffect(browser.importSignIn(signIn.tabId, signIn.cookies, signIn.storage)));
  }

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
