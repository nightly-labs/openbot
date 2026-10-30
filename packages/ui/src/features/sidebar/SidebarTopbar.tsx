/**
 * The server name, Back and Forward, its update, the marketplace or expand toggle, and new agent - plus
 * the window drag region.
 */

import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Button,
  CircleFadingArrowUp,
  DropdownMenu,
  FolderPlus,
  Hash,
  IconButton,
  Puzzle,
} from "@openbot/ui";
import { Show } from "solid-js";
import { useText } from "../../text";
import { ServerMenu } from "../servers/ServerMenu";
import { PlusIcon, SidebarToggleIcon } from "./SidebarIcons";
import { useSidebarScope } from "./sidebar-scope";

export function SidebarTopbar() {
  const { layoutMutable, props, startCreateSection } = useSidebarScope();
  const { t } = useText();
  return (
    <div class="window-drag sidebar-topbar">
      <Show
        when={props.serverMenu}
        fallback={
          <Button
            variant="ghost"
            size="sm"
            type="button"
            class="sidebar-server-name no-drag"
            aria-label={t("sidebar.topbar.openSettings", { name: props.serverName })}
            aria-hidden={props.compact ? "true" : undefined}
            tabindex={props.compact ? -1 : 0}
            disabled={!props.onOpenServerSettings}
            title={props.serverName}
            onClick={(event) => props.onOpenServerSettings?.(event.currentTarget)}
          >
            <span class="sidebar-server-name-label">{props.serverName}</span>
          </Button>
        }
      >
        {(serverMenu) => <ServerMenu {...serverMenu()} serverName={props.serverName} compact={props.compact} />}
      </Show>
      <div class="sidebar-topbar-actions">
        <Show when={!props.compact && props.chatHistory}>
          {(history) => {
            const backLabel = () => {
              const back = history().back;
              return back ? t("sidebar.topbar.backTo", { name: back.name }) : t("sidebar.topbar.back");
            };
            const forwardLabel = () => {
              const forward = history().forward;
              return forward ? t("sidebar.topbar.forwardTo", { name: forward.name }) : t("sidebar.topbar.forward");
            };
            return (
              <>
                <IconButton
                  variant="ghost"
                  type="button"
                  class="sidebar-icon-button sidebar-history-button no-drag"
                  label={backLabel()}
                  tooltip={`${backLabel()}  ${history().keys.back}`}
                  disabled={!history().back}
                  data-cuelume-tap="navigate"
                  onClick={() => history().onBack()}
                >
                  <ArrowLeft aria-hidden="true" />
                </IconButton>
                <IconButton
                  variant="ghost"
                  type="button"
                  class="sidebar-icon-button sidebar-history-button no-drag"
                  label={forwardLabel()}
                  tooltip={`${forwardLabel()}  ${history().keys.forward}`}
                  disabled={!history().forward}
                  data-cuelume-tap="navigate"
                  onClick={() => history().onForward()}
                >
                  <ArrowRight aria-hidden="true" />
                </IconButton>
              </>
            );
          }}
        </Show>
        <Show when={!props.compact && props.serverUpdate}>
          {(update) => {
            const label = () =>
              update().running
                ? t("server.update.dialog.progressTitle", { name: props.serverName })
                : t("server.update.dialog.offerTitle", { name: props.serverName, version: update().version });
            return (
              <Button
                variant="ghost"
                type="button"
                class="sidebar-icon-button sidebar-update-button no-drag"
                data-running={update().running ? "true" : undefined}
                aria-label={label()}
                title={label()}
                onClick={() => update().onOpen()}
              >
                <CircleFadingArrowUp aria-hidden="true" />
              </Button>
            );
          }}
        </Show>
        {/* The menu view needs the room for the server name. The page rail also opens the marketplace. */}
        <Show when={props.compact || (props.marketplaceSupported !== false && props.serverMenu?.view !== "menu")}>
          <Button
            variant="ghost"
            type="button"
            class={[
              "sidebar-icon-button no-drag",
              props.compact ? "sidebar-toggle-button" : "sidebar-marketplace-button",
            ]}
            onClick={() => (props.compact ? props.onExpand() : props.onOpenMarketplace())}
            data-cuelume-tap={props.compact ? "open" : "navigate"}
            aria-label={props.compact ? t("sidebar.topbar.expand") : t("sidebar.topbar.openMarketplace")}
            aria-controls={props.compact ? "agent-sidebar" : undefined}
            aria-expanded={props.compact ? "false" : undefined}
            title={props.compact ? t("sidebar.topbar.expand") : t("sidebar.topbar.marketplace")}
          >
            <Show when={props.compact} fallback={<Puzzle aria-hidden="true" />}>
              <SidebarToggleIcon />
            </Show>
          </Button>
        </Show>
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
      </div>
    </div>
  );
}
