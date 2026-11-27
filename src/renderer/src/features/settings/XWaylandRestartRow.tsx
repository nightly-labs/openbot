import type { AboveAppsSupport } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { Button, Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@openbot/ui";
import { createSignal, Show } from "solid-js";
import { useI18n } from "../../i18n-context";

interface RowText {
  title: AppTextKey;
  description: AppTextKey;
}

export function XWaylandRestartRow(props: {
  support: AboveAppsSupport | undefined;
  keys: {
    title: AppTextKey;
    description: AppTextKey;
    unsupported: AppTextKey;
    restart: AppTextKey;
    noCompositor?: RowText;
  };
  onRestart: () => Promise<unknown>;
}) {
  const i18n = useI18n();
  const [restarting, setRestarting] = createSignal(false);
  function restart(): void {
    setRestarting(true);
    void props.onRestart().catch(() => setRestarting(false));
  }
  const text = (): RowText | undefined => {
    const support = props.support;
    if (support === undefined) return undefined;
    if (support === "no-compositor") return props.keys.noCompositor;
    return {
      title: props.keys.title,
      description: support === "restart" ? props.keys.description : props.keys.unsupported,
    };
  };
  return (
    <Show when={text()}>
      {(text) => (
        <Item data-settings-row={text().title} class="settings-modal-row">
          <ItemContent>
            <ItemTitle>{i18n.t(text().title)}</ItemTitle>
            <ItemDescription>{i18n.t(text().description)}</ItemDescription>
          </ItemContent>
          <Show when={props.support === "restart"}>
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
