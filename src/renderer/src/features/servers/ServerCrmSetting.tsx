import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle, Switch } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { Show } from "solid-js";
import { createCrmEnabled } from "../crm/crm-enabled";
import type { CrmHost } from "../crm/crm-port";

/**
 * Server Settings > Experimental: whether the server shows its CRM (`crm-v1`). Off hides the CRM page,
 * refuses the CRM tools of the agents and stops the payment source sync; the data stays. The host
 * checks the role again.
 */
export function ServerCrmSetting(props: {
  host: CrmHost;
  disabled: boolean;
  run: (key: string, action: () => Promise<void>) => Promise<boolean>;
}) {
  const { t } = useText();
  const crm = createCrmEnabled(() => props.host);
  return (
    <Item>
      <ItemContent>
        <ItemTitle id="server-settings-crm-label">{t("server.settings.experimentalCrm")}</ItemTitle>
        <ItemDescription>{t("server.settings.experimentalCrmDescription")}</ItemDescription>
      </ItemContent>
      <Show when={crm.enabled() !== undefined}>
        <ItemActions>
          <Switch
            checked={crm.enabled() === true}
            disabled={props.disabled}
            onChange={(enabled) => void props.run("crm", () => crm.set(enabled))}
            aria-labelledby="server-settings-crm-label"
          />
        </ItemActions>
      </Show>
    </Item>
  );
}
