import type { BrowserEnvironment, BrowserPreview, BrowserTab } from "@openbot/contracts/ipc";
import type { BrowserViewContextMenu } from "@openbot/contracts/team-protocol/browser-view-v1";
import type { Deferred, Effect, Scope } from "effect";
import { BrowserWindow, type WebContents, type WebContentsView, webContents } from "electron";
import type { BrowserCdpEngine } from "./browser-cdp";
import type { BrowserDiagnostics } from "./browser-diagnostics";
import type { BrowserOperationError } from "./browser-effects";
import { isPersistableBrowserUrl } from "./browser-state";

/**
 * One tab as `BrowserHost` holds it. The host owns every tab and its lifecycle; the tab operations in
 * `browser-tab-operations.ts` only read and advance its queue, revision and secret state.
 */
/** The page a preview frame shows: its URL, its main-frame document, and the tab's capture generation. */
export interface BrowserPreviewPage {
  url: string;
  document: number;
  generation: number;
}

export interface BrowserHostTab {
  id: string;
  view: WebContentsView;
  /** WebContentsView clears its property after native destruction. Keep the handle for cleanup. */
  contents: WebContents;
  requestedUrl: string;
  openerTabId?: string;
  /** Retained document references can outlive popup closure and navigation. */
  hasSharedBrowsingContext?: boolean;
  /**
   * The current document received a secret and was kept, with its filled fields empty and no
   * readable copy of the value, so a
   * single-page sign-in can show its next step. Page code can still hold the value, so evaluation
   * and recording stay blocked in its opener group until a main-frame navigation replaces it.
   */
  secretDocument?: boolean;
  popup: boolean;
  popupFailure?: BrowserTab["popupFailure"];
  closing?: boolean;
  ownerThreadId: string | null;
  ownerAgentId: string | null;
  revision: number;
  queue: Deferred.Deferred<void>;
  scope: Scope.Closeable;
  /** Operations queued or running on `queue`, so a preview can tell the agent is working on the tab. */
  pendingOperations: number;
  /** Main-frame documents the tab has loaded. A reload keeps the URL, so a saved preview checks this too. */
  documents: number;
  /**
   * The last preview frame, with the page, document and capture generation it shows. A preview waits
   * behind the agent's actions, so the preview card shows this frame instead while the tab is busy.
   */
  preview?: (BrowserPreviewPage & { frame: BrowserPreview }) | undefined;
  /** The preview capture on `queue`, so preview requests for the same page share one capture. */
  previewCapture?:
    | (BrowserPreviewPage & { frame: Deferred.Deferred<BrowserPreview, BrowserOperationError> })
    | undefined;
  /**
   * The first load of a tab restored from disk, held back until the tab is shown or used. Each loaded
   * tab is a renderer process, and a restart would otherwise start one for every saved tab at once.
   */
  pendingRestore?: (() => Effect.Effect<void, BrowserOperationError>) | undefined;
  /**
   * An idle agent tab whose page was unloaded to free its renderer's memory. The title and the last
   * preview frame stand in for the page until `pendingRestore` loads it again.
   */
  sleeping?: { title: string; preview: BrowserPreview | null } | undefined;
  /** When a person or an agent last used the tab. A preview request does not count as use. */
  lastUsedAt: number;
  focusOnVisible: boolean;
  environment: BrowserEnvironment;
  engine: BrowserCdpEngine;
  diagnostics: BrowserDiagnostics;
  recording: boolean;
  captureGeneration: number;
  viewInvalidations: Set<() => void>;
  /**
   * The live view that made the last right-click, until the menu of that click opens. The menu then
   * goes to that view, and does not open on this screen.
   */
  viewContextMenu: { deliver: (menu: BrowserViewContextMenu) => void; until: number } | null;
  /** The host of the last page reported as a site visit, so a navigation inside one site is not reported again. */
  visitedHost?: string | undefined;
  // Pending consent permits human takeover; submission blocks captures until document replacement.
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
    title: tab.secret ? "Secure authentication" : restoredTabTitle(tab) || tab.contents.getTitle() || "New tab",
    url: tab.secret?.origin ?? currentTabUrl(tab),
    loading: tab.contents.isLoading(),
    ownerThreadId: tab.ownerThreadId,
    ownerAgentId: tab.ownerAgentId,
    environment,
    recording: tab.recording,
    diagnosticErrorCount: tab.diagnostics.errorCount,
    ...(tab.openerTabId ? { openerTabId: tab.openerTabId } : {}),
    ...(tab.popupFailure ? { popupFailure: tab.popupFailure } : {}),
  };
}

/**
 * A restored or sleeping tab that has not loaded yet shows a blank page; its last title, or else its
 * host name, stands in for its title.
 */
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
