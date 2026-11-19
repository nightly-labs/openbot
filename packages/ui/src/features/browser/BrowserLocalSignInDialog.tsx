import { Button, ConfirmDialog, LogIn } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { Show } from "solid-js";

export interface BrowserLocalSignInDialogProps {
  open: boolean;
  site: string;
  server: string;
  windowOpen: boolean;
  pending: boolean;
  error?: string | undefined;
  onReopen: () => void;
  onCancel: () => void;
  onDone: () => Promise<void>;
}

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
