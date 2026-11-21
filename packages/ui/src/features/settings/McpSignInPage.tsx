import { Alert, AlertDescription, Button, CopyButton, Field, Input, ShieldCheck, Text } from "@openbot/ui";
import { createSignal, Show } from "solid-js";
import { useText } from "../../text";
import BrowserLiveView, { type BrowserViewRuntime } from "../browser/BrowserLiveView";
import { WizardDialog } from "./IntegrationLayout";
import { McpConnectMark } from "./McpConnectShell";

export interface McpSignInPageSource {
  runtime: BrowserViewRuntime;
  tabId: string;
  clipboard: boolean;
}

export function McpSignInPage(props: { page: McpSignInPageSource }) {
  const [shape, setShape] = createSignal("4 / 3");
  return (
    <div class="mcp-sign-in-page" style={{ "aspect-ratio": shape() }}>
      <BrowserLiveView
        runtime={props.page.runtime}
        tabId={props.page.tabId}
        active
        clipboard={props.page.clipboard}
        onFrameSize={(size) => setShape(`${size.width} / ${size.height}`)}
      />
    </div>
  );
}

export function McpSignInPageNote(props: { hostName: string }) {
  const { t } = useText();
  return (
    <p class="mcp-connect-privacy mcp-sign-in-page-note">
      <ShieldCheck aria-hidden="true" />
      <Text as="span" tone="muted">
        {t("mcp.connect.keptOn", { host: props.hostName })}
      </Text>
    </p>
  );
}

export interface McpSignInPageDialogProps {
  name: string;
  iconUrl?: string | null | undefined;
  hostName: string;
  page: McpSignInPageSource;
  onCancel: () => void;
}

export function McpSignInPageDialog(props: McpSignInPageDialogProps) {
  const { t } = useText();
  const [cancelling, setCancelling] = createSignal(false);
  const cancel = () => {
    if (cancelling()) return;
    setCancelling(true);
    props.onCancel();
  };
  return (
    <WizardDialog
      open
      nested
      wide
      closeLabel={t("mcp.panel.cancelSignIn")}
      onClose={cancel}
      logo={<McpConnectMark iconUrl={props.iconUrl} />}
      title={t("mcp.panel.signInTo", { name: props.name })}
      description={t("mcp.signIn.pageDescription", { host: props.hostName })}
      footer={<CancelSignIn cancelling={cancelling()} onCancel={cancel} />}
    >
      <McpSignInPage page={props.page} />
      <McpSignInPageNote hostName={props.hostName} />
    </WizardDialog>
  );
}

function CancelSignIn(props: { cancelling: boolean; onCancel: () => void }) {
  const { t } = useText();
  return (
    <Button type="button" size="sm" variant="ghost" loading={props.cancelling} onClick={props.onCancel}>
      {t("mcp.panel.cancelSignIn")}
    </Button>
  );
}

export interface McpSignInRelaySource {
  authorizeHost: string;
  url: string | null;
  listening: boolean;
  pasteable: boolean;
}

export interface McpSignInRelayActions {
  onOpen: () => void | Promise<void>;
  onPaste: (address: string) => Promise<void>;
}

export interface McpSignInRelayDialogProps extends McpSignInRelayActions {
  name: string;
  iconUrl?: string | null | undefined;
  hostName: string;
  page: McpSignInRelaySource;
  onCancel: () => void;
}

export function relayDescriptionKey(page: McpSignInRelaySource) {
  if (!page.pasteable) return "mcp.signIn.relayDeviceDescription";
  return page.listening ? "mcp.signIn.relayDescription" : "mcp.signIn.relayOpenDescription";
}

export function McpSignInRelayControls(
  props: Pick<McpSignInRelayActions, "onPaste"> &
    Partial<Pick<McpSignInRelayActions, "onOpen">> & { page: McpSignInRelaySource },
) {
  const { t, errorMessage } = useText();
  const [address, setAddress] = createSignal("");
  const [sending, setSending] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const openPage = async () => {
    setError(null);
    try {
      await props.onOpen?.();
    } catch (cause) {
      setError(errorMessage(cause, t("error.mcp.relayEnded")));
    }
  };
  const send = async (event: SubmitEvent) => {
    event.preventDefault();
    if (sending() || !address().trim()) return;
    setSending(true);
    setError(null);
    try {
      await props.onPaste(address());
    } catch (cause) {
      setError(errorMessage(cause, t("error.mcp.relayAddressInvalid")));
    } finally {
      setSending(false);
    }
  };
  return (
    <>
      <Show when={props.onOpen}>
        <div class="mcp-sign-in-relay-open">
          <Button type="button" onClick={() => void openPage()}>
            {t("mcp.signIn.relayOpen")}
          </Button>
          <Show when={props.page.url}>
            {(url) => <CopyButton value={url()} label={t("mcp.signIn.relayCopy")} iconOnly size="icon" />}
          </Show>
        </div>
      </Show>
      <Show
        when={props.page.pasteable}
        fallback={
          <Show when={error()}>
            {(message) => (
              <Alert tone="danger" report={false} role="alert">
                <AlertDescription>{message()}</AlertDescription>
              </Alert>
            )}
          </Show>
        }
      >
        <form class="mcp-sign-in-relay-form" onSubmit={send}>
          <Field
            label={t("mcp.signIn.relayAddress")}
            description={t(props.page.listening ? "mcp.signIn.relayPasteHint" : "mcp.signIn.relayPasteRequired")}
            error={error()}
          >
            <div class="mcp-sign-in-relay-row">
              <Input type="url" autocomplete="off" spellcheck={false} value={address()} onValueChange={setAddress} />
              <Button type="submit" variant="outline" loading={sending()} disabled={!address().trim()}>
                {t("mcp.signIn.relaySend")}
              </Button>
            </div>
          </Field>
        </form>
      </Show>
    </>
  );
}

export function McpSignInRelayDialog(props: McpSignInRelayDialogProps) {
  const { t } = useText();
  const [cancelling, setCancelling] = createSignal(false);
  const cancel = () => {
    if (cancelling()) return;
    setCancelling(true);
    props.onCancel();
  };
  return (
    <WizardDialog
      open
      nested
      closeLabel={t("mcp.panel.cancelSignIn")}
      onClose={cancel}
      logo={<McpConnectMark iconUrl={props.iconUrl} />}
      title={t("mcp.panel.signInTo", { name: props.name })}
      description={t(relayDescriptionKey(props.page), { page: props.page.authorizeHost, host: props.hostName })}
      footer={<CancelSignIn cancelling={cancelling()} onCancel={cancel} />}
    >
      <McpSignInRelayControls page={props.page} onOpen={props.onOpen} onPaste={props.onPaste} />
      <McpSignInPageNote hostName={props.hostName} />
    </WizardDialog>
  );
}
