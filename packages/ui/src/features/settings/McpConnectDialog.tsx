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
  flows: readonly [McpConnectFlow, ...McpConnectFlow[]];
  onTest: (config: McpServerConfig) => Promise<McpTestResult>;
  onSignIn: (config: McpServerConfig) => Promise<McpTestResult>;
  onConnected: (config: McpServerConfig) => void;
  onCancel: () => void;
  onOpenUrl?: ((url: string) => void) | undefined;
  hostName?: string | undefined;
  signInHostName?: string | undefined;
  onCancelSignIn?: (() => void) | undefined;
  onCopySignInLink?: (() => Promise<void>) | undefined;
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
          onCopySignInLink={props.onCopySignInLink}
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
