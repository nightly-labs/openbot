import { Dialog, IconButton, Text, X } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { onCleanup } from "solid-js";
import { createScrollFades } from "../../components/createScrollFades";
import { ScrollEdgeBlur } from "../../components/ScrollEdgeBlur";
import { useText } from "../../text";
import type { SettingsHostedServersStore } from "../settings/stores/hosted-servers-store";
import { BillingPanel } from "./BillingPanel";
import type { BillingStore } from "./billing-store";

export interface BillingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  store: BillingStore;
  hostedServers?: SettingsHostedServersStore | undefined;
  license?: JSX.Element;
  credits?: JSX.Element;
}

export function BillingDialog(props: BillingDialogProps): JSX.Element {
  const { t } = useText();
  const fades = createScrollFades();
  onCleanup(() => fades.stop());

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
            <div
              class={["billing-dialog-body", fades.classes()]}
              ref={(element) => fades.bind(element)}
              onScroll={fades.measure}
            >
              <div ref={(element) => fades.watch(element)}>
                <BillingPanel
                  store={props.store}
                  available
                  hostedServers={props.hostedServers}
                  license={props.license}
                  credits={props.credits}
                />
              </div>
            </div>
            <ScrollEdgeBlur fades={fades} />
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
