import type { AvatarColor, AvatarHue } from "./ipc-agent-identity";
import type { BrowserTabProfile } from "./ipc-browser-profiles";

export interface BrowserTab {
  id: string;
  title: string;
  url: string;
  loading: boolean;
  ownerThreadId: string | null;
  ownerAgentId: string | null;
  environment?: BrowserEnvironment;
  recording?: boolean;
  diagnosticErrorCount?: number;
  openerTabId?: string;
  popupFailure?: { id: string; message: string };
  userControl?: true;
  canGoBack?: boolean;
  canGoForward?: boolean;
  httpSignIn?: BrowserHttpSignIn;
}

export interface BrowserHttpSignIn {
  origin: string;
  refused?: true;
}

export function browserHttpSignInPrompts(
  tabs: readonly BrowserTab[],
): { tabId: string; origin: string; refused: boolean }[] {
  return tabs.flatMap((tab) =>
    tab.httpSignIn ? [{ tabId: tab.id, origin: tab.httpSignIn.origin, refused: tab.httpSignIn.refused === true }] : [],
  );
}

export type BrowserHttpSignInInput = { tabId: string } & ({ username: string; password: string } | { cancel: true });

export interface BrowserTeachStep {
  kind: "page" | "click";
  host: string;
  path: string;
  title?: string;
  role?: string;
  name?: string;
}

export interface BrowserTeachStopInput {
  tabId: string;
  save: boolean;
}

export type BrowserImageMode = "auto" | "always" | "never";

export type BrowserTarget =
  | { kind: "ref"; ref: string; revision: number }
  | { kind: "role"; role: string; name?: string | undefined; exact?: boolean | undefined; nth?: number | undefined }
  | { kind: "text"; text: string; exact?: boolean | undefined; nth?: number | undefined }
  | { kind: "css"; selector: string; nth?: number | undefined }
  | { kind: "point"; x: number; y: number };

export interface BrowserViewport {
  mode: "fill" | "custom";
  width: number;
  height: number;
  deviceScaleFactor: number;
  preset: "desktop" | "tablet" | "mobile" | null;
}

export interface BrowserEnvironment {
  viewport: BrowserViewport;
  colorScheme: "light" | "dark" | "system";
  reducedMotion: boolean;
}

export interface BrowserElement {
  ref: string;
  role: string | null;
  name: string;
  description: string;
  tag: string;
  value: string | null;
  states: string[];
  disabled: boolean;
  bounds: BrowserBounds | null;
  frame: { id: string; url: string } | null;
}

export interface BrowserFocus {
  tag: string;
  role: string | null;
  name: string;
  editable: boolean;
  inFrame: boolean;
}

export interface BrowserDiagnosticEntry {
  timestamp: string;
  kind: "console" | "network" | "load";
  level: "debug" | "info" | "warning" | "error";
  message: string;
  url?: string | undefined;
  method?: string | undefined;
  status?: number | undefined;
}

export interface BrowserActionHistoryEntry {
  timestamp: string;
  action: string;
  target?: string | undefined;
  outcome: "success" | "error";
  detail?: string | undefined;
}

export interface BrowserChallenge {
  vendor: string;
  status: "cleared" | "checking" | "click-once" | "needs-user" | "blocked";
  waitedMs: number;
  target?: { kind: "point"; x: number; y: number } | undefined;
  next: string;
}

export interface BrowserSnapshot {
  tabId: string;
  revision: number;
  title: string;
  url: string;
  loading: boolean;
  viewport: BrowserViewport;
  text: string;
  elements: BrowserElement[];
  truncated: boolean;
  focus: BrowserFocus | null;
  diagnostics: BrowserDiagnosticEntry[];
  actions: BrowserActionHistoryEntry[];
  image?: { included: boolean; reason: string; width: number; height: number };
  challenge?: BrowserChallenge;
  siteMemories?: BrowserSiteMemory[];
}

export interface BrowserSiteMemory {
  id: string;
  site: string;
  text: string;
}

export interface BrowserRecordingArtifact {
  path: string;
  mimeType: "video/webm";
  bytes: number;
  durationMs: number;
  stoppedReason: "requested" | "duration-limit" | "size-limit" | "tab-closed" | "error";
}

export type BrowserJsonValue = string | number | boolean | null | BrowserJsonValue[] | BrowserJsonObject;

export interface BrowserJsonObject {
  [key: string]: BrowserJsonValue;
}

export interface BrowserPreview {
  dataUrl: string;
  width: number;
  height: number;
}

export type BrowserControlPhase = "acting" | "waiting";

export const BROWSER_CONTROL_ACTIONS = [
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
] as const;

