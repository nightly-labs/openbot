import { Button, ConfirmDialog, IconButton, QrCode, Smartphone, StableLabel, X } from "@openbot/ui";
import { createSignal, onCleanup } from "solid-js";
import { useText } from "../../text";
import { IOS_TESTFLIGHT_URL } from "../mobile-app/ios-testflight";

/**
 * The announcement of the iOS public beta at the bottom of the sidebar. The steps and the invite
 * QR code open in a dialog: the user reads this on a computer, and the install happens on a phone.
 */
export function SidebarMobileAppCard(props: { onCopyInvite: () => Promise<void>; onDismiss: () => void }) {
  const { t } = useText();
  const [open, setOpen] = createSignal(false);
  const [copy, setCopy] = createSignal<"idle" | "copied" | "failed">("idle");
  let resetTimer: number | undefined;
  onCleanup(() => window.clearTimeout(resetTimer));

  async function copyInvite(): Promise<void> {
    window.clearTimeout(resetTimer);
    try {
      await props.onCopyInvite();
      setCopy("copied");
      resetTimer = window.setTimeout(() => setCopy("idle"), 1_500);
    } catch {
      setCopy("failed");
    }
  }

  function close(): void {
    window.clearTimeout(resetTimer);
    setCopy("idle");
    setOpen(false);
  }
  return (
    <section class="sidebar-mobile-app" aria-labelledby="sidebar-mobile-app-title">
      <div class="sidebar-mobile-app-header">
        <Smartphone class="sidebar-mobile-app-icon" aria-hidden="true" />
        <strong id="sidebar-mobile-app-title">{t("sidebar.mobileApp.title")}</strong>
        <IconButton
          class="sidebar-mobile-app-dismiss"
          size="icon-xs"
          variant="ghost"
          label={t("sidebar.mobileApp.dismiss")}
          onClick={() => props.onDismiss()}
        >
          <X aria-hidden="true" />
        </IconButton>
      </div>
      <p class="sidebar-mobile-app-body">{t("sidebar.mobileApp.body")}</p>
      <Button type="button" variant="secondary" size="sm" fullWidth onClick={() => setOpen(true)}>
        {t("sidebar.mobileApp.howToInstall")}
      </Button>
      <ConfirmDialog
        open={open()}
        tone="default"
        initialFocus="cancel"
        media={
          <QrCode
            class="sidebar-mobile-app-qr"
            value={IOS_TESTFLIGHT_URL}
            size={132}
            label={t("sidebar.mobileApp.qrLabel")}
          />
        }
        title={t("sidebar.mobileApp.dialog.title")}
        description={t("sidebar.mobileApp.dialog.description")}
        confirmLabel={
          <StableLabel
            labels={[t("sidebar.mobileApp.dialog.copyLink"), t("sidebar.mobileApp.dialog.linkCopied")]}
            active={copy() === "copied" ? 1 : 0}
            live
          />
        }
        cancelLabel={t("sidebar.mobileApp.dialog.close")}
        error={copy() === "failed" ? t("sidebar.mobileApp.dialog.copyFailed") : undefined}
        onCancel={close}
        onConfirm={copyInvite}
      >
        <ol>
          <li>{t("sidebar.mobileApp.step.testFlight")}</li>
          <li>{t("sidebar.mobileApp.step.invite")}</li>
          <li>{t("sidebar.mobileApp.step.install")}</li>
          <li>{t("sidebar.mobileApp.step.connect")}</li>
        </ol>
      </ConfirmDialog>
    </section>
  );
}
