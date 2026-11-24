// HeadlessBrowserHost: implements every browser surface the server code can reach for
// — the AgentBrowserHost of src/backend/agent/turn-lifecycle.ts (with its
// AttentionBrowserHost and BrowserUploadTarget bases) and the TeamApiBrowser pick of
// src/main/team-api/dependencies.ts — with clear refusals. On a headless phone host
// there is no Chromium and no display for it: browser tools answer with an error,
// never a crash, and the 9 Electron-bound files under src/backend/browser-*.ts never
// load in this process. This is the declared "descarte browser" of the project.
//
// Contract kept: the constructor-time subscriptions (onChanged/onControlChanged/
// onDocumentChanged) must return an unsubscribe and never throw, or the AgentService
// boot dies; cleanups are silent no-ops; queries return null; actions refuse.

import { Effect } from "effect";

function refuse(name: string): never {
  throw new Error(`browser tools are not available on the headless host (${name})`);
}

function refuseEffect(name: string) {
  return Effect.try(() => refuse(name));
}

export class HeadlessBrowserHost {
  readonly headless = true as const;

  // --- constructor-time subscriptions: never throw, return unsubscribe ------------
  onChanged(): () => void {
    return () => undefined;
  }
  onControlChanged(): () => void {
    return () => undefined;
  }
  onDocumentChanged(): () => void {
    return () => undefined;
  }

  // --- cleanups: silent no-ops ------------------------------------------------------
  clearControls(): void {}
  endControl(): void {}
  shareTab(): void {}
  unshareThread(): void {}
  endTakeover(): void {}

  // --- queries: empty answers ---------------------------------------------------------
  listTabs(): never[] {
    return [];
  }
  agentTab(): null {
    return null;
  }
  userControlTabFor(): string | null {
    return null;
  }
  takeoverSignInArrived(): boolean {
    return false;
  }
  toolCanUseTab(): boolean {
    return false;
  }
  isPrivate(): boolean {
    return false;
  }
  getControlState(): { userControl: false } {
    return { userControl: false };
  }
  getDisplayState(): { visible: false } {
    return { visible: false };
  }

  // --- actions: refuse ---------------------------------------------------------------
  open() {
    return refuseEffect("open");
  }
  activate() {
    return refuseEffect("activate");
  }
  navigate() {
    return refuseEffect("navigate");
  }
  reload() {
    return refuseEffect("reload");
  }
  close() {
    return refuseEffect("close");
  }
  capturePreview() {
    return refuseEffect("capturePreview");
  }
  setVisible() {
    return refuseEffect("setVisible");
  }
  loadUrl() {
    return refuseEffect("loadUrl");
  }
  takeUserControl() {
    return refuseEffect("takeUserControl");
  }
  releaseUserControl() {
    return refuseEffect("releaseUserControl");
  }
  releaseUserControlHeldBy() {
    return refuseEffect("releaseUserControlHeldBy");
  }
  beginTakeover() {
    return refuseEffect("beginTakeover");
  }
  clearAgentSession() {
    return refuseEffect("clearAgentSession");
  }
  awaitUserControlRelease() {
    return refuseEffect("awaitUserControlRelease");
  }
  handleDynamicTool() {
    return refuseEffect("handleDynamicTool");
  }
  prepareSecret() {
    return refuseEffect("prepareSecret");
  }
  resolveUploadTarget() {
    return refuseEffect("resolveUploadTarget");
  }
}
