/**
 * The way in that stays here: a credential from the server's own settings page, pasted and proved
 * before it is saved anywhere.
 */

import { Button, ExternalLink, Field, Input, ShieldCheck, Text } from "@openbot/ui";
import { createMemo, createStore, For, Show } from "solid-js";
import { createConnectRun, type McpConnectBaseProps, McpConnectShell } from "./McpConnectShell";
import { applyMcpFlow, type McpAuthValues, type McpKeyFlow, mcpFlowComplete, mcpFlowError } from "./mcp-connect-auth";

export interface McpKeyDialogProps extends McpConnectBaseProps {
  /** The credentials this server asks for, as its listing declares them. */
  flow: McpKeyFlow;
  /** Opens the page the key is created on. Without it the dialog shows no link. */
  onOpenUrl?: (url: string) => void;
  /** The joined server whose host keeps the credential. Absent when this computer keeps it. */
  hostName?: string;
}

export function McpKeyDialog(props: McpKeyDialogProps) {
  const { state, busy, forget, attempt } = createConnectRun(props);
  /* The form, which only this way in has: what is typed, and whether the user has tried to connect
     with it yet. The second gates the "fill this in" copy, so an untouched dialog asks rather than
     complains. */
  const [form, setForm] = createStore<{ values: McpAuthValues; touched: boolean }>({ values: {}, touched: false });
  const complete = createMemo(() => mcpFlowComplete(props.flow, form.values));
  /* The page the key is made on, when the flow names one and the caller can open it. */
  const docs = createMemo(() => {
    const url = props.flow.docsUrl;
    return url && props.onOpenUrl ? { url, label: props.flow.docsLabel ?? "Get a key" } : null;
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
      const error = mcpFlowError(props.subject.config, props.flow, form.values);
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
          ? `Paste a credential from your ${props.subject.name} account. OpenBot connects with it and keeps it on ${props.hostName ?? "this computer"}.`
          : `${props.subject.name} asks for no credential. OpenBot connects once to see which tools it offers.`
      }
      onSubmit={submit}
      action={
        <Button
          class="mcp-connect-primary"
          type="submit"
          loading={busy()}
          loadingLabel="Connecting…"
          disabled={busy() || (form.touched && !complete())}
        >
          {state.phase === "failed" ? "Try again" : "Connect"}
        </Button>
      }
    >
      {/* The card is what this way in asks for, and nothing else. The address the server answers
          on is the listing's business, unless the listing asks the user for their own link. */}
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
                    form.touched && !field.optional && !(form.values[field.id] ?? "").trim() ? "Required." : undefined
                  }
                >
                  {/* A link is shown so the user can check what they pasted; a credential is not. */}
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
                {/* The page the key is made on: once, on the first row's label line, and after the
                    field in the order, so the dialog opens with the field focused and not the way out. */}
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
              Kept on {props.hostName ?? "this computer"}.
            </Text>
          </p>
        </div>
      </Show>
    </McpConnectShell>
  );
}
