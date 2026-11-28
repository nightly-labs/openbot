import { Button, Dialog, IconButton, X } from "@openbot/ui";
import { useText } from "../text";

export type ProviderRegion = "global" | "mainland-cn";

export interface ProviderRegionDialogProps {
  open: boolean;
  providerName: string;
  globalSite: string;
  mainlandChinaSite: string;
  onChoose: (region: ProviderRegion) => void;
  onClose: () => void;
}

export function ProviderRegionDialog(props: ProviderRegionDialogProps) {
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
                {t("provider.region.title", { name: props.providerName })}
              </Dialog.Title>
              <Dialog.Description class="provider-code-login-description">
                {t("provider.region.description", { name: props.providerName })}
              </Dialog.Description>
            </header>
            <div class="provider-code-login-body provider-use-app-actions">
              <Button type="button" variant="outline" onClick={() => props.onChoose("mainland-cn")}>
                {t("provider.region.mainlandChina", { site: props.mainlandChinaSite })}
              </Button>
              <Button type="button" variant="outline" onClick={() => props.onChoose("global")}>
                {t("provider.region.global", { site: props.globalSite })}
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
