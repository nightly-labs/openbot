import type { BrowserTab } from "@openbot/contracts/ipc";
import { ContextMenu } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { Show } from "solid-js";
import { BrowserShortcutHint } from "./BrowserTabIcon";
import type { BrowserFullViewProps } from "./browser-full-view-types";

/** The actions of a tab, on a right click, as other browsers have them. Rows that would do nothing stay out. */
export function BrowserTabMenu(props: {
  view: BrowserFullViewProps;
  tab: BrowserTab;
  onNewTab: (afterId: string) => void;
  onClose: (tabIds: readonly string[]) => void;
}) {
  const { t } = useText();
  const tabs = () => props.view.tabs;
  const index = () => tabs().findIndex((tab) => tab.id === props.tab.id);
  const hasLeft = () => index() > 0;
  const hasRight = () => index() < tabs().length - 1;
  const canClose = () => props.view.canCloseTabs !== false;
  const ids = (from: number, to?: number) =>
    tabs()
      .slice(from, to)
      .map((tab) => tab.id);
  return (
    <ContextMenu.Portal>
      <ContextMenu.Content>
        <ContextMenu.Item onSelect={() => props.onNewTab(props.tab.id)}>{t("browser.tab.newRight")}</ContextMenu.Item>
        <ContextMenu.Separator />
        <ContextMenu.Item disabled={!props.tab.url} onSelect={() => props.view.onReload(props.tab.id)}>
          {t("browser.reload")}
          <BrowserShortcutHint view={props.view} name="reload" />
        </ContextMenu.Item>
        <ContextMenu.Item disabled={!props.tab.url} onSelect={() => props.view.onDuplicateTab(props.tab.id)}>
          {t("browser.tab.duplicate")}
        </ContextMenu.Item>
        <Show when={tabs().length > 1}>
          <ContextMenu.Separator />
          <Show when={hasLeft()}>
            <ContextMenu.Item onSelect={() => props.view.onMoveTab(props.tab.id, index() - 1)}>
              {t("browser.tab.moveLeft")}
              <BrowserShortcutHint view={props.view} name="moveLeft" />
            </ContextMenu.Item>
          </Show>
          <Show when={hasRight()}>
            <ContextMenu.Item onSelect={() => props.view.onMoveTab(props.tab.id, index() + 1)}>
              {t("browser.tab.moveRight")}
              <BrowserShortcutHint view={props.view} name="moveRight" />
            </ContextMenu.Item>
          </Show>
        </Show>
        <Show when={canClose()}>
          <ContextMenu.Separator />
          <ContextMenu.Item onSelect={() => props.onClose([props.tab.id])}>
            {t("browser.tab.close")}
            <BrowserShortcutHint view={props.view} name="close" />
          </ContextMenu.Item>
          <Show when={hasLeft()}>
            <ContextMenu.Item onSelect={() => props.onClose(ids(0, index()))}>
              {t("browser.tab.closeLeft")}
            </ContextMenu.Item>
          </Show>
          <Show when={hasRight()}>
            <ContextMenu.Item onSelect={() => props.onClose(ids(index() + 1))}>
              {t("browser.tab.closeRight")}
            </ContextMenu.Item>
          </Show>
          <Show when={tabs().length > 1}>
            <ContextMenu.Item
              onSelect={() => props.onClose(tabs().flatMap((tab) => (tab.id === props.tab.id ? [] : [tab.id])))}
            >
              {t("browser.tab.closeOthers")}
            </ContextMenu.Item>
          </Show>
        </Show>
        <ContextMenu.Separator />
        <ContextMenu.Item disabled={!props.view.canReopen} onSelect={props.view.onReopenTab}>
          {t("browser.tab.reopenClosed")}
          <BrowserShortcutHint view={props.view} name="reopen" />
        </ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu.Portal>
  );
}
