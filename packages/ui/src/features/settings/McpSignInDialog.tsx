/**
 * The way in that leaves the app: the server's own page asks, and this side only learns whether the
 * connection that follows works. The button says where the user is going, the way every other button
 * that opens a browser does.
 *
 * Nothing about the sign-in happens here, and nothing about it is faked here either. The connect
 * attempt is what starts it: the test the main process runs opens the browser, waits for the grant
 * to come back on the address the main process listens on, and only then answers. So this dialog is the shell, the
 * server's own words, and one button, and `busy()` covers the whole trip rather than a request.
 *
 * A grant is a secret, so it never reaches this side. What comes back is the same pass or fail a
 * test of any other server gives.
 */

import { Button, ExternalLink } from "@openbot/ui";
import { onSettled, Show } from "solid-js";
import { useText } from "../../text";
import { createConnectRun, type McpConnectBaseProps, McpConnectShell } from "./McpConnectShell";
import { McpSignInPage, McpSignInPageNote, type McpSignInPageSource } from "./McpSignInPage";

export interface McpSignInDialogProps extends McpConnectBaseProps {
  /**
   * The joined server whose host signs in and keeps the grant. Absent when this computer signs in
   * with its own browser.
   */
  hostName?: string | undefined;
  /** The sign-in page on that host's browser, once the host opened it. */
  page?: McpSignInPageSource | undefined;
  /** Stops the sign-in, for the user who closes the dialog while the browser waits. */
  onCancelSignIn?: (() => void) | undefined;
}

export function McpSignInDialog(props: McpSignInDialogProps) {
  const { t } = useText();
  const { state, busy, attempt } = createConnectRun(props);
  const page = () => (busy() && props.hostName ? props.page : undefined);
  const connect = () => void attempt(async () => props.subject.config);
  onSettled(() => {
    if (props.connectOnOpen) connect();
  });

  return (
    <McpConnectShell
      {...props}
      state={state}
      busy={busy}
      wide={Boolean(page())}
      onCancelBusy={props.onCancelSignIn}
      description={t("mcp.signIn.description", { name: props.subject.name })}
      onSubmit={connect}
      action={
        <Show when={!page()}>
          <Button type="submit" size="sm" loading={busy()} loadingLabel={t("mcp.signIn.waiting")}>
            {/* A joined server's page opens in this dialog, not in another app. */}
            <Show when={state.phase !== "failed" && !props.hostName}>
              <ExternalLink size={14} aria-hidden="true" />
            </Show>
            {state.phase === "failed" ? t("common.tryAgain") : t("mcp.signIn.continue", { name: props.subject.name })}
          </Button>
        </Show>
      }
    >
      <Show when={page()}>{(source) => <McpSignInPage page={source()} />}</Show>
      <Show when={props.hostName}>{(host) => <McpSignInPageNote hostName={host()} />}</Show>
    </McpConnectShell>
  );
}
