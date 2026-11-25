import { Alert, AlertContent, AlertDescription, AlertTitle, ArrowLeft, Button, Tabs } from "@openbot/ui";
import { CloseIcon, PlusIcon } from "@openbot/ui/features/conversation/ConversationIcons";
import { useText } from "@openbot/ui/text";
import { clamp, holdFlag } from "@openbot/ui/utils";
import { createEffect, createMemo, createSignal, flush, onCleanup, onSettled, Show } from "solid-js";
import { BrowserAddressRow } from "./BrowserAddressRow";
import BrowserLiveView from "./BrowserLiveView";
import { BrowserTabStrip } from "./BrowserTabStrip";
import { BrowserTabSwitcher } from "./BrowserTabSwitcher";
import { BrowserTeachBar } from "./BrowserTeachBar";
import type { BrowserFullViewProps } from "./browser-full-view-types";
import { BrowserPageCover, menuCoversPage } from "./browser-page-cover";
import { type BrowserViewCommand, browserAriaShortcut, browserViewCommand } from "./browser-view-shortcuts";

export type { BrowserFullViewProps } from "./browser-full-view-types";

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

export default function BrowserFullView(props: BrowserFullViewProps) {
  const { t, sourceText } = useText();
  if (!props.pane) onCleanup(holdFlag(document.body, "browser-full-view"));
  const narrow = createNarrow();
  const [dismissedPopupFailures, setDismissedPopupFailures] = createSignal<ReadonlySet<string>>(new Set());
  const popupFailure = () => props.activeTab?.popupFailure;
  const [frameSize, setFrameSize] = createSignal<{ width: number; height: number } | undefined>(undefined, {
    equals: (previous, next) => previous?.width === next?.width && previous?.height === next?.height,
  });
  const live = () => props.liveViewTabId !== null;
  const canClose = () => props.canCloseTabs !== false;
  const recording = () => typeof props.teach?.startedAt === "number";
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

  const viewOpen = createMemo(() => props.open);
  createEffect(viewOpen, (open) => {
    setSettled(false);
    if (!open) return;
    let disposed = false;
    onSettled(() => {
      hideButton?.focus();
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
  });

  const [overlapped, setOverlapped] = createSignal(false);
  createEffect(
    () => props.coveringMenus ?? [],
    (menus) => {
      if (menus.length === 0) {
        setOverlapped(false);
        return;
      }
      let frame = 0;
      const measure = () => {
        const surface = surfaceElement;
        setOverlapped(surface !== undefined && menus.some((menu) => menuCoversPage(surface, menu)));
        frame = requestAnimationFrame(measure);
      };
      measure();
      return () => cancelAnimationFrame(frame);
    },
  );

  createEffect(
    () => viewOpen() && settled() && covers().size === 0 && !overlapped(),
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

  createEffect(
    () => (props.open ? props.shortcuts : undefined),
    (platform) => {
      if (!platform) return;
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.isComposing || event.keyCode === 229 || event.defaultPrevented) return;
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
      variant="secondary"
      size="sm"
      ref={(element) => (hideButton = element)}
      class="no-drag browser-hide"
      data-cuelume-tap="close"
      onClick={props.onBack}
    >
      <ArrowLeft aria-hidden="true" />
      {props.detached ? t("browser.pip.reattachTitle") : t("browser.backToChat")}
    </Button>
  );

  const fullViewIdentity = () => (props.pane ? {} : { id: "browser-expanded-panel" });

  return (
    <Tabs.Root
      as="section"
      ref={(element: HTMLElement) => (view = element)}
      hidden={!props.open}
      aria-hidden={props.open ? undefined : "true"}
      inert={!props.open}
      {...fullViewIdentity()}
      class={[
        "browser-full-view",
        {
          "browser-full-view-mac-controls": props.macWindowControls === true,
          "browser-pane-view": props.pane === true,
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
      <Show when={!props.pane}>
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
      </Show>
      <div class="browser-full-card">
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
          <Show when={props.teach}>
            {(teach) => (
              <BrowserTeachBar
                agentName={teach().agentName}
                startedAt={teach().startedAt}
                pending={teach().pending}
                onStart={() => teach().onStart()}
                onSave={() => teach().onSave()}
                onClose={() => teach().onClose()}
              />
            )}
          </Show>
          <div
            class="browser-surface browser-full-surface"
            data-live={live() ? "" : undefined}
            data-teach-recording={recording() ? "" : undefined}
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
            <Show when={props.open && props.tabs.length > 0 && !props.teach}>{props.dock}</Show>
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
