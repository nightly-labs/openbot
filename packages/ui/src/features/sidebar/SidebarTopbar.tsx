/**
 * The server name, Back and Forward, the sidebar toggle, the server update, and the marketplace
 * button - plus the window drag region. A window with the page rail shows the server in the rail, and
 * its styles hide the name here. The styles also hide Back, Forward and the update in a compact
 * sidebar that has no room for them.
 */

import { ArrowLeft, ArrowRight, Button, CircleFadingArrowUp, IconButton, Puzzle } from "@openbot/ui";
import { Show } from "solid-js";
import { useText } from "../../text";
import { ServerMenu } from "../servers/ServerMenu";
import { SidebarToggleIcon } from "./SidebarIcons";
import { useSidebarScope } from "./sidebar-scope";

export function SidebarTopbar() {
  const { props } = useSidebarScope();
  const { t } = useText();
  const toggleLabel = () => (props.compact ? t("sidebar.topbar.expand") : t("sidebar.topbar.collapse"));
  const toggleSidebar = () => (props.compact ? props.onExpand() : props.onCollapse?.());
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
            <span class="sidebar-server-name-label" dir="auto">
              {props.serverName}
            </span>
          </Button>
        }
      >
        {(serverMenu) => <ServerMenu {...serverMenu()} serverName={props.serverName} compact={props.compact} />}
      </Show>
      <div class="sidebar-topbar-actions">
        <Show when={props.chatHistory}>
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
        <Show when={props.compact || props.onCollapse}>
          <Button
            variant="ghost"
            type="button"
            class="sidebar-icon-button sidebar-toggle-button no-drag"
            onClick={toggleSidebar}
            data-cuelume-tap={props.compact ? "open" : "close"}
            aria-label={toggleLabel()}
            aria-controls="agent-sidebar"
            aria-expanded={props.compact ? "false" : "true"}
            title={toggleLabel()}
          >
            <SidebarToggleIcon />
          </Button>
        </Show>
        <Show when={props.serverUpdate}>
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
        <Show when={!props.compact && props.marketplaceSupported !== false && props.serverMenu?.view !== "menu"}>
          <Button
            variant="ghost"
            type="button"
            class="sidebar-icon-button sidebar-marketplace-button no-drag"
            onClick={() => props.onOpenMarketplace()}
            data-cuelume-tap="navigate"
            aria-label={t("sidebar.topbar.openMarketplace")}
            title={t("sidebar.topbar.marketplace")}
          >
            <Puzzle aria-hidden="true" />
          </Button>
        </Show>
      </div>
    </div>
  );
}
