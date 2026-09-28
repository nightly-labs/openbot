/**
 * The way in that another app on this computer holds: a desktop app runs its own MCP server, and
 * the user turns it on there. Nothing is typed and nothing is signed in to, so the dialog is the
 * listing's steps, what the server can do, and one button that connects to see that it answers.
 *
 * The steps stay on screen after a failure. A server that did not answer is almost always one that
 * is not on yet, and the steps are what turns it on.
 */

import { Alert, AlertContent, AlertDescription, AlertIcon, Button, ExternalLink, Info, Text } from "@openbot/ui";
import { createMemo, For, Show } from "solid-js";
import { useText } from "../../text";
import { createConnectRun, type McpConnectBaseProps, McpConnectShell } from "./McpConnectShell";
import type { McpLocalFlow } from "./mcp-connect-auth";

export interface McpLocalDialogProps extends McpConnectBaseProps {
  /** The steps that turn the server on, as the listing declares them. */
  flow: McpLocalFlow;
  /** Opens the app's own setup page. Without it the dialog shows no link. */
  onOpenUrl?: (url: string) => void;
}

export function McpLocalDialog(props: McpLocalDialogProps) {
  const { t } = useText();
  const { state, busy, attempt } = createConnectRun(props);
  const docs = createMemo(() => {
    const url = props.flow.docsUrl;
    return url && props.onOpenUrl ? { url, label: props.flow.docsLabel ?? t("mcp.local.docs") } : null;
  });

  return (
    <McpConnectShell
      {...props}
      state={state}
      busy={busy}
      description={t("mcp.local.description", { name: props.subject.name })}
      onSubmit={() => void attempt(async () => props.subject.config)}
      action={
        <Button
          class="mcp-connect-primary"
          type="submit"
          loading={busy()}
          loadingLabel={t("common.connecting")}
          disabled={busy()}
        >
          {state.phase === "failed" ? t("common.tryAgain") : t("mcp.connect.connect")}
        </Button>
      }
    >
      <div class="mcp-connect-card">
        <div class="mcp-connect-row">
          <h3 class="mcp-local-heading">{t("mcp.local.stepsTitle", { name: props.subject.name })}</h3>
          <Show when={docs()}>
            {(page) => (
              <Button
                class="mcp-connect-docs"
                type="button"
                variant="link"
                onClick={() => props.onOpenUrl?.(page().url)}
              >
                {page().label}
                <ExternalLink aria-hidden="true" />
              </Button>
            )}
          </Show>
          <ol class="mcp-local-steps">
            <For each={props.flow.steps}>{(step) => <li>{step}</li>}</For>
          </ol>
        </div>
        <p class="mcp-connect-row mcp-local-address">
          <Text as="span" tone="muted">
            {t("mcp.local.address")}
          </Text>
          <code>{props.subject.config.url}</code>
        </p>
      </div>

      <Show when={props.flow.note}>
        {(note) => (
          <Alert tone="neutral">
            <AlertIcon>
              <Info />
            </AlertIcon>
            <AlertContent>
              <AlertDescription>{note()}</AlertDescription>
            </AlertContent>
          </Alert>
        )}
      </Show>
    </McpConnectShell>
  );
}
