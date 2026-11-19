import type { McpLocalFlow } from "@openbot/contracts/mcp-connect-flows";
import { Alert, AlertContent, AlertDescription, AlertIcon, Button, ExternalLink, Info, Text } from "@openbot/ui";
import { createMemo, For, onSettled, Show } from "solid-js";
import { useText } from "../../text";
import { createConnectRun, type McpConnectBaseProps, McpConnectShell } from "./McpConnectShell";

export interface McpLocalDialogProps extends McpConnectBaseProps {
  flow: McpLocalFlow;
  onOpenUrl?: ((url: string) => void) | undefined;
}

export function McpLocalDialog(props: McpLocalDialogProps) {
  const { t } = useText();
  const { state, busy, attempt } = createConnectRun(props);
  const connect = () => void attempt(async () => props.subject.config);
  onSettled(() => {
    if (props.connectOnOpen) connect();
  });
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
      onSubmit={connect}
      action={
        <Button type="submit" size="sm" loading={busy()} loadingLabel={t("common.connecting")}>
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
