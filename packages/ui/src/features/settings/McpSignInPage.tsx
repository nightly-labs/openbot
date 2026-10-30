/**
 * A joined server's sign-in page, on that host's browser and drawn here.
 *
 * The grant comes back on an address the host listens on, and only a browser on the host can reach
 * it. So the host opens the server's page in its own browser, and this client shows it as the live
 * view any host tab has: the user signs in there, the server sends the browser back to the host, and
 * the host keeps what it gets. Nothing comes back through this client, so the web client signs in
 * the same way the desktop does.
 *
 * The page runs in a session of its own on the host, so the sign-in leaves no cookies where agents
 * browse.
 */

import { Alert, AlertDescription, Button, Field, Input, ShieldCheck, Text } from "@openbot/ui";
import { createSignal, Show } from "solid-js";
import { useText } from "../../text";
import BrowserLiveView, { type BrowserViewRuntime } from "../browser/BrowserLiveView";
import { WizardDialog } from "./IntegrationLayout";
import { McpConnectMark } from "./McpConnectShell";

/** The host tab with the sign-in page, and the way to watch it. */
export interface McpSignInPageSource {
  runtime: BrowserViewRuntime;
  tabId: string;
  /** Whether the host pastes and copies for a live view, so a password manager's copy works. */
  clipboard: boolean;
}

/** The page itself, at the shape of the host's frame. */
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

/** The line under the page: where the sign-in stays. */
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
  /** The server the sign-in is for, as its row names it. */
  name: string;
  /** The icon of the server, when its listing has one. */
  iconUrl?: string | null | undefined;
  hostName: string;
  page: McpSignInPageSource;
  /**
   * Stops the sign-in. The dialog stays until the wait ends, and the caller removes it then, the
   * same as when the host took the grant.
   */
  onCancel: () => void;
}

/** The page in its own dialog, for the MCP list. It is there for as long as the sign-in waits. */
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

/** The one button of a sign-in that waits: it stops the sign-in. */
function CancelSignIn(props: { cancelling: boolean; onCancel: () => void }) {
  const { t } = useText();
  return (
    <Button type="button" size="sm" variant="ghost" loading={props.cancelling} onClick={props.onCancel}>
      {t("mcp.panel.cancelSignIn")}
    </Button>
  );
}

/** A relayed sign-in that waits in the user's own browser (`sign-in-relay-v1`). */
export interface McpSignInRelaySource {
  /** The host name of the sign-in page, so the user can check it before they sign in. */
  authorizeHost: string;
  /** Whether this computer takes the callback. When it does not, only a pasted address ends the sign-in. */
  listening: boolean;
  /** Whether a pasted address can end the sign-in. A device page returns nowhere, so it has no field. */
  pasteable: boolean;
}

export interface McpSignInRelayActions {
  /**
   * Opens the page. Nothing opens it before: the host chose the page, so the user checks its host name
   * first. A browser also blocks a page that no click opened. A rejection is shown under the field.
   */
  onOpen: () => void | Promise<void>;
  /** Sends the address that the browser shows. A rejection is shown under the field. */
  onPaste: (address: string) => Promise<void>;
}

export interface McpSignInRelayDialogProps extends McpSignInRelayActions {
  name: string;
  /** The icon of the server, when its listing has one. */
  iconUrl?: string | null | undefined;
  hostName: string;
  page: McpSignInRelaySource;
  onCancel: () => void;
}

/** What the dialog of a relayed sign-in says, as its page asks for. */
export function relayDescriptionKey(page: McpSignInRelaySource) {
  if (!page.pasteable) return "mcp.signIn.relayDeviceDescription";
  return page.listening ? "mcp.signIn.relayDescription" : "mcp.signIn.relayOpenDescription";
}

/**
 * The open button and the address field of a relayed sign-in. A page that returns nowhere has no
 * field, so only a failed open shows under the button.
 */
export function McpSignInRelayControls(props: McpSignInRelayActions & { page: McpSignInRelaySource }) {
  const { t, errorMessage } = useText();
  const [address, setAddress] = createSignal("");
  const [sending, setSending] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const openPage = async () => {
    setError(null);
    try {
      await props.onOpen();
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
      <Button type="button" class="mcp-sign-in-relay-open" onClick={() => void openPage()}>
        {t("mcp.signIn.relayOpen")}
      </Button>
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

/**
 * A joined server's sign-in that the host started and the user finishes in their own browser. The
 * callback comes back to this computer, which sends it to the host. The address field is for a
 * browser that cannot reach this computer's listener, such as the web client's.
 */
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