export type BrowserControlAction = (typeof BROWSER_CONTROL_ACTIONS)[number];

export const BROWSER_CONTROL_DETAIL_ACTIONS = [
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
] as const;

export type BrowserControlDetailAction = (typeof BROWSER_CONTROL_DETAIL_ACTIONS)[number];

export interface BrowserControlSession {
  id: string;
  threadId: string;
  turnId: string;
  callId: string;
  tabId: string | null;
  action: BrowserControlAction;
  detailAction?: BrowserControlDetailAction;
  phase: BrowserControlPhase;
  startedAt: string;
}

export interface BrowserControlState {
  sessions: BrowserControlSession[];
}

export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type BrowserViewTarget = "main" | "picture-in-picture";

export interface BrowserDisplayState {
  tabs: BrowserTab[];
  activeTabId: string | null;
}

export type BrowserPictureInPictureEvent =
  | { type: "bounds-changed"; bounds: BrowserBounds }
  | { type: "dock" }
  | { type: "hide" };

export interface BrowserTabAgent {
  id: string;
  name: string;
  avatarSeed: string;
  avatarHue: AvatarHue | null;
  avatarColor?: AvatarColor | null;
  avatarUrl: string | null;
}

export type BrowserTabLabel = BrowserTabProfile & { proxy?: string | undefined };

export interface BrowserWindowTabDetails {
  tabId: string;
  control?: BrowserControlSession | undefined;
  controller?: BrowserTabAgent | undefined;
  owner?: BrowserTabAgent | undefined;
  profile?: BrowserTabLabel | undefined;
}

export interface BrowserWindowHistoryEntry {
  url: string;
  title: string;
  visits: number;
}

export interface BrowserWindowModel {
  tabs: BrowserTab[];
  activeTabId: string | null;
  details: BrowserWindowTabDetails[];
  history: BrowserWindowHistoryEntry[];
  canReopen: boolean;
  canCloseTabs: boolean;
  liveViewTabId: string | null;
  liveViewClipboard: boolean;
  shortcuts: "mac" | "pc" | null;
}

export type BrowserWindowAction =
  | { type: "activate"; tabId: string }
  | { type: "close"; tabIds: string[] }
  | { type: "new-tab"; afterId?: string | undefined }
  | { type: "duplicate"; tabId: string }
  | { type: "move"; tabId: string; index: number }
  | { type: "reopen" }
  | { type: "reload"; tabId: string }
  | { type: "stop"; tabId: string }
  | { type: "navigate"; tabId: string; direction: BrowserNavigationDirection }
  | { type: "open-address"; url: string; tabId?: string | undefined };

export type BrowserWindowEvent =
  | { type: "bounds-changed"; bounds: BrowserBounds }
  | { type: "dock" }
  | { type: "hide" }
  | { type: "action"; action: BrowserWindowAction };

export interface BrowserOpenInput {
  url: string;
  ownerThreadId?: string | null;
  ownerAgentId?: string | null;
  focus?: boolean;
}

export interface BrowserLocalSignInInput {
  tabId: string;
  url: string;
}

export interface BrowserLocalSignInEnd {
  signedIn: boolean;
}

export interface BrowserLocalSignInFinish {
  send: boolean;
  check?: boolean | undefined;
}

export interface BrowserLocalSignInResult {
  cookies: number;
  signedIn: boolean;
}

export type BrowserNavigationDirection = "back" | "forward";

export type BrowserNavigateInput =
  | { tabId: string; direction: BrowserNavigationDirection }
  | { tabId: string; url: string };

export interface BrowserVisibilityInput {
  visible: boolean;
  bounds?: BrowserBounds | undefined;
  target?: BrowserViewTarget;
}

export type BrowserLiveViewInput =
  | {
      type: "pointer";
      action: "move" | "down" | "up" | "wheel";
      x: number;
      y: number;
      sequence?: number;
      button: "left" | "middle" | "right";
      clickCount?: number;
      deltaX?: number;
      deltaY?: number;
      modifiers?: number;
    }
  | { type: "key"; action: "down" | "up" | "char"; key: string; code: string; text?: string; modifiers?: number }
  | { type: "ack"; sequence: number }
  | { type: "paste"; text: string }
  | { type: "copy" }
  | { type: "cut"; text: string };

export const BROWSER_LIVE_VIEW_MAX_PASTE_TEXT = 100_000;

export type BrowserLiveViewEvent =
  | { type: "frame"; tabId: string; sequence: number; width: number; height: number; image: Uint8Array }
  | { type: "stopped"; tabId: string; reason: string }
  | { type: "copied"; tabId: string; text: string }
  | { type: "copyTooLarge"; tabId: string };
