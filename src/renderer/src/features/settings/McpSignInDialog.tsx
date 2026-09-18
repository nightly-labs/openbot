/**
 * The way in that leaves the app: the server's own page asks, and this side only learns that the
 * sign-in finished. The button says where the user is going, the way every other button that opens
 * a browser does.
 */

import type { McpServerConfig } from "@openbot/contracts/ipc";
import { Show } from "solid-js";
import { Button, ExternalLink } from "../../components/ui";
import { createConnectRun, type McpConnectBaseProps, McpConnectShell } from "./McpConnectShell";

export interface McpSignInDialogProps extends McpConnectBaseProps {
  /**
   * Signs in on the server's own page and answers with the configuration that carries the grant.
   * The exchange belongs to the main process; this side only learns that it finished.
   */
  onSignIn: (config: McpServerConfig) => Promise<McpServerConfig>;
}

export function McpSignInDialog(props: McpSignInDialogProps) {
  const { state, busy, attempt } = createConnectRun(props);

  return (
    <McpConnectShell
      {...props}
      state={state}
      busy={busy}
      description={`Sign in to your ${props.subject.name} account. OpenBot gets the tools that account can reach, and no password.`}
      onSubmit={() => void attempt("signing-in", () => props.onSignIn(props.subject.config))}
      action={
        <Button
          class="mcp-connect-primary"
          type="submit"
          loading={busy()}
          loadingLabel={state.phase === "signing-in" ? "Waiting for the browser…" : "Connecting…"}
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
