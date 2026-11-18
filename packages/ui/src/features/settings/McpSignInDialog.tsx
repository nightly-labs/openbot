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

import { MCP_SIGN_IN_TIMEOUT_MS } from "@openbot/contracts/ipc";
import { Alert, AlertDescription, Button, Copy, ExternalLink, Text } from "@openbot/ui";
import { createSignal, onSettled, Show } from "solid-js";
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
  /**
   * Copies the page of a sign-in that this computer's browser shows. Without it the dialog shows no
   * copy button, as for a joined server, whose page is not in this computer's browser.
   */
  onCopySignInLink?: (() => Promise<void>) | undefined;
}

export function McpSignInDialog(props: McpSignInDialogProps) {
  const { t } = useText();
  const { state, busy, attempt } = createConnectRun(props);
  const page = () => (busy() && props.hostName ? props.page : undefined);
  const copyLink = () => (busy() && !props.hostName ? props.onCopySignInLink : undefined);
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
      <Show when={copyLink()}>{(copy) => <McpSignInLinkCopy onCopy={copy()} />}</Show>
      <Show when={props.hostName}>{(host) => <McpSignInPageNote hostName={host()} />}</Show>
    </McpConnectShell>
  );
}

/**
 * A browser can start and show nothing, and OpenBot cannot see that. The link goes to another
 * browser instead. This computer's listener still takes the grant, so the sign-in ends the same way.
 */
function McpSignInLinkCopy(props: { onCopy: () => Promise<void> }) {
  const { t, errorMessage } = useText();
  const [copied, setCopied] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const copy = async () => {
    setError(null);
    try {
      await props.onCopy();
      setCopied(true);
    } catch (cause) {
      setCopied(false);
      setError(errorMessage(cause, t("error.mcp.signInLinkNotReady")));
    }
  };
  return (
    <>
      <p class="mcp-connect-privacy mcp-sign-in-page-note">
        <Text as="span" tone="muted">
          {t("mcp.panel.signInWaiting", { count: MCP_SIGN_IN_TIMEOUT_MS / 60_000 })} {t("mcp.signIn.copyHint")}
        </Text>
      </p>
      <Button type="button" variant="outline" class="mcp-sign-in-copy" onClick={() => void copy()}>
        <Copy size={14} aria-hidden="true" />
        {copied() ? t("common.copied") : t("mcp.signIn.copyLink")}
      </Button>
      <Show when={error()}>
        {(message) => (
          <Alert tone="danger" report={false} role="alert">
            <AlertDescription>{message()}</AlertDescription>
          </Alert>
        )}
      </Show>
    </>
  );
}
