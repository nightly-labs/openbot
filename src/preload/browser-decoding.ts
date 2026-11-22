import {
  AVATAR_HUES,
  type AvatarHue,
  BROWSER_CONTROL_ACTIONS,
  BROWSER_CONTROL_DETAIL_ACTIONS,
  type BrowserBounds,
  type BrowserControlSession,
  type BrowserControlState,
  type BrowserDisplayState,
  type BrowserEnvironment,
  type BrowserLiveViewEvent,
  type BrowserLocalSignInEnd,
  type BrowserLocalSignInResult,
  type BrowserPictureInPictureEvent,
  type BrowserPreview,
  type BrowserTab,
  type BrowserTabAgent,
  type BrowserTabLabel,
  type BrowserTeachStep,
  type BrowserViewport,
  type BrowserWindowAction,
  type BrowserWindowEvent,
  type BrowserWindowModel,
  type BrowserWindowTabDetails,
  isAvatarColor,
} from "@openbot/contracts/ipc";
import {
  decodeList,
  decodeRecord,
  nullableString,
  requiredBoolean,
  requiredNumber,
  requiredString,
} from "@openbot/contracts/ipc-decoding";
import { type DynamicRecord, isBoolean, isNumber, isOneOf, isString } from "@openbot/contracts/runtime-values";

const CONTROL_PHASES = ["acting", "waiting"] as const;
const DIALOG_TYPES = ["alert", "confirm"] as const;
const VIEWPORT_MODES = ["fill", "custom"] as const;
const VIEWPORT_PRESETS = ["desktop", "tablet", "mobile"] as const;
const COLOR_SCHEMES = ["light", "dark", "system"] as const;

export function decodeBrowserTab(value: unknown): BrowserTab {
  return browserTab(decodeRecord(value, "browser tab"));
}

export function decodeBrowserTabs(value: unknown): BrowserTab[] {
  return decodeList(value, "browser tab list", browserTab);
}

export function decodeBrowserDisplayState(value: unknown): BrowserDisplayState {
  const state = decodeRecord(value, "browser display state");
  return { tabs: decodeBrowserTabs(state.tabs), activeTabId: nullableString(state, "activeTabId") };
}

export function decodeBrowserControlState(value: unknown): BrowserControlState {
  const state = decodeRecord(value, "browser control state");
  return { sessions: decodeList(state.sessions, "browser control session list", controlSession) };
}

export function decodeBrowserBounds(value: unknown): BrowserBounds {
  const bounds = decodeRecord(value, "browser bounds");
  return {
    x: requiredNumber(bounds, "x"),
    y: requiredNumber(bounds, "y"),
    width: requiredNumber(bounds, "width"),
    height: requiredNumber(bounds, "height"),
  };
}

export function decodeBrowserLocalSignInEnd(value: unknown): BrowserLocalSignInEnd {
  const end = decodeRecord(value, "browser sign-in end");
  return { signedIn: requiredBoolean(end, "signedIn") };
}

export function decodeBrowserLocalSignInResult(value: unknown): BrowserLocalSignInResult | null {
  if (value === null) return null;
  const result = decodeRecord(value, "browser sign-in result");
  return { cookies: requiredNumber(result, "cookies"), signedIn: requiredBoolean(result, "signedIn") };
}

export function decodeBrowserLiveViewEvent(value: unknown): BrowserLiveViewEvent {
  const event = decodeRecord(value, "browser live view event");
  const tabId = requiredString(event, "tabId");
  switch (event.type) {
    case "frame":
      if (!(event.image instanceof Uint8Array)) throw new Error("Invalid image.");
      return {
        type: "frame",
        tabId,
        sequence: requiredNumber(event, "sequence"),
        width: requiredNumber(event, "width"),
        height: requiredNumber(event, "height"),
        image: event.image,
      };
    case "stopped":
      return { type: "stopped", tabId, reason: requiredString(event, "reason") };
    case "copied":
      return { type: "copied", tabId, text: requiredString(event, "text") };
    case "copyTooLarge":
      return { type: "copyTooLarge", tabId };
    case "dialog": {
      if (event.dialog === null) return { type: "dialog", tabId, dialog: null };
      const dialog = decodeRecord(event.dialog, "browser live view dialog");
      if (!isOneOf(DIALOG_TYPES, dialog.type)) throw new Error("Invalid browser live view dialog type.");
      return {
        type: "dialog",
        tabId,
        dialog: { id: requiredString(dialog, "id"), type: dialog.type, message: requiredString(dialog, "message") },
      };
    }
    default:
      throw new Error("Invalid browser live view event type.");
  }
}

export function decodeBrowserPictureInPictureEvent(value: unknown): BrowserPictureInPictureEvent {
  const event = decodeRecord(value, "picture-in-picture event");
  switch (event.type) {
    case "bounds-changed":
      return { type: "bounds-changed", bounds: decodeBrowserBounds(event.bounds) };
    case "dock":
    case "hide":
      return { type: event.type };
    default:
      throw new Error("Invalid picture-in-picture event type.");
  }
}

