/**
 * The search field with the New menu at its end, and the compact-mode button in their place. The field
 * and the button open the global search.
 */

import { Bot, Button, DropdownMenu, FolderPlus, Hash } from "@openbot/ui";
import { Show } from "solid-js";
import { useText } from "../../text";
import { PlusIcon, SearchIcon } from "./SidebarIcons";
import { useSidebarScope } from "./sidebar-scope";

export function SidebarSearch() {
  const { layoutMutable, props, startCreateSection } = useSidebarScope();
  const { t } = useText();
  return (
    <div class="sidebar-search-wrap">
      <Button
        variant="ghost"
        type="button"
        class="search-field sidebar-search-trigger"
        aria-label={t("conversation.globalSearch.title")}
        aria-haspopup="dialog"
        aria-hidden={props.compact ? "true" : undefined}
        tabindex={props.compact ? -1 : 0}
        onClick={props.onOpenSearch}
      >
        <SearchIcon />
        <span class="sidebar-search-placeholder">{t("common.search")}</span>
      </Button>
      <Show when={props.createSupported !== false || props.onCreateChannel || layoutMutable()}>
        <DropdownMenu.Root placement="bottom-end" gutter={4}>
          <DropdownMenu.Trigger
            class="sidebar-icon-button sidebar-new-button no-drag"
            aria-label={props.onCreateChannel ? t("sidebar.new.menuWithChannel") : t("sidebar.new.menu")}
            aria-hidden={props.compact ? "true" : undefined}
            tabindex={props.compact ? -1 : 0}
          >
            <PlusIcon />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content>
              <Show when={props.createSupported !== false}>
                <DropdownMenu.Item onSelectAfterClose={props.onCreateAgent}>
                  <Bot aria-hidden="true" />
                  {t("sidebar.new.agent")}
                </DropdownMenu.Item>
              </Show>
              <Show when={props.onCreateChannel}>
                <DropdownMenu.Item onSelectAfterClose={() => props.onCreateChannel?.()}>
                  <Hash aria-hidden="true" />
                  {t("sidebar.new.channel")}
                </DropdownMenu.Item>
              </Show>
              <Show when={layoutMutable()}>
                <DropdownMenu.Item onSelectAfterClose={() => startCreateSection()}>
                  <FolderPlus aria-hidden="true" />
                  {t("sidebar.new.section")}
                </DropdownMenu.Item>
              </Show>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </Show>
      <Button
        variant="ghost"
        type="button"
        class="sidebar-compact-search"
        aria-label={t("conversation.globalSearch.title")}
        aria-haspopup="dialog"
        aria-hidden={props.compact ? undefined : "true"}
        tabindex={props.compact ? 0 : -1}
        onClick={props.onOpenSearch}
      >
        <SearchIcon />
      </Button>
    </div>
  );
}
