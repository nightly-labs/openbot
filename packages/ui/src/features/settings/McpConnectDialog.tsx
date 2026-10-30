/**
 * The connect step of one plugin app: the dialog that the listing's way in asks for. The Marketplace
 * window and its stories open this one, so both show the same step.
 *
 * The Connect click that opens it already asked to connect, so a sign-in and a local server start at
 * once. A key cannot: the dialog waits for it.
 */

import type { McpServerConfig, McpTestResult } from "@openbot/contracts/ipc";
import type { McpConnectFlow } from "@openbot/contracts/mcp-connect-flows";
import type { JSX } from "@solidjs/web";
import { Match, Switch } from "solid-js";
import type { McpConnectSubject } from "./McpConnectShell";
import { McpKeyDialog } from "./McpKeyDialog";
import { McpLocalDialog } from "./McpLocalDialog";
import { McpSignInDialog } from "./McpSignInDialog";

export interface McpConnectDialogProps {
  subject: McpConnectSubject;
  flow: McpConnectFlow;
  /** Connects once with a typed credential, or with none. Nothing is saved by asking. */
  onTest: (config: McpServerConfig) => Promise<McpTestResult>;
  /** Signs in at the server's own page, then connects once. */
  onSignIn: (config: McpServerConfig) => Promise<McpTestResult>;
  onConnected: (config: McpServerConfig) => void;
  onCancel: () => void;
  /** Opens the page of a key or of a setup guide. Without it the dialog shows no link. */
  onOpenUrl?: ((url: string) => void) | undefined;
  /** The joined server that keeps the credential. Absent when this computer keeps it. */
  hostName?: string | undefined;
  /** The joined server whose host signs in, when it relays the sign-in. */
  signInHostName?: string | undefined;
  /** Stops the sign-in, for the user who closes the dialog while it waits. */
  onCancelSignIn?: (() => void) | undefined;
  /** What opens over a sign-in while it waits, such as the page of a relayed sign-in. */
  signInExtra?: JSX.Element;
}

export function McpConnectDialog(props: McpConnectDialogProps) {
  return (
    <Switch>
      <Match when={props.flow.kind === "link"}>
        <McpSignInDialog
          open={true}
          subject={props.subject}
          onTest={props.onSignIn}
          onConnected={props.onConnected}
          onCancel={props.onCancel}
          connectOnOpen
          hostName={props.signInHostName}
          onCancelSignIn={props.onCancelSignIn}
        />
        {props.signInExtra}
      </Match>
      <Match when={props.flow.kind === "key" ? props.flow : null} keyed>
        {(flow) => (
          <McpKeyDialog
            open={true}
            subject={props.subject}
            flow={flow}
            onTest={props.onTest}
            onConnected={props.onConnected}
            onCancel={props.onCancel}
            onOpenUrl={props.onOpenUrl}
            hostName={props.hostName}
          />
        )}
      </Match>
      <Match when={props.flow.kind === "local" ? props.flow : null} keyed>
        {(flow) => (
          <McpLocalDialog
            open={true}
            subject={props.subject}
            flow={flow}
            onTest={props.onTest}
            onConnected={props.onConnected}
            onCancel={props.onCancel}
            onOpenUrl={props.onOpenUrl}
            connectOnOpen
          />
        )}
      </Match>
    </Switch>
  );
}
