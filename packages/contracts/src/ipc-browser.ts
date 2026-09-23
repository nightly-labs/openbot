export interface BrowserTab {
  id: string;
  title: string;
  url: string;
  loading: boolean;
  ownerThreadId: string | null;
  ownerAgentId: string | null;
  /** Browser Automation V2 metadata. Optional to keep Team API protocol v1 wire-compatible. */
  environment?: BrowserEnvironment;
  recording?: boolean;
  diagnosticErrorCount?: number;
  /** Live local popup relationship; not restored after an app restart. */
  openerTabId?: string;
  /** Local popup failure, without authentication URLs or request data. */
  popupFailure?: { id: string; message: string };
}

export type BrowserImageMode = "auto" | "always" | "never";

export type BrowserTarget =
  | { kind: "ref"; ref: string; revision: number }
  | { kind: "role"; role: string; name?: string; exact?: boolean }
  | { kind: "text"; text: string; exact?: boolean }
  | { kind: "css"; selector: string }
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
  /** Legacy convenience field; the canonical state is also present in states. */
  disabled: boolean;
  bounds: BrowserBounds | null;
  frame: { id: string; url: string } | null;
}

/**
 * Where a keystroke sent without a target arrives. An application that draws its own surface keeps
 * the focus itself, so this is the only way a caller can tell whether typing will reach the cell it
 * means to fill or the box it last used.
 */
export interface BrowserFocus {
  tag: string;
  role: string | null;
  name: string;
  /** True when the node takes text directly: an input, a textarea, or a contenteditable. */
  editable: boolean;
  /** True when the focused node is inside a frame rather than the main document. */
  inFrame: boolean;
}

export interface BrowserDiagnosticEntry {
  timestamp: string;
  kind: "console" | "network" | "load";
  level: "debug" | "info" | "warning" | "error";
  message: string;
  url?: string;
  method?: string;
  status?: number;
}

export interface BrowserActionHistoryEntry {
  timestamp: string;
  action: string;
  target?: string;
  outcome: "success" | "error";
  detail?: string;
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
  focus: BrowserFocus | null;
  diagnostics: BrowserDiagnosticEntry[];
  actions: BrowserActionHistoryEntry[];
  image?: { included: boolean; reason: string; width: number; height: number };
}

export interface BrowserRecordingArtifact {
  path: string;
  mimeType: "video/webm";
  bytes: number;
  durationMs: number;
  stoppedReason: "requested" | "duration-limit" | "size-limit" | "tab-closed" | "error";
}

/**
 * A JSON value produced by a browser evaluation. The engine round-trips every result through
 * `JSON.stringify` before returning it, so this is the widest shape a caller can observe.
 */
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

export type BrowserControlAction =
  | "open"
  | "list-tabs"
  | "snapshot"
  | "click"
  | "type"
  | "key"
  | "scroll"
  | "back"
  | "forward"
  | "reload"
  | "screenshot"
  | "close-tab";

export type BrowserControlDetailAction =
  | "status"
  | "navigate"
  | "press"
  | "hover"
  | "select-option"
  | "set-checked"
  | "drag"
  | "upload-files"
  | "wait-for"
  | "evaluate"
  | "set-environment"
  | "recording-start"
  | "recording-stop";

export interface BrowserControlSession {
  id: string;
  threadId: string;
  turnId: string;
  callId: string;
  tabId: string | null;
  action: BrowserControlAction;
  /** Local V2 UI detail. Team API v1 projection intentionally strips this optional field. */
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

export interface BrowserOpenInput {
  url: string;
  ownerThreadId?: string | null;
  ownerAgentId?: string | null;
  focus?: boolean;
}

export type BrowserNavigationDirection = "back" | "forward";

export type BrowserNavigateInput =
  | { tabId: string; direction: BrowserNavigationDirection }
  | { tabId: string; url: string };

export interface BrowserVisibilityInput {
  visible: boolean;
  bounds?: BrowserBounds;
  target?: BrowserViewTarget;
}

/**
 * A pointer or key event the user made over a live view of a remote tab, or the frame the view
 * has drawn. The acknowledgement is how a view that nobody clicks still tells the host which
 * frames it has left behind.
 *
 * Coordinates are a fraction of the frame the user was looking at, not pixels. The renderer draws a
 * frame at whatever size its panel is and the host's viewport is a third size again, so pixels would
 * mean one side has to know the other's scale. This mirrors the Team protocol's own input shape
 * rather than importing it: the wire may version, and the renderer's API must not move when it does.
 */
export type BrowserLiveViewInput =
  | {
      type: "pointer";
      action: "move" | "down" | "up" | "wheel";
      x: number;
      y: number;
      /** The frame the fraction belongs to, so the host expands it against that frame and no other. */
      sequence?: number;
      button: "left" | "middle" | "right";
      clickCount?: number;
      deltaX?: number;
      deltaY?: number;
      modifiers?: number;
    }
  | { type: "key"; action: "down" | "up" | "char"; key: string; code: string; text?: string; modifiers?: number }
  | { type: "ack"; sequence: number };

/** What a live view sends the renderer. The image is the host's own JPEG, not a data URL. */
export type BrowserLiveViewEvent =
  | { type: "frame"; tabId: string; sequence: number; width: number; height: number; image: Uint8Array }
  | { type: "stopped"; tabId: string; reason: string };
