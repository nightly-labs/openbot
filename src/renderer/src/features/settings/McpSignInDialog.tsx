/**
 * The way in that leaves the app: the server's own page asks, and this side only learns whether the
 * connection that follows works. The button says where the user is going, the way every other button
 * that opens a browser does.
 *
 * Nothing about the sign-in happens here, and nothing about it is faked here either. The connect
 * attempt is what starts it: the listing installs as a bridge that holds an OAuth client, and that
 * bridge opens the browser and keeps the token beside itself. So this dialog is the shell, the
 * server's own words, and one button. The day the main process signs in for itself, the exchange
 * goes in front of `onTest`, and the states on screen stay as they read.
 */

import { Show } from "solid-js";
import { Button, ExternalLink } from "../../components/ui";
import { createConnectRun, type McpConnectBaseProps, McpConnectShell } from "./McpConnectShell";

export type McpSignInDialogProps = McpConnectBaseProps;

export function McpSignInDialog(props: McpSignInDialogProps) {
  const { state, busy, attempt } = createConnectRun(props);

  return (
    <McpConnectShell
      {...props}
      state={state}
      busy={busy}
      description={`Sign in to your ${props.subject.name} account. OpenBot gets the tools that account can reach, and no password.`}
      onSubmit={() => void attempt(async () => props.subject.config)}
      action={
        <Button
          class="mcp-connect-primary"
          type="submit"
          loading={busy()}
          loadingLabel="Waiting for the browser…"
          disabled={busy()}
        >
          {state.phase === "failed" ? "Try again" : `Continue to ${props.subject.name}`}
          <Show when={state.phase !== "failed"}>
            <ExternalLink aria-hidden="true" />
          </Show>
        </Button>
      }
    />
  );
}
