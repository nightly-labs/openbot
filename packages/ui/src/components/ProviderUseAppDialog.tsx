import { Button, Dialog, IconButton, X } from "@openbot/ui";
import { useText } from "../text";

export interface ProviderUseAppDialogProps {
  open: boolean;
  providerName: string;
  onDownload: () => void;
  onClose: () => void;
}

export function ProviderUseAppDialog(props: ProviderUseAppDialogProps) {
  const { t } = useText();
  return (
    <Dialog.Root
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="provider-code-login-backdrop">
          <Dialog.Content class="provider-code-login-dialog" as="section">
            <header class="provider-code-login-header">
              <Dialog.Title class="provider-code-login-title">
                {t("provider.useApp.title", { name: props.providerName })}
              </Dialog.Title>
              <Dialog.Description class="provider-code-login-description">
                {t("provider.useApp.description", { name: props.providerName })}
              </Dialog.Description>
            </header>
            <div class="provider-code-login-body provider-use-app-actions">
              <Button type="button" variant="outline" onClick={props.onClose}>
                {t("common.close")}
              </Button>
              <Button type="button" onClick={props.onDownload}>
                {t("provider.useApp.download")}
              </Button>
            </div>
            <IconButton
              class="provider-code-login-close"
              label={t("common.close")}
              variant="ghost"
              data-cuelume-tap="close"
              onClick={props.onClose}
            >
              <X />
            </IconButton>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
