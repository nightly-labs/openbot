import type { BrowserPreview, BrowserTab } from "@openbot/contracts/ipc";
import { Button, Maximize2, Monitor, Skeleton, X } from "@openbot/ui";
import { PanelResizer } from "@openbot/ui/components/PanelResizer";
import { SETTINGS_PANEL_DEFAULT } from "@openbot/ui/components/SettingsPanel";
import { useText } from "@openbot/ui/text";
import { holdFlag } from "@openbot/ui/utils";
import type { JSX } from "@solidjs/web";
import {
  createEffect,
  createMemo,
  createSignal,
  createStore,
  For,
  onCleanup,
  onSettled,
  Show,
  untrack,
} from "solid-js";
import { createScrollFades } from "../../components/createScrollFades";
import { ScrollEdgeBlur } from "../../components/ScrollEdgeBlur";

const BROWSER_PANEL_MIN = SETTINGS_PANEL_DEFAULT;
const BUSY_CAPTURE_INTERVAL = 3000;
const IDLE_CAPTURE_INTERVAL = 20_000;

interface BrowserPreviewSidebarProps {
  capturePreview?: ((tabId: string) => Promise<BrowserPreview>) | undefined;
  readWidth: () => number;
  saveWidth: (width: number) => void;
  resetWidth: () => void;
  tabs: BrowserTab[];
  busyTabIds?: ReadonlySet<string> | undefined;
  hidden: boolean;
  suspended: boolean;
  contextKey: string;
  maxWidth: () => number;
  onWidthChange: (width: number) => void;
  onOpenTab: (tabId: string, trigger: HTMLButtonElement) => void;
  onCloseTab?: (tabId: string) => void;
  onNewTab?: () => void;
  pageShown?: boolean | undefined;
  children?: JSX.Element;
}

export default function BrowserPreviewSidebar(props: BrowserPreviewSidebarProps) {
  const { t } = useText();
  let panel!: HTMLElement;
  onSettled(() => {
    const conversation = panel.closest("[data-side-split]") ? null : panel.closest(".conversation-panel");
    return conversation ? holdFlag(conversation, "browser-side-panel") : undefined;
  });
  const [panelWidth, setPanelWidth] = createSignal(props.readWidth());
  createEffect(
    () => panelWidth(),
    (width) => {
      props.onWidthChange(width);
    },
  );

  const resizePanel = (width: number) => {
    setPanelWidth(width);
  };

  const resizeDefaultPanel = () => {
    setPanelWidth(Math.round(Math.min(props.maxWidth(), Math.max(BROWSER_PANEL_MIN, props.readWidth()))));
  };

  const resetPanelWidth = () => {
    props.resetWidth();
    setPanelWidth(props.readWidth());
  };

  const fades = createScrollFades();
  onCleanup(() => fades.stop());
  createEffect(
    () => props.tabs.length,
    () => fades.remeasure(),
  );

  return (
    <aside
      ref={panel}
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
        defaultValue={BROWSER_PANEL_MIN}
        min={BROWSER_PANEL_MIN}
        max={props.maxWidth}
        onResize={resizePanel}
        onResizeEnd={props.saveWidth}
        onParentResize={resizeDefaultPanel}
        onReset={resetPanelWidth}
      />

      <Show when={props.pageShown !== true} fallback={props.children}>
        <div
          class={["browser-preview-list", fades.classes()]}
          ref={(element) => fades.bind(element)}
          onScroll={fades.measure}
        >
          <For each={props.tabs} keyed={(tab) => tab.id}>
            {(tab) => (
              <BrowserPreviewCard
                capturePreview={props.capturePreview}
                tab={tab()}
                busy={props.busyTabIds?.has(tab().id) === true}
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
        <ScrollEdgeBlur fades={fades} />
      </Show>
    </aside>
  );
}

export function BrowserPreviewCard(props: {
  capturePreview?: ((tabId: string) => Promise<BrowserPreview>) | undefined;
  tab: BrowserTab;
  busy?: boolean | undefined;
  contextKey: string;
  enabled: boolean;
  onOpen: (tabId: string, trigger: HTMLButtonElement) => void;
  onClose?: ((tabId: string) => void) | undefined;
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
  let wake: (() => void) | undefined;
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
  createEffect(
    () => {
      captureKey();
      return untrack(() => ({ capturePreview: props.capturePreview, enabled: props.enabled, id: props.tab.id }));
    },
    ({ capturePreview, enabled, id }) => {
      if (!capturePreview || !enabled || !visible() || !documentVisible()) return;
      let disposed = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const interval = () =>
        untrack(() => (props.tab.loading || props.busy ? BUSY_CAPTURE_INTERVAL : IDLE_CAPTURE_INTERVAL));
      const failed = () => {
        if (!disposed) setState(() => ({ preview: null, failed: !(props.tab.loading && !state.preview) }));
      };
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
            .catch(failed)
            .finally(() => {
              pending = undefined;
              if (!disposed) timer = setTimeout(refresh, interval());
            });
        } catch {
          failed();
          if (!disposed) timer = setTimeout(refresh, interval());
        }
      };
      refresh();
      wake = () => {
        if (disposed || !timer) return;
        clearTimeout(timer);
        timer = undefined;
        refresh();
      };
      return () => {
        disposed = true;
        wake = undefined;
        if (timer) clearTimeout(timer);
      };
    },
  );
  createEffect(
    () => props.busy === true,
    (busy) => {
      if (busy) wake?.();
    },
  );

  return (
    <div ref={(node) => (element = node)} class="browser-preview-card">
      <Button
        variant="ghost"
        class="browser-preview-open"
        aria-label={t("browser.preview.open", { title: title() })}
        data-cuelume-tap="open"
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
          data-cuelume-tap="close"
          onClick={() => props.onClose?.(props.tab.id)}
        >
          <X />
        </Button>
      </Show>
    </div>
  );
}
