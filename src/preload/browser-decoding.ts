// What main answers for the embedded browser, its live view, and its picture-in-picture window.
//
// Each decoder checks every field the contract type requires and keeps each optional field it
// carries, so a value the renderer reads always has the shape its type says.

import type {
  BrowserBounds,
  BrowserControlAction,
  BrowserControlDetailAction,
  BrowserControlSession,
  BrowserControlState,
  BrowserDisplayState,
  BrowserEnvironment,
  BrowserLiveViewEvent,
  BrowserPictureInPictureEvent,
  BrowserTab,
  BrowserViewport,
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

const CONTROL_ACTIONS: readonly BrowserControlAction[] = [
  "open",
  "list-tabs",
  "snapshot",
  "click",
  "type",
  "key",
  "scroll",
  "back",
  "forward",
  "reload",
  "screenshot",
  "close-tab",
];
const CONTROL_DETAIL_ACTIONS: readonly BrowserControlDetailAction[] = [
  "status",
  "navigate",
  "press",
  "hover",
  "select-option",
  "set-checked",
  "drag",
  "upload-files",
  "wait-for",
  "evaluate",
  "set-environment",
  "recording-start",
  "recording-stop",
];
const CONTROL_PHASES = ["acting", "waiting"] as const;
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

function browserTab(tab: DynamicRecord): BrowserTab {
  const { environment, recording, diagnosticErrorCount, openerTabId, popupFailure } = tab;
  if (recording !== undefined && !isBoolean(recording)) throw new Error("Invalid recording.");
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
  if (!isOneOf(CONTROL_ACTIONS, action)) throw new Error("Invalid action.");
  if (detailAction !== undefined && !isOneOf(CONTROL_DETAIL_ACTIONS, detailAction)) {
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
