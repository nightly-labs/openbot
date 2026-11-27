import { AVATAR_IMAGE_LIMITS, INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  AVATAR_HUES,
  type AvatarHue,
  BROWSER_CONTROL_ACTIONS,
  BROWSER_CONTROL_DETAIL_ACTIONS,
  type BrowserBounds,
  type BrowserControlSession,
  type BrowserHttpSignInInput,
  type BrowserLocalSignInFinish,
  type BrowserLocalSignInInput,
  type BrowserNavigateInput,
  type BrowserOpenInput,
  type BrowserTabAgent,
  type BrowserTabLabel,
  type BrowserTeachStopInput,
  type BrowserVisibilityInput,
  type BrowserWindowAction,
  type BrowserWindowHistoryEntry,
  type BrowserWindowModel,
  type BrowserWindowTabDetails,
  isAvatarColor,
} from "@openbot/contracts/ipc";
import { isBoolean, isNumber, isOneOf, isString } from "@openbot/contracts/runtime-values";
import {
  BROWSER_HTTP_SIGN_IN_PASSWORD_LIMIT,
  BROWSER_HTTP_SIGN_IN_USERNAME_LIMIT,
} from "@openbot/contracts/team-protocol/browser-http-sign-in-v1";
import { sourceText } from "@openbot/i18n/source";
import { decodeBrowserTabs } from "../remote-device-decoding";
import { isObject, requireString } from "./validation";

export function parseBrowserOpen(value: unknown): BrowserOpenInput {
  if (!isObject(value)) throw new Error("Invalid browser open request.");
  if (value.focus !== undefined && !isBoolean(value.focus)) throw new Error("Invalid browser focus request.");
  return {
    url: requireString(value.url, "url", INPUT_LIMITS.browserUrl),
    ownerThreadId:
      value.ownerThreadId === null || value.ownerThreadId === undefined
        ? null
        : requireString(value.ownerThreadId, "ownerThreadId"),
    ownerAgentId:
      value.ownerAgentId === null || value.ownerAgentId === undefined
        ? null
        : requireString(value.ownerAgentId, "ownerAgentId"),
    focus: value.focus ?? false,
  };
}

