import { buttonVariants, DropdownMenu, Ellipsis } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createSignal, Show } from "solid-js";
import { BrowserShortcutHint } from "./BrowserTabIcon";
import { type BrowserFullViewProps, browserTabStoppable } from "./browser-full-view-types";
import { useBrowserPageCover } from "./browser-page-cover";

/** The actions of the view in one menu: a new tab, reopen, Picture in Picture, a sign-in on this computer, hide. */
export function BrowserPageMenu(props: { view: BrowserFullViewProps; narrow: boolean; onNewTab: () => void }) {
  const { t } = useText();
  const tab = () => props.view.activeTab;
  const [open, setOpen] = createSignal(false);
  useBrowserPageCover(open);
  return (
    <DropdownMenu.Root placement="bottom-end" gutter={4} onOpenChange={setOpen}>
      <DropdownMenu.Trigger
        class={buttonVariants({ variant: "ghost", size: "icon-sm" })}
        aria-label={t("browser.pageActions")}
      >
        <Ellipsis aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content>
          <Show when={props.narrow}>
            <DropdownMenu.Item
              disabled={!tab() || tab()?.canGoForward === false}
              onSelect={() => {
                const current = tab();
                if (current) props.view.onNavigate(current.id, "forward");
              }}
            >
              {t("browser.goForward")}
              <BrowserShortcutHint view={props.view} name="forward" />
            </DropdownMenu.Item>
            <Show
              when={browserTabStoppable(tab())}
              fallback={
                <DropdownMenu.Item
                  disabled={!tab()?.url}
                  onSelect={() => {
                    const current = tab();
                    if (current) props.view.onReload(current.id);
                  }}
                >
                  {t("browser.reload")}
                  <BrowserShortcutHint view={props.view} name="reload" />
                </DropdownMenu.Item>
              }
            >
              <DropdownMenu.Item
                onSelect={() => {
                  const current = tab();
                  if (current) props.view.onStop(current.id);
                }}
              >
                {t("browser.stopLoading")}
              </DropdownMenu.Item>
            </Show>
            <DropdownMenu.Separator />
          </Show>
          <DropdownMenu.Item onSelect={props.onNewTab}>
            {t("browser.newTab")}
            <BrowserShortcutHint view={props.view} name="newTab" />
          </DropdownMenu.Item>
          <DropdownMenu.Item disabled={!props.view.canReopen} onSelect={props.view.onReopenTab}>
            {t("browser.tab.reopenClosed")}
            <BrowserShortcutHint view={props.view} name="reopen" />
          </DropdownMenu.Item>
          <Show when={props.view.canEnterPip !== false}>
            <DropdownMenu.Item disabled={!tab()} onSelect={props.view.onEnterPip}>
              {t("browser.pip.open")}
            </DropdownMenu.Item>
          </Show>
          <Show when={props.view.onSignInLocally}>
            {(signIn) => (
              <DropdownMenu.Item
                disabled={!tab()}
                onSelect={() => {
                  const current = tab();
                  if (current) signIn()(current.id);
                }}
              >
                {t("browser.signIn.local")}
              </DropdownMenu.Item>
            )}
          </Show>
          <DropdownMenu.Separator />
          <DropdownMenu.Item onSelect={props.view.onBack}>{t("browser.hide")}</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
