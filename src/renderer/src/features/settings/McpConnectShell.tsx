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
 * and `McpKeyDialog`. What they share is here - the two marks, the header, the failure, the footer,
 * and the attempt behind them.
 *
 * A connection that worked is not reported here. The dialog closes on it and the page behind says
 * the app is connected: an answer the user has to dismiss would make the working case the slow one.
 * Only the states the user can act on stay - the wait, and the failure.
 *
 * Neither dialog saves. The connected configuration goes back through `onConnected`, so a credential
 * stays out of the store until a connection with it worked.
 */

import { AppLogo } from "@openbot/brand";
import type { McpServerConfig, McpTestResult } from "@openbot/contracts/ipc";
import type { JSX } from "@solidjs/web";
import { createStore, Show } from "solid-js";
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Dialog,
  IconButton,
  OctagonX,
  X,
} from "../../components/ui";
import { errorMessage } from "../../error-message";
import { PluginIcon } from "./MarketplacePluginDetail";

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
          current.error = result.error ?? "";
        });
        return;
      }
      props.onConnected(authorized);
    } catch (cause) {
      if (started !== run) return;
      setState((current) => {
        current.phase = "failed";
        current.error = errorMessage(cause, "That server could not be reached.");
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
}

/** The parts both dialogs show: the two ends of the connection, the header, the failure, the button. */
export function McpConnectShell(props: McpConnectShellProps) {
  return (
    <Dialog.Root
      open={props.open}
      onOpenChange={(open) => {
        if (!open && !props.busy()) props.onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="mcp-connect-backdrop">
          <Dialog.Content class="mcp-connect-dialog" as="section">
            <header class="mcp-connect-header">
              {/* The two ends of the connection, side by side: this computer, and the app. It is the
                  one picture the dialog needs, and it says what is about to be joined. */}
              <div class="mcp-connect-marks" aria-hidden="true">
                <span class="mcp-connect-mark">
                  <AppLogo variant="production" animation="look-around" />
                </span>
                <span class="mcp-connect-dots" />
                <PluginIcon iconUrl={props.subject.iconUrl} class="mcp-connect-mark-icon" />
              </div>
              <Dialog.Title class="mcp-connect-title">Connect {props.subject.name}</Dialog.Title>
              <Dialog.Description class="mcp-connect-description">{props.description}</Dialog.Description>
            </header>

            <form
              class="mcp-connect-form"
              /* A missing key is reported under the field, in the field's own words. Left to the
                 browser, the same miss is a native bubble that blocks the submit. */
              novalidate
              onSubmit={(event) => {
                event.preventDefault();
                props.onSubmit();
              }}
            >
              {props.children}

              {/* Only what the user can act on: the connection that worked has closed the dialog. */}
              <div class="mcp-connect-status" aria-live="polite">
                <Show when={props.state.phase === "failed"}>
                  <Alert tone="danger" role="alert">
                    <AlertIcon>
                      <OctagonX />
                    </AlertIcon>
                    <AlertContent>
                      <AlertTitle>Not connected</AlertTitle>
                      <AlertDescription>{props.state.error}</AlertDescription>
                    </AlertContent>
                  </Alert>
                </Show>
              </div>

              {props.action}
            </form>

            {/* Last in the order, first in the corner: the dialog opens with what it asks for
                focused, not with the way out focused. */}
            <IconButton
              class="mcp-connect-close"
              label={`Close connect ${props.subject.name}`}
              variant="ghost"
              disabled={props.busy()}
              onClick={props.onCancel}
            >
              <X />
            </IconButton>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
