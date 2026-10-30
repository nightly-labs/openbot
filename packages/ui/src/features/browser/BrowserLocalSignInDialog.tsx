import { Button, ConfirmDialog, LogIn } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { Show } from "solid-js";

export interface BrowserLocalSignInDialogProps {
  open: boolean;
  /** The host name of the tab's page, such as `x.com`. */
  site: string;
  server: string;
  /** False after the person closes the sign-in window. */
  windowOpen: boolean;
  pending: boolean;
  error?: string | undefined;
  onReopen: () => void;
  onCancel: () => void;
  onDone: () => Promise<void>;
}

/**
 * The step of a sign-in on this computer for a tab of a server's browser. The window on this computer
 * shows the site; this dialog stays in OpenBot until the person selects Done or Cancel.
 */
export default function BrowserLocalSignInDialog(props: BrowserLocalSignInDialogProps) {
  const { t } = useText();
  return (
    <ConfirmDialog
      open={props.open}
      tone="default"
      icon={<LogIn />}
      title={t("browser.signIn.title", { site: props.site })}
      description={t("browser.signIn.description", { site: props.site, server: props.server })}
      confirmLabel={t("common.done")}
      pendingLabel={t("browser.signIn.sending", { server: props.server })}
      pending={props.pending}
      error={props.error}
      onCancel={props.onCancel}
      onConfirm={props.onDone}
    >
      <Show when={!props.windowOpen} fallback={<p>{t("browser.signIn.windowOpen")}</p>}>
        <p>{t("browser.signIn.windowClosed")}</p>
        <Button variant="outline" size="sm" type="button" disabled={props.pending} onClick={() => props.onReopen()}>
          {t("browser.signIn.reopen")}
        </Button>
      </Show>
    </ConfirmDialog>
  );
}
