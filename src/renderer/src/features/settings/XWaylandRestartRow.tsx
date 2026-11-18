import type { AboveAppsSupport } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { Button, Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@openbot/ui";
import { createSignal, Show } from "solid-js";
import { useI18n } from "../../i18n-context";

/**
 * Linux with Wayland windows: a window above the other apps needs a start on XWayland. The row offers the
 * restart, or says that this start cannot use XWayland. It shows nothing when the window needs no restart.
 */
export function XWaylandRestartRow(props: {
  support: AboveAppsSupport | undefined;
  keys: { title: AppTextKey; description: AppTextKey; unsupported: AppTextKey; restart: AppTextKey };
  onRestart: () => Promise<unknown>;
}) {
  const i18n = useI18n();
  const [restarting, setRestarting] = createSignal(false);
  function restart(): void {
    setRestarting(true);
    void props.onRestart().catch(() => setRestarting(false));
  }
  return (
    <Show when={props.support}>
      {(support) => (
        <Item data-settings-row={props.keys.title} class="settings-modal-row">
          <ItemContent>
            <ItemTitle>{i18n.t(props.keys.title)}</ItemTitle>
            <ItemDescription>
              {i18n.t(support() === "restart" ? props.keys.description : props.keys.unsupported)}
            </ItemDescription>
          </ItemContent>
          <Show when={support() === "restart"}>
            <ItemActions>
              <Button type="button" size="sm" variant="outline" disabled={restarting()} onClick={restart}>
                {i18n.t(props.keys.restart)}
              </Button>
            </ItemActions>
          </Show>
        </Item>
      )}
    </Show>
  );
}
