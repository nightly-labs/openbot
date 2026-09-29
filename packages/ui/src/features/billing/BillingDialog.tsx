import { Dialog, IconButton, Text, X } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import { useText } from "../../text";
import { SettingsHostedServersTab } from "../settings/SettingsHostedServersTab";
import type { SettingsHostedServersStore } from "../settings/stores/hosted-servers-store";
import { BillingPanel } from "./BillingPanel";
import type { BillingStore } from "./billing-store";

export interface BillingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  store: BillingStore;
  /** The hosted servers of the account. A server whose plan ended is renewed or deleted here. */
  hostedServers?: SettingsHostedServersStore | undefined;
}

/** The Billing panel in a dialog, for the web client, which has no Settings dialog. */
export function BillingDialog(props: BillingDialogProps): JSX.Element {
  const { t } = useText();

  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay class="billing-dialog-backdrop">
          <Dialog.Content as="section" class="billing-dialog">
            <IconButton
              class="billing-dialog-close"
              label={t("common.close")}
              variant="ghost"
              onClick={() => props.onOpenChange(false)}
            >
              <X />
            </IconButton>
            <header class="billing-dialog-header">
              <Dialog.Title as="h2" class="billing-dialog-title">
                {t("billing.title")}
              </Dialog.Title>
              <Dialog.Description as="p">
                <Text tone="muted">{t("billing.description")}</Text>
              </Dialog.Description>
            </header>
            <div class="billing-dialog-body">
              <BillingPanel store={props.store} available />
              <Show when={props.hostedServers?.state.servers.length ? props.hostedServers : undefined}>
                {(hostedServers) => <SettingsHostedServersTab store={hostedServers()} />}
              </Show>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
