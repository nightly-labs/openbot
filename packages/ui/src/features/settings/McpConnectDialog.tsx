/**
 * The connect step of one plugin app: the dialog that the listing's way in asks for. The Marketplace
 * window and its stories open this one, so both show the same step.
 *
 * The Connect click that opens it already asked to connect, so a sign-in and a local server start at
 * once. A key cannot: the dialog waits for it.
 *
 * A listing with a sign-in and a key opens on the first, and the dialog offers the other one under
 * it. Leaving a sign-in that waits for the browser stops that sign-in first.
 */

import type { McpServerConfig, McpTestResult } from "@openbot/contracts/ipc";
import type { McpConnectFlow } from "@openbot/contracts/mcp-connect-flows";
import { Button } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createSignal, Match, Show, Switch } from "solid-js";
import { useText } from "../../text";
import type { McpConnectSubject } from "./McpConnectShell";
import { McpKeyDialog } from "./McpKeyDialog";
import { McpLocalDialog } from "./McpLocalDialog";
import { McpSignInDialog } from "./McpSignInDialog";

export interface McpConnectDialogProps {
  subject: McpConnectSubject;
  /** The ways in that the user can take here, in the listing's order. The dialog opens on the first. */
  flows: readonly [McpConnectFlow, ...McpConnectFlow[]];
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
  const { t } = useText();
  const [index, setIndex] = createSignal(0);
  const flow = () => props.flows[index()] ?? props.flows[0];
  const keyFlow = () => {
    const current = flow();
    return current.kind === "key" ? current : null;
  };
  const localFlow = () => {
    const current = flow();
    return current.kind === "local" ? current : null;
  };
  /* The way in that is not on screen. A local server is never offered in place of a sign-in or a key. */
  const otherIndex = () => props.flows.findIndex((other, at) => at !== index() && other.kind !== "local");
  function useOther() {
    const next = otherIndex();
    if (next === -1) return;
    if (flow().kind === "link") props.onCancelSignIn?.();
    setIndex(next);
  }
  const other = () => {
    const kind = props.flows[otherIndex()]?.kind;
    if (kind === "link") return t("mcp.connect.useSignIn");
    if (kind === "key") return t("mcp.connect.useKey");
    return null;
  };
  /* Each dialog makes its own button: one element cannot be in the dialog that closes and in the one that opens. */
  const alternative = () => (
    <Show when={other()}>
      {(label) => (
        <Button type="button" variant="outline" onClick={useOther}>
          {label()}
        </Button>
      )}
    </Show>
  );
  return (
    <Switch>
      <Match when={flow().kind === "link"}>
        <McpSignInDialog
          open={true}
          subject={props.subject}
          onTest={props.onSignIn}
          onConnected={props.onConnected}
          onCancel={props.onCancel}
          connectOnOpen
          hostName={props.signInHostName}
          onCancelSignIn={props.onCancelSignIn}
          alternative={alternative()}
        />
        {props.signInExtra}
      </Match>
      <Match when={keyFlow()} keyed>
        {(key) => (
          <McpKeyDialog
            open={true}
            subject={props.subject}
            flow={key}
            onTest={props.onTest}
            onConnected={props.onConnected}
            onCancel={props.onCancel}
            onOpenUrl={props.onOpenUrl}
            hostName={props.hostName}
            alternative={alternative()}
          />
        )}
      </Match>
      <Match when={localFlow()} keyed>
        {(local) => (
          <McpLocalDialog
            open={true}
            subject={props.subject}
            flow={local}
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