export function decodeBrowserWindowModel(value: unknown): BrowserWindowModel | null {
  if (value === null) return null;
  const model = decodeRecord(value, "browser window model");
  const { shortcuts } = model;
  if (shortcuts !== null && shortcuts !== "mac" && shortcuts !== "pc") throw new Error("Invalid shortcuts.");
  return {
    tabs: decodeBrowserTabs(model.tabs),
    activeTabId: nullableString(model, "activeTabId"),
    details: decodeList(model.details, "browser tab details", windowTabDetails),
    history: decodeList(model.history, "browser history", (entry) => ({
      url: requiredString(entry, "url"),
      title: requiredString(entry, "title"),
      visits: requiredNumber(entry, "visits"),
    })),
    canReopen: requiredBoolean(model, "canReopen"),
    canCloseTabs: requiredBoolean(model, "canCloseTabs"),
    liveViewTabId: nullableString(model, "liveViewTabId"),
    liveViewClipboard: requiredBoolean(model, "liveViewClipboard"),
    shortcuts,
  };
}

export function decodeBrowserWindowModelUpdate(value: unknown): BrowserWindowModel {
  const model = decodeBrowserWindowModel(value);
  if (!model) throw new Error("Invalid browser window model.");
  return model;
}

export function decodeBrowserWindowEvent(value: unknown): BrowserWindowEvent {
  const event = decodeRecord(value, "browser window event");
  switch (event.type) {
    case "bounds-changed":
      return { type: "bounds-changed", bounds: decodeBrowserBounds(event.bounds) };
    case "dock":
    case "hide":
      return { type: event.type };
    case "action":
      return { type: "action", action: windowAction(decodeRecord(event.action, "browser window action")) };
    default:
      throw new Error("Invalid browser window event type.");
  }
}

function windowAction(action: DynamicRecord): BrowserWindowAction {
  switch (action.type) {
    case "activate":
    case "duplicate":
    case "reload":
    case "stop":
      return { type: action.type, tabId: requiredString(action, "tabId") };
    case "close":
      if (!Array.isArray(action.tabIds) || !action.tabIds.every(isString)) throw new Error("Invalid tabIds.");
      return { type: "close", tabIds: action.tabIds };
    case "new-tab":
      return action.afterId === undefined
        ? { type: "new-tab" }
        : { type: "new-tab", afterId: requiredString(action, "afterId") };
    case "move":
      return { type: "move", tabId: requiredString(action, "tabId"), index: requiredNumber(action, "index") };
    case "reopen":
      return { type: "reopen" };
    case "navigate": {
      const { direction } = action;
      if (direction !== "back" && direction !== "forward") throw new Error("Invalid direction.");
      return { type: "navigate", tabId: requiredString(action, "tabId"), direction };
    }
    case "open-address": {
      const url = requiredString(action, "url");
      return action.tabId === undefined
        ? { type: "open-address", url }
        : { type: "open-address", url, tabId: requiredString(action, "tabId") };
    }
    default:
      throw new Error("Invalid browser window action.");
  }
}

function windowTabDetails(details: DynamicRecord): BrowserWindowTabDetails {
  return {
    tabId: requiredString(details, "tabId"),
    ...(details.control === undefined
      ? {}
      : { control: controlSession(decodeRecord(details.control, "browser control session")) }),
    ...(details.controller === undefined
      ? {}
      : { controller: tabAgent(decodeRecord(details.controller, "browser tab agent")) }),
    ...(details.owner === undefined ? {} : { owner: tabAgent(decodeRecord(details.owner, "browser tab agent")) }),
    ...(details.profile === undefined
      ? {}
      : { profile: tabLabel(decodeRecord(details.profile, "browser tab profile")) }),
  };
}

function tabAgent(agent: DynamicRecord): BrowserTabAgent {
  const { avatarColor } = agent;
  if (avatarColor !== undefined && avatarColor !== null && !isAvatarColor(avatarColor)) {
    throw new Error("Invalid avatarColor.");
  }
  return {
    id: requiredString(agent, "id"),
    name: requiredString(agent, "name"),
    avatarSeed: requiredString(agent, "avatarSeed"),
    avatarHue: avatarHue(agent.avatarHue),
    ...(avatarColor === undefined ? {} : { avatarColor }),
    avatarUrl: nullableString(agent, "avatarUrl"),
  };
}

function tabLabel(profile: DynamicRecord): BrowserTabLabel {
  return {
    tabId: requiredString(profile, "tabId"),
    name: nullableString(profile, "name"),
    hue: avatarHue(profile.hue),
    ...(profile.proxy === undefined ? {} : { proxy: requiredString(profile, "proxy") }),
  };
}

function avatarHue(value: unknown): AvatarHue | null {
  if (value === null || isOneOf(AVATAR_HUES, value)) return value;
  throw new Error("Invalid avatar hue.");
}