export function parseBrowserNavigate(value: unknown): BrowserNavigateInput {
  if (isObject(value) && value.direction !== undefined && value.url !== undefined) {
    throw new Error("Invalid browser navigation request.");
  }
  if (isObject(value) && value.direction === undefined && value.url !== undefined) {
    const url = requireString(value.url, "url", INPUT_LIMITS.browserUrl);
    if (!/^https?:\/\//i.test(url)) throw new Error(sourceText("error.backend.browserUrlProtocol"));
    return { tabId: requireString(value.tabId, "tabId"), url };
  }
  if (!isObject(value) || (value.direction !== "back" && value.direction !== "forward")) {
    throw new Error("Invalid browser navigation request.");
  }
  return {
    tabId: requireString(value.tabId, "tabId"),
    direction: value.direction,
  };
}

export function parseBrowserTeachStop(value: unknown): BrowserTeachStopInput {
  if (!isObject(value) || !isBoolean(value.save)) throw new Error("Invalid browser teach request.");
  return { tabId: requireString(value.tabId, "tabId"), save: value.save };
}

export function parseVisibility(value: unknown): BrowserVisibilityInput {
  if (!isObject(value) || !isBoolean(value.visible)) {
    throw new Error("Invalid browser visibility request.");
  }
  return {
    visible: value.visible,
    ...(value.bounds === undefined ? {} : { bounds: parseBounds(value.bounds) }),
    ...(value.target === undefined ? {} : { target: parseBrowserViewTarget(value.target) }),
  };
}

export function parseBrowserBounds(value: unknown): BrowserBounds {
  return parseBounds(value);
}

function parseBrowserViewTarget(value: unknown): "main" | "picture-in-picture" {
  if (value === "main" || value === "picture-in-picture") return value;
  throw new Error("Invalid browser view target.");
}

function parseBounds(value: unknown): BrowserBounds {
  if (!isObject(value)) throw new Error("Invalid browser bounds.");
  return {
    x: finiteBound(value.x, "x"),
    y: finiteBound(value.y, "y"),
    width: finiteBound(value.width, "width"),
    height: finiteBound(value.height, "height"),
  };
}

function finiteBound(value: unknown, field: string): number {
  if (!isNumber(value) || !Number.isFinite(value)) {
    throw new Error(`Invalid browser bound: ${field}.`);
  }
  return value;
}

export function parseLocalSignIn(value: unknown): BrowserLocalSignInInput {
  if (!isObject(value)) throw new Error("Invalid browser sign-in request.");
  const url = requireString(value.url, "url", INPUT_LIMITS.browserUrl);
  if (!/^https?:\/\//i.test(url)) throw new Error(sourceText("error.backend.browserUrlProtocol"));
  return { tabId: requireString(value.tabId, "tabId"), url };
}

export function parseLocalSignInFinish(value: unknown): BrowserLocalSignInFinish {
  if (!isObject(value) || !isBoolean(value.send)) throw new Error("Invalid browser sign-in request.");
  return { send: value.send };
}

export function parseHttpSignInAnswer(value: unknown): BrowserHttpSignInInput {
  if (!isObject(value)) throw new Error("Invalid browser sign-in answer.");
  const tabId = requireString(value.tabId, "tabId");
  if (value.cancel === true) return { tabId, cancel: true };
  if (
    !isString(value.username) ||
    value.username.length > BROWSER_HTTP_SIGN_IN_USERNAME_LIMIT ||
    !isString(value.password) ||
    value.password.length > BROWSER_HTTP_SIGN_IN_PASSWORD_LIMIT
  )
    throw new Error("Invalid browser sign-in answer.");
  return { tabId, username: value.username, password: value.password };
}

const BROWSER_WINDOW_LIST_LIMIT = 1_000;
const BROWSER_WINDOW_AVATAR_URL_LIMIT = Math.ceil((AVATAR_IMAGE_LIMITS.storedBytes * 4) / 3) + INPUT_LIMITS.avatarUrl;

export function parseBrowserWindowModel(value: unknown): BrowserWindowModel {
  if (!isObject(value)) throw new Error("Invalid browser window model.");
  if (!isBoolean(value.canReopen) || !isBoolean(value.canCloseTabs) || !isBoolean(value.liveViewClipboard)) {
    throw new Error("Invalid browser window model.");
  }
  if (value.shortcuts !== null && value.shortcuts !== "mac" && value.shortcuts !== "pc") {
    throw new Error("Invalid browser window shortcuts.");
  }
  return {
    tabs: decodeBrowserTabs(value.tabs),
    activeTabId: nullableIdentifier(value.activeTabId, "activeTabId"),
    details: boundedList(value.details, "details").map(parseTabDetails),
    history: boundedList(value.history, "history").map(parseHistoryEntry),
    canReopen: value.canReopen,
    canCloseTabs: value.canCloseTabs,
    liveViewTabId: nullableIdentifier(value.liveViewTabId, "liveViewTabId"),
    liveViewClipboard: value.liveViewClipboard,
    shortcuts: value.shortcuts,
  };
}

export function parseBrowserWindowAction(value: unknown): BrowserWindowAction {
  if (!isObject(value)) throw new Error("Invalid browser window action.");
  switch (value.type) {
    case "activate":
    case "duplicate":
    case "reload":
    case "stop":
      return { type: value.type, tabId: requireString(value.tabId, "tabId") };
    case "close":
      return {
        type: "close",
        tabIds: boundedList(value.tabIds, "tabIds").map((tabId) => requireString(tabId, "tabId")),
      };
    case "new-tab":
      return value.afterId === undefined
        ? { type: "new-tab" }
        : { type: "new-tab", afterId: requireString(value.afterId, "afterId") };
    case "move":
      if (!isNumber(value.index) || !Number.isSafeInteger(value.index) || value.index < 0) {
        throw new Error("Invalid browser tab index.");
      }
      return { type: "move", tabId: requireString(value.tabId, "tabId"), index: value.index };
    case "reopen":
      return { type: "reopen" };
    case "navigate":
      if (value.direction !== "back" && value.direction !== "forward") {
        throw new Error("Invalid browser navigation request.");
      }
      return { type: "navigate", tabId: requireString(value.tabId, "tabId"), direction: value.direction };
    case "open-address": {
      const url = requireString(value.url, "url", INPUT_LIMITS.browserUrl);
      return value.tabId === undefined
        ? { type: "open-address", url }
        : { type: "open-address", url, tabId: requireString(value.tabId, "tabId") };
    }
    default:
      throw new Error("Invalid browser window action.");
  }
}

function boundedList(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value) || value.length > BROWSER_WINDOW_LIST_LIMIT) {
    throw new Error(`Invalid browser window ${field}.`);
  }
  return value;
}

