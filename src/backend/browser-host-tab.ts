import type { BrowserEnvironment, BrowserPreview, BrowserTab } from "@openbot/contracts/ipc";
import type { BrowserViewContextMenu } from "@openbot/contracts/team-protocol/browser-view-v1";
import type { Deferred, Effect, Scope } from "effect";
import { BrowserWindow, type Session, type WebContents, type WebContentsView, webContents } from "electron";
import type { BrowserCdpEngine } from "./browser-cdp";
import type { BrowserDiagnostics } from "./browser-diagnostics";
import type { BrowserOperationError } from "./browser-effects";
import { type BrowserTabSession, isPersistableBrowserUrl } from "./browser-state";

export interface BrowserPreviewPage {
  url: string;
  document: number;
  generation: number;
}

export interface BrowserHostTab {
  id: string;
  view: WebContentsView;
  contents: WebContents;
  requestedUrl: string;
  openerTabId?: string;
  hasSharedBrowsingContext?: boolean;
  secretDocument?: boolean;
  secretShown?: boolean;
  filledCard?: boolean;
  scriptedOrigins?: Set<string>;
  workerExposedOrigins?: Set<string>;
  privateSession?: Session;
  tabSession?: BrowserTabSession;
  popup: boolean;
  popupFailure?: BrowserTab["popupFailure"];
  closing?: boolean;
  ownerThreadId: string | null;
  ownerAgentId: string | null;
  sharedThreadIds?: Set<string>;
  revision: number;
  operations?: number;
  image?: { operation: number; url: string; taken: number };
  queue: Deferred.Deferred<void>;
  scope: Scope.Closeable;
  pendingOperations: number;
  opening?: boolean;
  crashes?: number;
  documents: number;
  challengeWait?: { document: number; waitedMs: number };
  challengeClick?: { document: number; waited: boolean };
  checkOrigin?: string;
  checkAfterTakeover?: string;
  siteRecall?: { turnId: string; host: string };
  preview?: (BrowserPreviewPage & { frame: BrowserPreview }) | undefined;
  previewCapture?:
    | (BrowserPreviewPage & { frame: Deferred.Deferred<BrowserPreview, BrowserOperationError> })
    | undefined;
  pendingRestore?: (() => Effect.Effect<void, BrowserOperationError>) | undefined;
  sleeping?: { title: string; preview: BrowserPreview | null } | undefined;
  idleUnloadNoted?: Set<string>;
  lastUsedAt: number;
  lastToolChat?: { threadId: string; at: number } | undefined;
  focusOnVisible: boolean;
  focusOnCommit?: boolean | undefined;
  focusedAtPageClose?: boolean | undefined;
  environment: BrowserEnvironment;
  engine: BrowserCdpEngine;
  diagnostics: BrowserDiagnostics;
  recording: boolean;
  captureGeneration: number;
  loadGeneration: number;
  viewInvalidations: Set<() => void>;
  viewContextMenu: { deliver: (menu: BrowserViewContextMenu) => void; until: number } | null;
  visitedHost?: string | undefined;
  secret?: { origin: string; submitted: boolean; replaced: boolean; running: boolean } | undefined;
}

export type KeepQueueBlocked = (work: Effect.Effect<unknown, BrowserOperationError>) => void;

export function restoreWebContentsFocus(previous: WebContents | null, controlled: WebContents): void {
  const current = webContents.getFocusedWebContents();
  if (current && current !== controlled) return;
  if (previous && !previous.isDestroyed()) {
    const window = BrowserWindow.fromWebContents(previous);
    if (window && !window.isDestroyed()) window.focus();
    previous.focus();
  }
}

export function hasHistoryEntry(contents: WebContents, offset: -1 | 1): boolean {
  const history = contents.navigationHistory;
  return history.canGoToOffset(offset) && Boolean(history.getEntryAtIndex(history.getActiveIndex() + offset)?.url);
}

export function toPublicTab(tab: BrowserHostTab): BrowserTab {
  const environment =
    tab.environment.viewport.mode === "fill"
      ? {
          ...tab.environment,
          viewport: {
            ...tab.environment.viewport,
            width: tab.view.getBounds().width,
            height: tab.view.getBounds().height,
          },
        }
      : tab.environment;
  return {
    id: tab.id,
    title: tab.secret
      ? "Secure authentication"
      : restoredTabTitle(tab) || tab.engine.scrubText(tab.contents.getTitle()) || "New tab",
    url: tab.secret?.origin ?? currentTabUrl(tab),
    loading: tab.contents.isLoading(),
    ownerThreadId: tab.ownerThreadId,
    ownerAgentId: tab.ownerAgentId,
    environment,
    recording: tab.recording,
    diagnosticErrorCount: tab.diagnostics.errorCount,
    canGoBack: hasHistoryEntry(tab.contents, -1),
    canGoForward: hasHistoryEntry(tab.contents, 1),
    ...(tab.openerTabId ? { openerTabId: tab.openerTabId } : {}),
    ...(tab.popupFailure ? { popupFailure: tab.popupFailure } : {}),
  };
}

function restoredTabTitle(tab: BrowserHostTab): string | null {
  if (!tab.pendingRestore) return null;
  if (tab.sleeping?.title) return tab.sleeping.title;
  try {
    return new URL(tab.requestedUrl).hostname || null;
  } catch {
    return null;
  }
}

export function currentTabUrl(tab: BrowserHostTab): string {
  const currentUrl = tab.contents.getURL();
  return isPersistableBrowserUrl(currentUrl) ? currentUrl : tab.requestedUrl;
}