export function decodeBrowserTeachSteps(value: unknown): BrowserTeachStep[] {
  return decodeList(value, "browser teach steps", (entry) => {
    const step = decodeRecord(entry, "browser teach step");
    if (step.kind !== "page" && step.kind !== "click") throw new Error("Invalid browser teach step kind.");
    const { title, role, name } = step;
    return {
      kind: step.kind,
      host: requiredString(step, "host"),
      path: requiredString(step, "path"),
      ...(isString(title) ? { title } : {}),
      ...(isString(role) ? { role } : {}),
      ...(isString(name) ? { name } : {}),
    };
  });
}

function browserTab(tab: DynamicRecord): BrowserTab {
  const {
    environment,
    recording,
    diagnosticErrorCount,
    openerTabId,
    popupFailure,
    userControl,
    canGoBack,
    canGoForward,
  } = tab;
  if (recording !== undefined && !isBoolean(recording)) throw new Error("Invalid recording.");
  if (canGoBack !== undefined && !isBoolean(canGoBack)) throw new Error("Invalid canGoBack.");
  if (canGoForward !== undefined && !isBoolean(canGoForward)) throw new Error("Invalid canGoForward.");
  if (diagnosticErrorCount !== undefined && !isNumber(diagnosticErrorCount)) {
    throw new Error("Invalid diagnosticErrorCount.");
  }
  if (openerTabId !== undefined && !isString(openerTabId)) throw new Error("Invalid openerTabId.");
  return {
    id: requiredString(tab, "id"),
    title: requiredString(tab, "title"),
    url: requiredString(tab, "url"),
    loading: requiredBoolean(tab, "loading"),
    ownerThreadId: nullableString(tab, "ownerThreadId"),
    ownerAgentId: nullableString(tab, "ownerAgentId"),
    ...(environment === undefined ? {} : { environment: browserEnvironment(environment) }),
    ...(recording === undefined ? {} : { recording }),
    ...(diagnosticErrorCount === undefined ? {} : { diagnosticErrorCount }),
    ...(openerTabId === undefined ? {} : { openerTabId }),
    ...(popupFailure === undefined ? {} : { popupFailure: popupFailureOf(popupFailure) }),
    ...(userControl === true ? { userControl } : {}),
    ...(canGoBack === undefined ? {} : { canGoBack }),
    ...(canGoForward === undefined ? {} : { canGoForward }),
  };
}

function browserEnvironment(value: unknown): BrowserEnvironment {
  const environment = decodeRecord(value, "browser environment");
  if (!isOneOf(COLOR_SCHEMES, environment.colorScheme)) throw new Error("Invalid colorScheme.");
  return {
    viewport: browserViewport(environment.viewport),
    colorScheme: environment.colorScheme,
    reducedMotion: requiredBoolean(environment, "reducedMotion"),
  };
}

function browserViewport(value: unknown): BrowserViewport {
  const viewport = decodeRecord(value, "browser viewport");
  const { mode, preset } = viewport;
  if (!isOneOf(VIEWPORT_MODES, mode)) throw new Error("Invalid mode.");
  if (preset !== null && !isOneOf(VIEWPORT_PRESETS, preset)) throw new Error("Invalid preset.");
  return {
    mode,
    width: requiredNumber(viewport, "width"),
    height: requiredNumber(viewport, "height"),
    deviceScaleFactor: requiredNumber(viewport, "deviceScaleFactor"),
    preset,
  };
}

function popupFailureOf(value: unknown): { id: string; message: string } {
  const failure = decodeRecord(value, "browser popup failure");
  return { id: requiredString(failure, "id"), message: requiredString(failure, "message") };
}

function controlSession(session: DynamicRecord): BrowserControlSession {
  const { action, detailAction, phase } = session;
  if (!isOneOf(BROWSER_CONTROL_ACTIONS, action)) throw new Error("Invalid action.");
  if (detailAction !== undefined && !isOneOf(BROWSER_CONTROL_DETAIL_ACTIONS, detailAction)) {
    throw new Error("Invalid detailAction.");
  }
  if (!isOneOf(CONTROL_PHASES, phase)) throw new Error("Invalid phase.");
  return {
    id: requiredString(session, "id"),
    threadId: requiredString(session, "threadId"),
    turnId: requiredString(session, "turnId"),
    callId: requiredString(session, "callId"),
    tabId: nullableString(session, "tabId"),
    action,
    ...(detailAction === undefined ? {} : { detailAction }),
    phase,
    startedAt: requiredString(session, "startedAt"),
  };
}

export function decodeBrowserPreviewFromMain(value: unknown): BrowserPreview {
  const preview = decodeRecord(value, "browser preview");
  const dataUrl = requiredString(preview, "dataUrl");
  const width = requiredNumber(preview, "width");
  const height = requiredNumber(preview, "height");
  if (
    dataUrl.length > 2_000_000 ||
    !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl) ||
    !Number.isSafeInteger(width) ||
    width <= 0 ||
    width > 960 ||
    !Number.isSafeInteger(height) ||
    height <= 0 ||
    height > 600
  ) {
    throw new Error("Invalid browser preview.");
  }
  return { dataUrl, width, height };
}
