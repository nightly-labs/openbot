import type { BrowserPreview, BrowserTab } from "@openbot/contracts/ipc";
import { Button, ChevronRight, Maximize2, Monitor, Plus, Skeleton, X } from "@openbot/ui";
import { PanelResizer } from "@openbot/ui/components/PanelResizer";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, createStore, For, onSettled, Show } from "solid-js";

const BROWSER_PANEL_MIN = 220;
const BROWSER_PANEL_MAX = 1600;

interface BrowserPreviewSidebarProps {
  capturePreview?: (tabId: string) => Promise<BrowserPreview>;
  readWidth: (fallback: number, min: number, max: number) => number;
  readCustomWidth: () => number;
  saveWidth: (width: number) => void;
  resetWidth: () => void;
  tabs: BrowserTab[];
  hidden: boolean;
  suspended: boolean;
  contextKey: string;
  defaultWidth: () => number;
  maxWidth: () => number;
  onWidthChange: (width: number) => void;
  onOpenTab: (tabId: string, trigger: HTMLButtonElement) => void;
  onCloseTab?: (tabId: string) => void;
  onNewTab?: () => void;
  onCollapse: () => void;
}

export default function BrowserPreviewSidebar(props: BrowserPreviewSidebarProps) {
  const { t } = useText();
  const defaultPanelWidth = () =>
    Math.round(Math.min(BROWSER_PANEL_MAX, Math.max(BROWSER_PANEL_MIN, props.defaultWidth())));
  const storedPanelWidth = props.readCustomWidth();
  let customPanelWidth = Number.isFinite(storedPanelWidth);
  let savedCustomPanelWidth = customPanelWidth ? storedPanelWidth : null;
  const [panelWidth, setPanelWidth] = createSignal(
    props.readWidth(defaultPanelWidth(), BROWSER_PANEL_MIN, BROWSER_PANEL_MAX),
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
    props.saveWidth(width);
  };

  const resizeDefaultPanel = () => {
    const preferredWidth =
      customPanelWidth && savedCustomPanelWidth !== null ? savedCustomPanelWidth : defaultPanelWidth();
    setPanelWidth(Math.round(Math.min(props.maxWidth(), Math.max(BROWSER_PANEL_MIN, preferredWidth))));
  };

  const resetPanelWidth = () => {
    props.resetWidth();
    customPanelWidth = false;
    savedCustomPanelWidth = null;
    setPanelWidth(defaultPanelWidth());
  };

  return (
    <aside
      id="browser-side-panel"
      class="browser-panel browser-preview-sidebar"
      aria-label={t("browser.previews.label")}
      hidden={props.hidden}
    >
      <PanelResizer
        class="right-panel-resizer"
        label={t("browser.previews.resize")}
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
        <span>{t("browser.panel.label")}</span>
        <Show when={props.onNewTab}>
          <Button variant="ghost" size="icon-sm" aria-label={t("browser.newTab")} onClick={() => props.onNewTab?.()}>
            <Plus />
          </Button>
        </Show>
        <Button variant="ghost" size="icon-sm" aria-label={t("browser.previews.collapse")} onClick={props.onCollapse}>
          <ChevronRight />
        </Button>
      </header>
      <div class="browser-preview-list">
        <For each={props.tabs} keyed={(tab) => tab.id}>
          {(tab) => (
            <BrowserPreviewCard
              capturePreview={props.capturePreview}
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
            <strong>{t("browser.previews.empty")}</strong>
            <Show when={props.onNewTab}>
              <Button variant="secondary" size="sm" onClick={() => props.onNewTab?.()}>
                {t("browser.previews.openPage")}
              </Button>
            </Show>
          </div>
        </Show>
      </div>
    </aside>
  );
}

export function BrowserPreviewCard(props: {
  capturePreview?: (tabId: string) => Promise<BrowserPreview>;
  tab: BrowserTab;
  contextKey: string;
  enabled: boolean;
  onOpen: (tabId: string, trigger: HTMLButtonElement) => void;
  onClose?: (tabId: string) => void;
}) {
  const { t } = useText();
  const [state, setState] = createStore<{ preview: BrowserPreview | null; failed: boolean }>({
    preview: null,
    failed: false,
  });
  const [visible, setVisible] = createSignal(false);
  const [documentVisible, setDocumentVisible] = createSignal(!document.hidden);
  let element: HTMLDivElement | undefined;
  let pending: Promise<void> | undefined;
  const title = () => props.tab.title || props.tab.url || t("browser.preview.pageFallback");

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

  const pageKey = createMemo(() => JSON.stringify([props.contextKey, props.tab.id, props.tab.url]));
  const captureKey = createMemo(() =>
    JSON.stringify([pageKey(), props.tab.loading, props.enabled && visible() && documentVisible()]),
  );
  createEffect(pageKey, () => setState(() => ({ preview: null, failed: false })));
  createEffect(captureKey, () => {
    const capturePreview = props.capturePreview;
    if (!capturePreview || !props.enabled || !visible() || !documentVisible()) return;
    const id = props.tab.id;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (disposed) return;
      if (pending) {
        void pending.then(refresh);
        return;
      }
      try {
        pending = capturePreview(id)
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
      } catch {
        if (!disposed) setState(() => ({ preview: null, failed: true }));
        if (!disposed) timer = setTimeout(refresh, 3000);
      }
    };
    refresh();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  });

  return (
    <div ref={(node) => (element = node)} class="browser-preview-card">
      <Button
        variant="ghost"
        class="browser-preview-open"
        aria-label={t("browser.preview.open", { title: title() })}
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
                alt={t("browser.preview.image", { title: title() })}
              />
            )}
          </Show>
          <span class="browser-preview-open-label" aria-hidden="true">
            <Maximize2 />
            {t("browser.preview.openLabel")}
          </span>
        </span>
        <span class="browser-preview-title" title={title()}>
          {title()}
        </span>
      </Button>
      <Show when={props.onClose}>
        <Button
          variant="secondary"
          size="icon-xs"
          class="browser-preview-close"
          aria-label={t("browser.preview.close", { title: title() })}
          onClick={() => props.onClose?.(props.tab.id)}
        >
          <X />
        </Button>
      </Show>
    </div>
  );
}
