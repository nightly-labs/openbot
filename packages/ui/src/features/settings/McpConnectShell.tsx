/**
 * What the connect dialogs share: the step between choosing an app and giving it to an agent.
 *
 * A server with a credential can fail for reasons the user can fix in the moment - a key pasted
 * short, a key for the wrong workspace, a server that is down. Installing first puts that failure
 * inside an agent's next answer, where it reads as the agent being broken. So a connect dialog
 * connects once, and only then does the caller offer the install.
 *
 * A server's ways in are not one dialog with a switch in it. Signing in at the server's own page and
 * pasting a key from its settings are different acts, so each has its own dialog: `McpSignInDialog`
 * and `McpKeyDialog`. What they share is here - the failure, the Cancel button, and the attempt
 * behind them. The frame is `WizardDialog`, the same connect dialog that GitHub and Slack use.
 *
 * A connection that worked is not reported here. The dialog closes on it and the page behind says
 * the app is connected: an answer the user has to dismiss would make the working case the slow one.
 * Only the states the user can act on stay - the wait, and the failure.
 *
 * Neither dialog saves. The connected configuration goes back through `onConnected`, so a credential
 * stays out of the store until a connection with it worked.
 */

import type { McpServerConfig, McpTestResult } from "@openbot/contracts/ipc";
import { Alert, AlertContent, AlertDescription, AlertIcon, AlertTitle, Button, OctagonX, Puzzle } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createSignal, createStore, Show } from "solid-js";
import { useText } from "../../text";
import { WizardDialog } from "./IntegrationLayout";

/** What is being connected, in the words the listing uses for it. */
export interface McpConnectSubject {
  name: string;
  iconUrl: string | null;
  /** The configuration to connect with, before a credential is part of it. */
  config: McpServerConfig;
}

/** What every connect dialog needs, whatever the user does to get in. */
export interface McpConnectBaseProps {
  open: boolean;
  subject: McpConnectSubject;
  /** Connects once and answers what it found. Nothing is saved by asking. */
  onTest: (config: McpServerConfig) => Promise<McpTestResult>;
  /** The connection worked, with the configuration that made it work. The dialog is done here. */
  onConnected: (config: McpServerConfig) => void;
  onCancel: () => void;
  /** Starts the attempt when the dialog opens: the click that opened it already asked to connect. */
  connectOnOpen?: boolean | undefined;
}

/**
 * One record, because these move together: an attempt writes `phase` and clears `error`, and a
 * refusal writes both. A connection that worked leaves no state behind - the dialog has closed.
 *
 * What the user typed is not here. Only the key dialog has a form, so only it holds one; the shell
 * holds what every way in has, which is an attempt and what it came back with.
 */
export interface ConnectState {
  phase: "idle" | "connecting" | "failed";
  error: string;
}

/**
 * The attempt, which both dialogs run the same way: build the configuration, connect with it, and
 * either hand the working one over or say what came back.
 *
 * `authorize` is the part that differs - today the typed values written into the configuration, or
 * the configuration as the listing states it. Every write is guarded by the attempt count, so an
 * answer that arrives after the user changed the credential is dropped: it describes what was sent,
 * not what is on screen.
 */
export function createConnectRun(props: Pick<McpConnectBaseProps, "onTest" | "onConnected">) {
  const { t, errorMessage, sourceText } = useText();
  const [state, setState] = createStore<ConnectState>({ phase: "idle", error: "" });
  let run = 0;
  const busy = () => state.phase === "connecting";

  function forget() {
    // The credential changed, so the previous refusal describes one that is no longer being offered.
    setState((current) => {
      if (!busy()) current.phase = "idle";
      current.error = "";
    });
  }

  async function attempt(authorize: () => Promise<McpServerConfig>) {
    if (busy()) return;
    const started = ++run;
    setState((current) => {
      current.phase = "connecting";
      current.error = "";
    });
    try {
      const authorized = await authorize();
      if (started !== run) return;
      const result = await props.onTest(authorized);
      if (started !== run) return;
      if (result.error) {
        setState((current) => {
          current.phase = "failed";
          current.error = sourceText(result.error ?? "");
        });
        return;
      }
      props.onConnected(authorized);
    } catch (cause) {
      if (started !== run) return;
      setState((current) => {
        current.phase = "failed";
        current.error = errorMessage(cause, t("mcp.connect.unreachable"));
      });
    }
  }

  return { state, busy, forget, attempt };
}

export interface McpConnectShellProps extends Pick<McpConnectBaseProps, "open" | "subject" | "onCancel"> {
  state: ConnectState;
  busy: () => boolean;
  /** The line under the name: what this way in is about to do. One sentence. */
  description: JSX.Element;
  /** What this way in asks for. A sign-in asks for nothing here. */
  children?: JSX.Element;
  /** The submit. */
  action: JSX.Element;
  onSubmit: () => void;
  /** Widens the dialog for a page drawn inside it. */
  wide?: boolean | undefined;
  /** Lets the user close the dialog while it waits, and stops the wait first. Without it, the wait keeps the dialog open. */
  onCancelBusy?: (() => void) | undefined;
}

/** The icon of the app being connected, for the tile in the dialog head. */
export function McpConnectMark(props: { iconUrl: string | null | undefined }) {
  const [failed, setFailed] = createSignal<string | null>(null);
  const url = () => (props.iconUrl && props.iconUrl !== failed() ? props.iconUrl : null);
  return (
    <Show when={url()} fallback={<Puzzle aria-hidden="true" />} keyed>
      {(src) => <img src={src} alt="" onError={() => setFailed(src)} />}
    </Show>
  );
}

/** The parts every plugin connect dialog shows, in the shared connect dialog: the failure and the buttons. */
export function McpConnectShell(props: McpConnectShellProps) {
  const { t } = useText();
  const close = () => {
    if (!props.busy()) return props.onCancel();
    if (!props.onCancelBusy) return;
    props.onCancelBusy();
    props.onCancel();
  };
  const stuck = () => props.busy() && !props.onCancelBusy;
  return (
    <WizardDialog
      open={props.open}
      nested
      wide={props.wide}
      closeLabel={t("mcp.connect.close", { name: props.subject.name })}
      closeDisabled={stuck()}
      dismissible={!props.busy()}
      onClose={close}
      logo={<McpConnectMark iconUrl={props.subject.iconUrl} />}
      link={props.state.phase === "failed" ? "broken" : "connecting"}
      title={t("mcp.connect.title", { name: props.subject.name })}
      description={props.description}
      onSubmit={props.onSubmit}
      footer={
        <>
          <Button type="button" size="sm" variant="ghost" disabled={stuck()} onClick={close}>
            {t("common.cancel")}
          </Button>
          {props.action}
        </>
      }
    >
      {props.children}
      {/* Only what the user can act on: the connection that worked has closed the dialog. */}
      <Show when={props.state.phase === "failed"}>
        <Alert tone="danger" role="alert">
          <AlertIcon>
            <OctagonX />
          </AlertIcon>
          <AlertContent>
            <AlertTitle>{t("mcp.connect.notConnected")}</AlertTitle>
            <AlertDescription>{props.state.error}</AlertDescription>
          </AlertContent>
        </Alert>
      </Show>
    </WizardDialog>
  );
}
