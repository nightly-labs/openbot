import { Button, CalendarClock, Dialog } from "@openbot/ui";
import { useText } from "../../text";

export interface HostedServerUpsellDialogProps {
  routine: { name: string };
  onSeePlans: () => void;
  onClose: () => void;
}

/**
 * The offer of a hosted server after a new routine. A short loop shows it: the laptop lid closes and the
 * routine stops, while the server keeps running.
 */
export function HostedServerUpsellDialog(props: HostedServerUpsellDialogProps) {
  const { t } = useText();
  let seePlans: HTMLButtonElement | undefined;
  return (
    <Dialog.Root open onOpenChange={(open) => !open && props.onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay>
          <Dialog.Content
            as="section"
            class="hosted-upsell-modal"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              seePlans?.focus({ preventScroll: true });
            }}
          >
            <div class="hosted-upsell-scene" aria-hidden="true">
              <figure class="hosted-upsell-device">
                <div class="hosted-upsell-laptop">
                  <span class="hosted-upsell-laptop-lid">
                    <span class="hosted-upsell-laptop-screen">
                      <CalendarClock />
                    </span>
                  </span>
                  <span class="hosted-upsell-laptop-base" />
                </div>
                <figcaption>
                  {t("server.upsell.modal.computer")}
                  <span class="hosted-upsell-status hosted-upsell-status-flip">
                    <span class="hosted-upsell-status-on">{t("server.upsell.modal.running")}</span>
                    <span class="hosted-upsell-status-off">{t("server.upsell.modal.stopped")}</span>
                  </span>
                </figcaption>
              </figure>
              <figure class="hosted-upsell-device">
                <div class="hosted-upsell-rack">
                  <span />
                  <span />
                  <span />
                </div>
                <figcaption>
                  {t("server.upsell.modal.server")}
                  <span class="hosted-upsell-status">
                    <span class="hosted-upsell-status-on">{t("server.upsell.modal.running")}</span>
                  </span>
                </figcaption>
              </figure>
            </div>
            <Dialog.Title as="h2" class="hosted-upsell-modal-title">
              {t("server.upsell.modal.title")}
            </Dialog.Title>
            <Dialog.Description as="p" class="hosted-upsell-modal-description">
              {t("server.upsell.modal.description", { name: props.routine.name })}
            </Dialog.Description>
            <footer class="hosted-upsell-modal-actions">
              <Button variant="ghost" onClick={() => props.onClose()}>
                {t("server.upsell.notNow")}
              </Button>
              <Button ref={(element) => (seePlans = element)} onClick={() => props.onSeePlans()}>
                {t("server.upsell.seePlans")}
              </Button>
            </footer>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
