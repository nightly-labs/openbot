import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { CUSTOM_MCP_LIMITS, type SaveCustomMcpInput } from "@openbot/contracts/ipc";
import { createEffect, createSignal, createStore, For, onSettled, Show } from "solid-js";
import { createScrollFades } from "../../components/createScrollFades";
import {
  Button,
  Dialog,
  Field,
  Heading,
  IconButton,
  Input,
  Plus,
  Puzzle,
  Text,
  Textarea,
  Trash2,
  X,
} from "../../components/ui";
import {
  type CustomMcpDraft,
  type CustomMcpErrors,
  type CustomMcpPairDraft,
  customMcpValue,
  emptyCustomMcpDraft,
  hasCustomMcpError,
  validateCustomMcp,
} from "./custom-mcp-form";

function cloneDraft(draft: CustomMcpDraft): CustomMcpDraft {
  return {
    ...draft,
    env: draft.env.map((row) => ({ ...row })),
    headers: draft.headers.map((row) => ({ ...row })),
  };
}

interface CustomMcpDialogProps {
  open: boolean;
  busy: boolean;
  submitError: string | null;
  takenServerIds: readonly string[];
  onSubmit: (value: SaveCustomMcpInput) => void;
  onCancel: () => void;
}

export function CustomMcpDialog(props: CustomMcpDialogProps) {
  const fades = createScrollFades();
  onSettled(() => fades.stop);
  const [draft, setDraft] = createStore(emptyCustomMcpDraft());
  const [submitted, setSubmitted] = createSignal(false);
  const busy = () => props.busy;
  const errors = () => validateCustomMcp(draft, props.takenServerIds);
  const shown = (): CustomMcpErrors | null => (submitted() ? errors() : null);

  createEffect(
    () => props.open,
    (open, previous) => {
      if (!open || previous) return;
      setDraft(() => cloneDraft(emptyCustomMcpDraft()));
      setSubmitted(false);
    },
  );

  function submit(): void {
    setSubmitted(true);
    if (busy() || hasCustomMcpError(errors())) return;
    props.onSubmit(customMcpValue(draft));
  }

  return (
    <Dialog.Root open={props.open} onOpenChange={(open) => !open && props.onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay class="custom-mcp-backdrop">
          <Dialog.Content as="section" class="custom-mcp-dialog" aria-busy={busy() ? "true" : undefined}>
            <Dialog.Title class="sr-only">Add a custom MCP server</Dialog.Title>
            <Dialog.Description class="sr-only">
              Describe a local command or an HTTP MCP server for your agents.
            </Dialog.Description>

            <header class="custom-mcp-header">
              <span class="custom-mcp-mark" aria-hidden="true">
                <Puzzle />
              </span>
              <div class="custom-mcp-title">
                <Heading as="h2" size="md">
                  Custom MCP
                </Heading>
                <Text tone="muted" variant="caption">
                  A local command or an HTTP server.
                </Text>
              </div>
              <IconButton
                class="custom-mcp-close"
                label="Close"
                variant="ghost"
                disabled={busy()}
                onClick={props.onCancel}
              >
                <X />
              </IconButton>
            </header>

            <form
              class="custom-mcp-body"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <div class={["custom-mcp-form", fades.classes()]} ref={fades.bind} onScroll={fades.measure}>
                <Field
                  label="Server ID"
                  description="Lowercase letters, numbers, hyphens, or underscores."
                  error={shown()?.serverId}
                  required
                >
                  <Input
                    value={draft.serverId}
                    onValueChange={(value) =>
                      setDraft((state) => {
                        state.serverId = value;
                      })
                    }
                    placeholder="notes"
                    autocomplete="off"
                    spellcheck={false}
                    maxlength={INPUT_LIMITS.identifier}
                    disabled={busy()}
                  />
                </Field>

                <Field label="Display name" error={shown()?.displayName} required>
                  <Input
                    value={draft.displayName}
                    onValueChange={(value) =>
                      setDraft((state) => {
                        state.displayName = value;
                      })
                    }
                    placeholder="Notes"
                    maxlength={INPUT_LIMITS.agentName}
                    disabled={busy()}
                  />
                </Field>

                <fieldset class="custom-mcp-transport">
                  <legend>
                    <Text variant="label-sm">How it runs</Text>
                  </legend>
                  <div class="custom-mcp-transport-options">
                    <Button
                      type="button"
                      size="sm"
                      variant={draft.transport === "stdio" ? "default" : "outline"}
                      aria-pressed={draft.transport === "stdio" ? "true" : "false"}
                      disabled={busy()}
                      onClick={() =>
                        setDraft((state) => {
                          state.transport = "stdio";
                        })
                      }
                    >
                      Local command
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={draft.transport === "http" ? "default" : "outline"}
                      aria-pressed={draft.transport === "http" ? "true" : "false"}
                      disabled={busy()}
                      onClick={() =>
                        setDraft((state) => {
                          state.transport = "http";
                        })
                      }
                    >
                      HTTP URL
                    </Button>
                  </div>
                </fieldset>

                <Show when={draft.transport === "stdio"}>
                  <Field label="Command" error={shown()?.command} required>
                    <Input
                      value={draft.command}
                      onValueChange={(value) =>
                        setDraft((state) => {
                          state.command = value;
                        })
                      }
                      placeholder="npx"
                      autocomplete="off"
                      spellcheck={false}
                      maxlength={CUSTOM_MCP_LIMITS.command}
                      disabled={busy()}
                    />
                  </Field>
                  <Field label="Arguments" description="One argument per line." error={shown()?.args}>
                    <Textarea
                      value={draft.argsText}
                      onValueChange={(value) =>
                        setDraft((state) => {
                          state.argsText = value;
                        })
                      }
                      placeholder={"-y\n@example/notes-mcp"}
                      spellcheck={false}
                      rows={4}
                      disabled={busy()}
                    />
                  </Field>
                  <PairRows
                    label="Environment"
                    singular="Variable"
                    rows={draft.env}
                    limit={CUSTOM_MCP_LIMITS.env}
                    busy={busy()}
                    rowError={(index) => shown()?.envRows[index]}
                    onAdd={() =>
                      setDraft((state) => {
                        state.env.push({ name: "", value: "" });
                      })
                    }
                    onRemove={(index) =>
                      setDraft((state) => {
                        state.env.splice(index, 1);
                      })
                    }
                    onName={(index, value) =>
                      setDraft((state) => {
                        state.env[index].name = value;
                      })
                    }
                    onValue={(index, value) =>
                      setDraft((state) => {
                        state.env[index].value = value;
                      })
                    }
                  />
                </Show>

                <Show when={draft.transport === "http"}>
                  <Field label="URL" error={shown()?.url} required>
                    <Input
                      value={draft.url}
                      onValueChange={(value) =>
                        setDraft((state) => {
                          state.url = value;
                        })
                      }
                      placeholder="https://mcp.example.com/mcp"
                      inputmode="url"
                      autocomplete="off"
                      spellcheck={false}
                      maxlength={CUSTOM_MCP_LIMITS.url}
                      disabled={busy()}
                    />
                  </Field>
                  <PairRows
                    label="Headers"
                    singular="Header"
                    rows={draft.headers}
                    limit={CUSTOM_MCP_LIMITS.headers}
                    busy={busy()}
                    rowError={(index) => shown()?.headerRows[index]}
                    onAdd={() =>
                      setDraft((state) => {
                        state.headers.push({ name: "", value: "" });
                      })
                    }
                    onRemove={(index) =>
                      setDraft((state) => {
                        state.headers.splice(index, 1);
                      })
                    }
                    onName={(index, value) =>
                      setDraft((state) => {
                        state.headers[index].name = value;
                      })
                    }
                    onValue={(index, value) =>
                      setDraft((state) => {
                        state.headers[index].value = value;
                      })
                    }
                  />
                </Show>
              </div>

              <footer class="custom-mcp-actions">
                <Show when={props.submitError}>
                  {(message) => (
                    <Text class="custom-mcp-submit-error" tone="danger" variant="caption" role="alert">
                      {message()}
                    </Text>
                  )}
                </Show>
                <Button type="submit" variant="default" loading={busy()} loadingLabel="Saving…">
                  Submit
                </Button>
              </footer>
            </form>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface PairRowsProps {
  label: string;
  singular: string;
  rows: readonly CustomMcpPairDraft[];
  limit: number;
  busy: boolean;
  rowError: (index: number) => string | undefined;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onName: (index: number, value: string) => void;
  onValue: (index: number, value: string) => void;
}

function PairRows(props: PairRowsProps) {
  return (
    <section class="custom-mcp-rows" aria-label={props.label}>
      <div class="custom-mcp-rows-heading">
        <Text variant="label-sm">{props.label}</Text>
      </div>
      <For each={props.rows}>
        {(row, index) => (
          <div class="custom-mcp-row">
            <div class="custom-mcp-row-inputs">
              <Input
                aria-label={`${props.singular} ${index() + 1} name`}
                value={row.name}
                onValueChange={(value) => props.onName(index(), value)}
                placeholder="NAME"
                autocomplete="off"
                spellcheck={false}
                maxlength={INPUT_LIMITS.identifier}
                disabled={props.busy}
              />
              <Input
                aria-label={`${props.singular} ${index() + 1} value`}
                value={row.value}
                onValueChange={(value) => props.onValue(index(), value)}
                placeholder="value"
                autocomplete="off"
                spellcheck={false}
                maxlength={CUSTOM_MCP_LIMITS.secret}
                disabled={props.busy}
              />
              <IconButton
                label={`Remove ${props.singular.toLowerCase()} ${index() + 1}`}
                variant="ghost"
                disabled={props.busy || props.rows.length <= 1}
                onClick={() => props.onRemove(index())}
              >
                <Trash2 />
              </IconButton>
            </div>
            <Show when={props.rowError(index())}>
              {(message) => (
                <Text class="custom-mcp-row-error" tone="danger" variant="caption" role="alert">
                  {message()}
                </Text>
              )}
            </Show>
          </div>
        )}
      </For>
      <Show when={props.rows.length < props.limit}>
        <Button type="button" variant="ghost" size="sm" disabled={props.busy} onClick={props.onAdd}>
          <Plus />
          Add {props.singular.toLowerCase()}
        </Button>
      </Show>
    </section>
  );
}
