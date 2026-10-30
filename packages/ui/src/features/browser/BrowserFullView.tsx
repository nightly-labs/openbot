import { Alert, AlertContent, AlertDescription, AlertTitle, Button, Minimize2, Tabs } from "@openbot/ui";
import { CloseIcon, PlusIcon } from "@openbot/ui/features/conversation/ConversationIcons";
import { useText } from "@openbot/ui/text";
import { clamp } from "@openbot/ui/utils";
import { createEffect, createSignal, flush, onSettled, Show } from "solid-js";
import { BrowserAddressRow } from "./BrowserAddressRow";
import BrowserLiveView from "./BrowserLiveView";
import { BrowserTabStrip } from "./BrowserTabStrip";
import { BrowserTabSwitcher } from "./BrowserTabSwitcher";
import type { BrowserFullViewProps } from "./browser-full-view-types";
import { BrowserPageCover } from "./browser-page-cover";
import { type BrowserViewCommand, browserAriaShortcut, browserViewCommand } from "./browser-view-shortcuts";

export type { BrowserFullViewProps } from "./browser-full-view-types";

/** Below this width the chips do not fit: one button with the tab count opens the list of tabs. */
const NARROW_QUERY = "(max-width: 720px)";

function createNarrow() {
  const query = window.matchMedia(NARROW_QUERY);
  const [narrow, setNarrow] = createSignal(query.matches);
  onSettled(() => {
    const change = () => setNarrow(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  });
  return narrow;
}

/**
 * The browser as a full view: every tab in the top row, the address row and the page in the card, and
 * the dock of the tab's agent over the page. With `shortcuts`, the keys of other browsers work here.
 */
export default function BrowserFullView(props: BrowserFullViewProps) {
  const { t, sourceText } = useText();
  const narrow = createNarrow();
  const [dismissedPopupFailures, setDismissedPopupFailures] = createSignal<ReadonlySet<string>>(new Set());
  const popupFailure = () => props.activeTab?.popupFailure;
  /**
   * The shape of the host's page. A live view takes that shape rather than the window's, so the page
   * fills its surface instead of sitting between bars.
   */
  const [frameSize, setFrameSize] = createSignal<{ width: number; height: number } | undefined>(undefined, {
    equals: (previous, next) => previous?.width === next?.width && previous?.height === next?.height,
  });
  const live = () => props.liveViewTabId !== null;
  const canClose = () => props.canCloseTabs !== false;
  let hideButton: HTMLButtonElement | undefined;
  let view: HTMLElement | undefined;
  let surfaceElement: HTMLDivElement | undefined;
  let address: HTMLInputElement | undefined;

  const [settled, setSettled] = createSignal(false);
  const [covers, setCovers] = createSignal<ReadonlySet<symbol>>(new Set());
  const cover = () => {
    const key = Symbol();
    setCovers((current) => new Set(current).add(key));
    return () =>
      setCovers((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
  };

  createEffect(
    () => props.open,
    (open) => {
      setSettled(false);
      if (!open) return;
      let disposed = false;
      onSettled(() => {
        hideButton?.focus();
        // Chromium is a native child view. Attach it only after the CSS view settles.
        const animations = view?.getAnimations() ?? [];
        const settle = () => {
          if (!disposed) setSettled(true);
        };
        if (animations.length === 0) settle();
        else void Promise.all(animations.map((animation) => animation.finished)).then(settle, () => undefined);
      });
      return () => {
        disposed = true;
      };
    },
  );

  // The page is drawn above this window, so it is hidden while a menu of the view is open.
  createEffect(
    () => props.open && settled() && covers().size === 0,
    (shown) => props.onSurface(shown ? surfaceElement : undefined),
  );

  const focusAddress = () => {
    flush();
    address?.focus();
    address?.select();
  };
  const newTab = (afterId?: string) => {
    void props.onNewTab(afterId).then(focusAddress, () => undefined);
  };
  const closeTabs = (tabIds: readonly string[]) => {
    if (canClose() && tabIds.length > 0) props.onCloseTabs(tabIds);
  };

  const run = (command: BrowserViewCommand) => {
    const tabs = props.tabs;
    const active = props.activeTab;
    const index = tabs.findIndex((tab) => tab.id === active?.id);
    switch (command.kind) {
      case "select": {
        const tab = tabs[(index + command.offset + tabs.length) % tabs.length];
        if (tab) props.onActivateTab(tab.id);
        return;
      }
      case "selectIndex": {
        const tab = command.index === "last" ? tabs.at(-1) : tabs[command.index];
        if (tab) props.onActivateTab(tab.id);
        return;
      }
      case "move":
        if (active && index >= 0) {
          const to = clamp(index + command.offset, 0, tabs.length - 1);
          if (to !== index) props.onMoveTab(active.id, to);
        }
        return;
      case "newTab":
        newTab();
        return;
      case "reopen":
        if (props.canReopen) props.onReopenTab();
        return;
      case "close":
        if (active) closeTabs([active.id]);
        return;
      case "focusAddress":
        focusAddress();
        return;
      case "reload":
        if (active?.url) props.onReload(active.id);
        return;
      case "back":
      case "forward":
        if (active) props.onNavigate(active.id, command.kind);
        return;
    }
  };

  // The keys of other browsers. The capture phase runs before the server rail (⌘1–9) and the app
  // menu (⌘R), so a key here acts on the tabs and not on the window.
  createEffect(
    () => (props.open ? props.shortcuts : undefined),
    (platform) => {
      if (!platform) return;
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.isComposing || event.keyCode === 229 || event.defaultPrevented) return;
        // A menu or a dialog over the view has the focus: its keys are its own.
        if (event.target instanceof Element && event.target.closest("[role=dialog], [role=alertdialog], [role=menu]"))
          return;
        const command = browserViewCommand(event, platform);
        if (!command) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        run(command);
      };
      window.addEventListener("keydown", onKeyDown, true);
      return () => window.removeEventListener("keydown", onKeyDown, true);
    },
  );

  const hideBrowserButton = () => (
    <Button
      variant="ghost"
      size="icon-sm"
      ref={(element) => (hideButton = element)}
      class="no-drag browser-hide"
      aria-label={t("browser.hide")}
      title={t("browser.hide")}
      data-cuelume-tap="close"
      onClick={props.onBack}
    >
      <Minimize2 aria-hidden="true" />
    </Button>
  );

  return (
    <Tabs.Root
      as="section"
      ref={(element: HTMLElement) => (view = element)}
      hidden={!props.open}
      aria-hidden={props.open ? undefined : "true"}
      inert={!props.open}
      id="browser-expanded-panel"
      class={[
        "browser-full-view",
        {
          "browser-full-view-mac-controls": props.macWindowControls === true,
        },
      ]}
      style={
        live() && frameSize()
          ? `--browser-frame-width: ${frameSize()?.width}; --browser-frame-height: ${frameSize()?.height};`
          : undefined
      }
      aria-label={t("browser.panel.label")}
      value={props.activeTab?.id ?? "__empty"}
      activationMode="automatic"
    >
      <div class="browser-full-top window-drag">
        <BrowserPageCover value={cover}>
          <Show
            when={narrow()}
            fallback={
              <>
                <BrowserTabStrip view={props} onNewTab={newTab} onClose={closeTabs} />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  class="no-drag"
                  aria-label={t("browser.newTab")}
                  aria-keyshortcuts={browserAriaShortcut("newTab", props.shortcuts)}
                  title={t("browser.newTab")}
                  onClick={() => newTab()}
                >
                  <PlusIcon />
                </Button>
              </>
            }
          >
            <BrowserTabSwitcher view={props} onNewTab={() => newTab()} onClose={closeTabs} />
          </Show>
        </BrowserPageCover>
        <div class="browser-full-top-spacer" />
        {hideBrowserButton()}
      </div>
      <div class="browser-full-card">
        {/* The narrow row has no tab list, so the panel names itself. */}
        <Tabs.Content
          forceMount
          value={props.activeTab?.id ?? "__empty"}
          aria-label={!narrow() && props.activeTab ? undefined : t("browser.panel.label")}
          class="browser-full-browser"
        >
          <BrowserPageCover value={cover}>
            <BrowserAddressRow
              view={props}
              narrow={narrow()}
              onNewTab={() => newTab()}
              ref={(element) => {
                address = element;
              }}
            />
          </BrowserPageCover>
          <Show when={popupFailure() && !dismissedPopupFailures().has(popupFailure()?.id ?? "")}>
            <Alert tone="warning" role="alert" class="browser-full-alert">
              <AlertContent>
                <AlertTitle>{t("browser.popupBlocked.title")}</AlertTitle>
                <AlertDescription>{sourceText(popupFailure()?.message ?? "")}</AlertDescription>
              </AlertContent>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t("browser.popupBlocked.dismiss")}
                data-cuelume-tap="close"
                onClick={() => {
                  const failure = popupFailure();
                  if (failure) setDismissedPopupFailures((current) => new Set([...current, failure.id]));
                }}
              >
                <CloseIcon />
              </Button>
            </Alert>
          </Show>
          <div
            class="browser-surface browser-full-surface"
            data-live={live() ? "" : undefined}
            ref={(element) => (surfaceElement = element)}
          >
            <Show when={props.liveViewTabId}>
              {(tabId) => (
                <BrowserLiveView
                  runtime={props.liveViewRuntime}
                  tabId={tabId()}
                  active={props.open}
                  clipboard={props.liveViewClipboard}
                  onFrameSize={setFrameSize}
                />
              )}
            </Show>
            <Show when={props.open && props.tabs.length > 0}>{props.dock}</Show>
            <Show when={props.tabs.length === 0}>
              <div class="browser-empty-state">
                <strong>{t("browser.empty.title")}</strong>
                <span>{t("browser.empty.description")}</span>
              </div>
            </Show>
          </div>
        </Tabs.Content>
      </div>
      {props.dialogs}
    </Tabs.Root>
  );
}
