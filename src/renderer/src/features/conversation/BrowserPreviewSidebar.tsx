import type { BrowserPreview, BrowserTab } from "@openbot/contracts/ipc";
import { createEffect, createSignal, createStore, For, onSettled, Show } from "solid-js";
import { PanelResizer, readPanelWidth, savePanelWidth } from "../../components/PanelResizer";
import { Button, ChevronRight, Monitor, Plus, Skeleton, X } from "../../components/ui";

const BROWSER_PANEL_STORAGE_KEY = "openbot:browser-preview-panel-width";
const BROWSER_PANEL_MIN = 220;
const BROWSER_PANEL_MAX = 1600;

interface BrowserPreviewSidebarProps {
  tabs: BrowserTab[];
  hidden: boolean;
  suspended: boolean;
  contextKey: string;
  defaultWidth: () => number;
  maxWidth: () => number;
  onWidthChange: (width: number) => void;
  onOpenTab: (tabId: string, trigger: HTMLButtonElement) => void;
  onCloseTab: (tabId: string) => void;
  onNewTab: () => void;
  onCollapse: () => void;
}

export default function BrowserPreviewSidebar(props: BrowserPreviewSidebarProps) {
  const defaultPanelWidth = () =>
    Math.round(Math.min(BROWSER_PANEL_MAX, Math.max(BROWSER_PANEL_MIN, props.defaultWidth())));
  const storedPanelWidth = Number.parseFloat(window.localStorage.getItem(BROWSER_PANEL_STORAGE_KEY) ?? "");
  let customPanelWidth = Number.isFinite(storedPanelWidth);
  let savedCustomPanelWidth = customPanelWidth ? storedPanelWidth : null;
  const [panelWidth, setPanelWidth] = createSignal(
    readPanelWidth(BROWSER_PANEL_STORAGE_KEY, defaultPanelWidth(), BROWSER_PANEL_MIN, BROWSER_PANEL_MAX),
  );
  createEffect(
    () => panelWidth(),
    (width) => {
      props.onWidthChange(width);
    },
  );

  const resizePanel = (width: number) => {
    setPanelWidth(width);
  };

  const saveCustomPanelWidth = (width: number) => {
    customPanelWidth = true;
    savedCustomPanelWidth = width;
    savePanelWidth(BROWSER_PANEL_STORAGE_KEY, width);
  };

  const resizeDefaultPanel = () => {
    const preferredWidth =
      customPanelWidth && savedCustomPanelWidth !== null ? savedCustomPanelWidth : defaultPanelWidth();
    setPanelWidth(Math.round(Math.min(props.maxWidth(), Math.max(BROWSER_PANEL_MIN, preferredWidth))));
  };

  const resetPanelWidth = () => {
    window.localStorage.removeItem(BROWSER_PANEL_STORAGE_KEY);
    customPanelWidth = false;
    savedCustomPanelWidth = null;
    setPanelWidth(defaultPanelWidth());
  };

  return (
    <aside
      id="browser-side-panel"
      class="browser-panel browser-preview-sidebar"
      aria-label="Browser previews"
      hidden={props.hidden}
    >
      <PanelResizer
        class="right-panel-resizer"
        label="Resize right panel"
        controls="browser-side-panel"
        direction="right"
        value={panelWidth()}
        defaultValue={defaultPanelWidth()}
        min={BROWSER_PANEL_MIN}
        max={props.maxWidth}
        onResize={resizePanel}
        onResizeEnd={saveCustomPanelWidth}
        onParentResize={resizeDefaultPanel}
        onReset={resetPanelWidth}
      />

      <header class="browser-preview-header">
        <span>Browser</span>
        <Button variant="ghost" size="icon-sm" aria-label="New browser tab" onClick={props.onNewTab}>
          <Plus />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Collapse browser previews" onClick={props.onCollapse}>
          <ChevronRight />
        </Button>
      </header>
      <div class="browser-preview-list">
        <For each={props.tabs} keyed={(tab) => tab.id}>
          {(tab) => (
            <BrowserPreviewCard
              tab={tab()}
              contextKey={props.contextKey}
              enabled={!props.hidden && !props.suspended}
              onOpen={props.onOpenTab}
              onClose={props.onCloseTab}
            />
          )}
        </For>
        <Show when={props.tabs.length === 0}>
          <div class="browser-empty-state">
            <Monitor aria-hidden="true" />
            <strong>No browser tabs</strong>
            <Button variant="secondary" size="sm" onClick={props.onNewTab}>
              Open a page
            </Button>
          </div>
        </Show>
      </div>
    </aside>
  );
}

export function BrowserPreviewCard(props: {
  tab: BrowserTab;
  contextKey: string;
  enabled: boolean;
  onOpen: (tabId: string, trigger: HTMLButtonElement) => void;
  onClose: (tabId: string) => void;
}) {
  const [state, setState] = createStore<{ preview: BrowserPreview | null; failed: boolean }>({
    preview: null,
    failed: false,
  });
  const [visible, setVisible] = createSignal(false);
  const [documentVisible, setDocumentVisible] = createSignal(!document.hidden);
  let element: HTMLDivElement | undefined;
  let pending: Promise<void> | undefined;
  const title = () => props.tab.title || props.tab.url || "Browser page";

  onSettled(() => {
    const observer = new IntersectionObserver((entries) => setVisible(entries.some((entry) => entry.isIntersecting)));
    if (element) observer.observe(element);
    const visibilityChanged = () => setDocumentVisible(!document.hidden);
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  });

  createEffect(
    () => JSON.stringify([props.contextKey, props.tab.id, props.tab.url]),
    () => setState(() => ({ preview: null, failed: false })),
  );
  createEffect(
    () => ({
      context: props.contextKey,
      id: props.tab.id,
      url: props.tab.url,
      loading: props.tab.loading,
      enabled: props.enabled && visible() && documentVisible(),
    }),
    ({ id, enabled }) => {
      if (!enabled) return;
      let disposed = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const refresh = () => {
        if (disposed) return;
        if (pending) {
          void pending.then(refresh);
          return;
        }
        pending = window.openbot.browser
          .capturePreview(id)
          .then((preview) => {
            if (!disposed) setState(() => ({ preview, failed: false }));
          })
          .catch(() => {
            if (!disposed) setState(() => ({ preview: null, failed: true }));
          })
          .finally(() => {
            pending = undefined;
            if (!disposed) timer = setTimeout(refresh, 3000);
          });
      };
      refresh();
      return () => {
        disposed = true;
        if (timer) clearTimeout(timer);
      };
    },
  );

  return (
    <div ref={(node) => (element = node)} class="browser-preview-card">
      <Button
        variant="ghost"
        class="browser-preview-open"
        aria-label={`Open ${title()}`}
        onClick={(event) => props.onOpen(props.tab.id, event.currentTarget)}
      >
        <span class="browser-preview-image">
          <Show
            when={state.preview}
            fallback={state.failed ? <Monitor aria-hidden="true" /> : <Skeleton class="browser-preview-loading" />}
          >
            {(preview) => (
              <img
                src={preview().dataUrl}
                width={preview().width}
                height={preview().height}
                alt={`Preview of ${title()}`}
              />
            )}
          </Show>
        </span>
        <span class="browser-preview-title" title={title()}>
          {title()}
        </span>
      </Button>
      <Button
        variant="secondary"
        size="icon-sm"
        class="browser-preview-close"
        aria-label={`Close ${title()}`}
        onClick={() => props.onClose(props.tab.id)}
      >
        <X />
      </Button>
    </div>
  );
}
