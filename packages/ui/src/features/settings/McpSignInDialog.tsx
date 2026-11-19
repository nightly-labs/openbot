import { MCP_SIGN_IN_TIMEOUT_MS } from "@openbot/contracts/ipc";
import { Alert, AlertDescription, Button, Copy, ExternalLink, Text } from "@openbot/ui";
import { createSignal, onSettled, Show } from "solid-js";
import { useText } from "../../text";
import { createConnectRun, type McpConnectBaseProps, McpConnectShell } from "./McpConnectShell";
import { McpSignInPage, McpSignInPageNote, type McpSignInPageSource } from "./McpSignInPage";

export interface McpSignInDialogProps extends McpConnectBaseProps {
  hostName?: string | undefined;
  page?: McpSignInPageSource | undefined;
  onCancelSignIn?: (() => void) | undefined;
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