function boundedText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length > INPUT_LIMITS.browserUrl) throw new Error(`Invalid ${field}.`);
  return value;
}

function nullableIdentifier(value: unknown, field: string): string | null {
  return value === null ? null : requireString(value, field);
}

function parseHistoryEntry(value: unknown): BrowserWindowHistoryEntry {
  if (!isObject(value) || !isNumber(value.visits)) throw new Error("Invalid browser history entry.");
  return {
    url: requireString(value.url, "url", INPUT_LIMITS.browserUrl),
    title: boundedText(value.title, "title"),
    visits: value.visits,
  };
}

function parseTabDetails(value: unknown): BrowserWindowTabDetails {
  if (!isObject(value)) throw new Error("Invalid browser tab details.");
  return {
    tabId: requireString(value.tabId, "tabId"),
    ...(value.control === undefined ? {} : { control: parseControlSession(value.control) }),
    ...(value.controller === undefined ? {} : { controller: parseTabAgent(value.controller) }),
    ...(value.owner === undefined ? {} : { owner: parseTabAgent(value.owner) }),
    ...(value.profile === undefined ? {} : { profile: parseTabLabel(value.profile) }),
  };
}

function parseControlSession(value: unknown): BrowserControlSession {
  if (!isObject(value) || (value.phase !== "acting" && value.phase !== "waiting")) {
    throw new Error("Invalid browser control session.");
  }
  const { action, detailAction, phase } = value;
  if (!isOneOf(BROWSER_CONTROL_ACTIONS, action)) throw new Error("Invalid browser control action.");
  if (detailAction !== undefined && !isOneOf(BROWSER_CONTROL_DETAIL_ACTIONS, detailAction)) {
    throw new Error("Invalid browser control action.");
  }
  return {
    id: requireString(value.id, "id"),
    threadId: requireString(value.threadId, "threadId"),
    turnId: requireString(value.turnId, "turnId"),
    callId: requireString(value.callId, "callId"),
    tabId: nullableIdentifier(value.tabId, "tabId"),
    action,
    ...(detailAction === undefined ? {} : { detailAction }),
    phase,
    startedAt: requireString(value.startedAt, "startedAt"),
  };
}

function parseTabAgent(value: unknown): BrowserTabAgent {
  if (!isObject(value)) throw new Error("Invalid browser tab agent.");
  if (value.avatarColor !== undefined && value.avatarColor !== null && !isAvatarColor(value.avatarColor)) {
    throw new Error("Invalid browser tab agent color.");
  }
  return {
    id: requireString(value.id, "id"),
    name: requireString(value.name, "name", INPUT_LIMITS.browserUrl),
    avatarSeed: requireString(value.avatarSeed, "avatarSeed"),
    avatarHue: parseAvatarHue(value.avatarHue),
    ...(value.avatarColor === undefined ? {} : { avatarColor: value.avatarColor }),
    avatarUrl:
      value.avatarUrl === null ? null : requireString(value.avatarUrl, "avatarUrl", BROWSER_WINDOW_AVATAR_URL_LIMIT),
  };
}

function parseTabLabel(value: unknown): BrowserTabLabel {
  if (!isObject(value)) throw new Error("Invalid browser tab profile.");
  return {
    tabId: requireString(value.tabId, "tabId"),
    name: value.name === null ? null : requireString(value.name, "name", INPUT_LIMITS.browserUrl),
    hue: parseAvatarHue(value.hue),
    ...(value.proxy === undefined ? {} : { proxy: requireString(value.proxy, "proxy", INPUT_LIMITS.browserUrl) }),
  };
}

function parseAvatarHue(value: unknown): AvatarHue | null {
  if (value === null || isOneOf(AVATAR_HUES, value)) return value;
  throw new Error("Invalid avatar hue.");
}
