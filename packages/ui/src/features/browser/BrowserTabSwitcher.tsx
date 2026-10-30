import { Button, buttonVariants, Globe2, Popover, X } from "@openbot/ui";
import { PlusIcon } from "@openbot/ui/features/conversation/ConversationIcons";
import { useText } from "@openbot/ui/text";
import { createSignal, For, Show } from "solid-js";
import { BrowserTabIcon, useBrowserTabTitle } from "./BrowserTabIcon";
import type { BrowserFullViewProps } from "./browser-full-view-types";
import { useBrowserPageCover } from "./browser-page-cover";
import { browserDisplayUrl } from "./browser-suggestions";

/** On a narrow window the top row has no room for the chips: one button names the tab and opens the list. */
export function BrowserTabSwitcher(props: {
  view: BrowserFullViewProps;
  onNewTab: () => void;
  onClose: (tabIds: readonly string[]) => void;
}) {
  const { t } = useText();
  const tabTitle = useBrowserTabTitle();
  const [open, setOpen] = createSignal(false);
  useBrowserPageCover(open);
  // A new tab puts the focus in the address field, so the popover does not give it back to its button.
  let keepFocus = false;
  const active = () => props.view.activeTab;
  const canClose = () => props.view.canCloseTabs !== false;
  const label = () => {
    const tab = active();
    return t("browser.tabs.switcher", {
      title: tab ? tabTitle(tab) : t("browser.panel.label"),
      count: props.view.tabs.length,
    });
  };
  const run = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    // Modal, so the focus goes into the list and Escape closes the list, not the browser view.
    <Popover.Root modal open={open()} onOpenChange={setOpen} placement="bottom-start" gutter={4}>
      <Popover.Trigger
        class={`${buttonVariants({ variant: "ghost", size: "sm" })} browser-full-switch no-drag`}
        aria-label={label()}
      >
        <Show
          when={active()}
          fallback={
            <>
              <Globe2 class="browser-full-owner-globe" aria-hidden="true" />
              <span class="browser-full-switch-title">{t("browser.panel.label")}</span>
            </>
          }
        >
          {(tab) => (
            <>
              <BrowserTabIcon view={props.view} tab={tab()} />
              <span class="browser-full-switch-title">{tabTitle(tab())}</span>
            </>
          )}
        </Show>
        <span class="browser-full-switch-count" aria-hidden="true">
          {props.view.tabs.length}
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          class="ui-popover-menu-surface browser-full-switch-menu"
          onOpenAutoFocus={(event: Event) => {
            const current = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined;
            const row = current?.querySelector<HTMLElement>('[aria-current="true"]');
            if (!row) return;
            event.preventDefault();
            row.focus();
          }}
          onCloseAutoFocus={(event: Event) => {
            if (keepFocus) event.preventDefault();
            keepFocus = false;
          }}
        >
          <Popover.Title class="sr-only">{t("browser.tabs.label")}</Popover.Title>
          <ul class="browser-full-switch-list">
            <For each={props.view.tabs} keyed={(tab) => tab.id}>
              {(tab) => (
                <li class="browser-full-switch-row">
                  <Button
                    variant="ghost"
                    type="button"
                    class="browser-full-switch-select"
                    aria-current={active()?.id === tab().id ? "true" : undefined}
                    onClick={() => run(() => props.view.onActivateTab(tab().id))}
                  >
                    <span class="browser-full-suggest-icon">
                      <BrowserTabIcon view={props.view} tab={tab()} />
                    </span>
                    <span class="browser-full-switch-text">
                      <span class="browser-full-suggest-title">{tabTitle(tab())}</span>
                      <Show when={tab().url}>
                        <span class="browser-full-suggest-detail">{browserDisplayUrl(tab().url)}</span>
                      </Show>
                    </span>
                  </Button>
                  <Show when={canClose()}>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      class="browser-full-switch-close"
                      aria-label={t("browser.tab.closeNamed", { name: tabTitle(tab()) })}
                      onClick={() => props.onClose([tab().id])}
                    >
                      <X aria-hidden="true" />
                    </Button>
                  </Show>
                </li>
              )}
            </For>
          </ul>
          <div class="browser-full-switch-actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                keepFocus = true;
                run(props.onNewTab);
              }}
            >
              <PlusIcon />
              {t("browser.newTab")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!props.view.canReopen}
              onClick={() => run(props.view.onReopenTab)}
            >
              {t("browser.tab.reopenClosed")}
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
