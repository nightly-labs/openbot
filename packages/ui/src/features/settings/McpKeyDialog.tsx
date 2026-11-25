import {
  applyMcpFlow,
  type McpAuthValues,
  type McpKeyFlow,
  mcpFlowComplete,
} from "@openbot/contracts/mcp-connect-flows";
import { Button, ExternalLink, Field, Input, ShieldCheck, Text } from "@openbot/ui";
import { createMemo, createStore, For, Show } from "solid-js";
import { useText } from "../../text";
import { createConnectRun, type McpConnectBaseProps, McpConnectShell } from "./McpConnectShell";
import { mcpFlowError } from "./mcp-connect-auth";

export interface McpKeyDialogProps extends McpConnectBaseProps {
  flow: McpKeyFlow;
  onOpenUrl?: ((url: string) => void) | undefined;
  hostName?: string | undefined;
}

export function McpKeyDialog(props: McpKeyDialogProps) {
  const { t } = useText();
  const { state, busy, forget, attempt } = createConnectRun(props);
  const [form, setForm] = createStore<{ values: McpAuthValues; touched: boolean }>({ values: {}, touched: false });
  const complete = createMemo(() => mcpFlowComplete(props.flow, form.values));
  const docs = createMemo(() => {
    const url = props.flow.docsUrl;
    return url && props.onOpenUrl ? { url, label: props.flow.docsLabel ?? t("mcp.connect.getKey") } : null;
  });

  function edit(id: string, value: string) {
    setForm((current) => {
      current.values[id] = value;
    });
    forget();
  }

  function submit() {
    setForm((current) => {
      current.touched = true;
    });
    if (!complete()) return;
    void attempt(async () => {
      const error = mcpFlowError(props.subject.config, props.flow, form.values, t);
      if (error) throw new Error(error);
      return applyMcpFlow(props.subject.config, props.flow, form.values);
    });
  }

  return (
    <McpConnectShell
      {...props}
      state={state}
      busy={busy}
      description={
        props.flow.fields.length > 0
          ? t("mcp.connect.keyDescription", {
              name: props.subject.name,
              host: props.hostName ?? t("mcp.connect.thisComputer"),
            })
          : t("mcp.connect.noCredentialDescription", { name: props.subject.name })
      }
      onSubmit={submit}
      action={
        <Button
          type="submit"
          size="sm"
          loading={busy()}
          loadingLabel={t("common.connecting")}
          disabled={form.touched && !complete()}
        >
          {state.phase === "failed" ? t("common.tryAgain") : t("mcp.connect.connect")}
        </Button>
      }
    >
      <Show when={props.flow.fields.length > 0}>
        <div class="mcp-connect-card">
          <For each={props.flow.fields}>
            {(field, index) => (
              <div class="mcp-connect-row">
                <Field
                  label={field.label}
                  description={field.hint}
                  required={!field.optional}
                  error={
                    form.touched && !field.optional && !(form.values[field.id] ?? "").trim()
                      ? t("mcp.connect.required")
                      : undefined
                  }
                >
                  <Input
                    type={field.url ? "url" : "password"}
                    autocomplete="off"
                    spellcheck={false}
                    placeholder={field.placeholder}
                    value={form.values[field.id] ?? ""}
                    disabled={busy()}
                    onValueChange={(value) => edit(field.id, value)}
                  />
                </Field>
                <Show when={index() === 0 && docs()}>
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
              </div>
            )}
          </For>

          <p class="mcp-connect-row mcp-connect-privacy">
            <ShieldCheck aria-hidden="true" />
            <Text as="span" tone="muted">
              {t("mcp.connect.keptOn", { host: props.hostName ?? t("mcp.connect.thisComputer") })}
            </Text>
          </p>
        </div>
      </Show>
    </McpConnectShell>
  );
}
