import {
  Button,
  Field,
  IconButton,
  Input,
  LogIn,
  Plug,
  Plus,
  SettingsSection,
  SlidingTabs,
  Text,
  Trash2,
} from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createMemo, createStore, For, onCleanup, Show, untrack } from "solid-js";
import { McpRelaySignIn } from "./McpRelaySignIn";
import { McpSignInAppSection } from "./McpSignInAppSection";
import { type McpServerTools, mcpTestTone, type SettledTest, useMcpRuns } from "./mcp-server-tools";
import {
  emptyMcpConfig,
  isMcpHeaderName,
  isMcpHttpAddress,
  type McpServerConfig,
  type McpTestState,
  mcpConfigChanged,
  mcpConfigDraft,
  mcpConfigErrors,
  mcpConfigIsValid,
  mcpSaveConnects,
  mcpUrlAtAddress,
  normalizeMcpConfig,
} from "./mcp-servers";

export interface McpServerFormProps {
  tools: McpServerTools;
  id: string | null;
  onClose: (saved: McpServerConfig | null) => void;
}

interface McpFormState {
  draft: McpServerConfig;
  baseline: McpServerConfig;
  touched: boolean;
  saving: boolean;
  error: string;
  test: McpTestState | null;
  testConfig: McpServerConfig | null;
}

const STDIO_LABEL = "STDIO";
const STREAMABLE_HTTP_LABEL = "Streamable HTTP";
const COMMAND_PLACEHOLDER = "openai-dev-mcp";
const WORKING_DIRECTORY_PLACEHOLDER = "~/code";
const URL_PLACEHOLDER = "https://mcp.example.com/mcp";

export function McpServerForm(props: McpServerFormProps) {
  const { t, errorMessage } = useText();
  const runs = useMcpRuns(() => props.tools);
  const start = untrack(() => {
    const stored = props.id === null ? undefined : props.tools.servers().find((candidate) => candidate.id === props.id);
    return stored ? mcpConfigDraft(stored) : emptyMcpConfig();
  });
  const [state, setState] = createStore<McpFormState>({
    draft: start,
    baseline: mcpConfigDraft(start),
    touched: false,
    saving: false,
    error: "",
    test: null,
    testConfig: null,
  });
  let testRun = 0;

  const errors = createMemo(() => mcpConfigErrors(state.draft));
  const visible = (key: "name" | "command" | "url" | "headers") => (state.touched ? errors()[key] : undefined);
  const changed = () => mcpConfigChanged(state.draft, state.baseline);
  const test = createMemo(() =>
    state.testConfig && !mcpConfigChanged(state.draft, state.testConfig) ? state.test : null,
  );
  const signingIn = () => (state.test?.status === "signing-in" ? state.testConfig : null);
  const waiting = () => signingIn() !== null || test()?.status === "testing";
  const disabled = () => state.saving;

  let urlInput: HTMLInputElement | undefined;
  let commandInput: HTMLInputElement | undefined;
  let headerKeyInput: HTMLInputElement | undefined;
  let testButton: HTMLButtonElement | undefined;

  async function measure(
    pending: "testing" | "signing-in",
    answer: (config: McpServerConfig) => Promise<SettledTest | null>,
  ): Promise<SettledTest | null> {
    setState((current) => {
      current.touched = true;
    });
    if (!mcpConfigIsValid(state.draft)) return null;
    const run = ++testRun;
    const tested = normalizeMcpConfig(state.draft);
    setState((current) => {
      current.test = { status: pending };
      current.testConfig = tested;
    });
    const result = await answer(tested);
    if (run !== testRun) return null;
    setState((current) => {
      current.test = result;
      if (!result) current.testConfig = null;
    });
    return result;
  }

  const testDraft = () => measure("testing", runs.runTest);
  const signInDraft = () => measure("signing-in", runs.runSignIn);

  const failedAddress = (shown: McpTestState) =>
    shown.status === "failed" ? mcpUrlAtAddress(state.draft.url, shown.address) : undefined;

  function switchAddress(url: string): void {
    setState((current) => {
      current.draft.url = url;
    });
    void signInDraft();
  }

  function cancelSignIn(url: string): void {
    props.tools
      .signIn()
      ?.cancel(url)
      .catch((error: unknown) => {
        setState((current) => {
          current.error = errorMessage(error, t("mcp.panel.saveFailed"));
        });
      });
  }

  onCleanup(() => {
    testRun += 1;
    const pending = signingIn();
    if (pending) cancelSignIn(pending.url);
  });

  function moveToUrl(address: string): void {
    const from = document.activeElement;
    setState((current) => {
      current.draft.transport = "http";
      current.draft.url = address.trim();
      current.draft.command = "";
    });
    if (commandInput) commandInput.value = "";
    requestAnimationFrame(() => {
      if (document.activeElement === document.body || document.activeElement === from) urlInput?.focus();
    });
  }

  async function save(): Promise<void> {
    if (state.saving) return;
    const tested = test();
    setState((current) => {
      current.touched = true;
      current.error = "";
    });
    if (!mcpConfigIsValid(state.draft)) return;
    const connects = mcpSaveConnects(state.draft, state.baseline, props.id === null);
    setState((current) => {
      current.saving = true;
    });
    let saved: McpServerConfig | null = null;
    try {
      if (!connects || (await connectBeforeSave(tested))) {
        saved = await props.tools.save(normalizeMcpConfig(state.draft));
      }
    } catch (error) {
      setState((current) => {
        current.error = errorMessage(error, t("mcp.panel.saveFailed"));
      });
    } finally {
      setState((current) => {
        current.saving = false;
      });
    }
    if (saved) props.onClose(saved);
  }

  async function connectBeforeSave(tested: McpTestState | null): Promise<boolean> {
    const result = tested?.status === "passed" || tested?.status === "failed" ? tested : await testDraft();
    if (!result) return false;
    if (result.status === "passed") return true;
    if (result.kind === "refused") {
      setState((current) => {
        current.error = result.error;
        if (current.draft.headers.length === 0) current.draft.headers.push({ key: "", value: "" });
      });
      requestAnimationFrame(() => headerKeyInput?.focus());
      return false;
    }
    if (result.kind !== "sign-in" || !runs.canSignIn(state.draft)) return true;
    const signedIn = await signInDraft();
    if (signedIn?.status === "failed")
      setState((current) => {
        current.error = signedIn.error;
      });
    return signedIn?.status === "passed";
  }

  const holdEscape = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !changed()) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[role=dialog], [role=alertdialog], [role=menu], [role=listbox]")) return;
    event.preventDefault();
  };
  document.addEventListener("keydown", holdEscape, true);
  onCleanup(() => document.removeEventListener("keydown", holdEscape, true));

  return (
    <SlidingTabs.Root
      class="server-mcp-form"
      value={state.draft.transport}
      onChange={(value) => {
        if (value !== "stdio" && value !== "http") return;
        setState((current) => {
          current.draft.transport = value;
        });
      }}
    >
      <SettingsSection
        class="server-mcp-section"
        title={t("mcp.panel.detailsTitle")}
        description={t("mcp.panel.detailsDescription")}
        actions={
          <SlidingTabs.List aria-label={t("mcp.panel.transport")}>
            <SlidingTabs.Trigger value="stdio">{STDIO_LABEL}</SlidingTabs.Trigger>
            <SlidingTabs.Trigger value="http">{STREAMABLE_HTTP_LABEL}</SlidingTabs.Trigger>
          </SlidingTabs.List>
        }
      >
        <Field label={t("mcp.panel.name")} error={visible("name")}>
          <Input
            size="md"
            placeholder={t("mcp.panel.namePlaceholder")}
            value={state.draft.name}
            disabled={disabled()}
            onValueChange={(value) =>
              setState((current) => {
                current.draft.name = value;
              })
            }
            onBlur={() =>
              setState((current) => {
                current.touched = true;
              })
            }
          />
        </Field>
      </SettingsSection>

      <SlidingTabs.ContentSlot>
        <SlidingTabs.Content value="stdio" class="server-mcp-transport-panel">
          <SettingsSection class="server-mcp-section" title={t("mcp.panel.launchTitle")}>
            <Field
              label={t("mcp.panel.command")}
              description={t("mcp.panel.commandDescription")}
              error={visible("command")}
            >
              <Input
                ref={(element: HTMLInputElement) => {
                  commandInput = element;
                }}
                size="md"
                placeholder={COMMAND_PLACEHOLDER}
                value={state.draft.command}
                disabled={disabled()}
                onValueChange={(value) => {
                  if (isMcpHttpAddress(value) && value.length - state.draft.command.length > 1) moveToUrl(value);
                  else
                    setState((current) => {
                      current.draft.command = value;
                    });
                }}
                onBlur={() => {
                  setState((current) => {
                    current.touched = true;
                  });
                  if (isMcpHttpAddress(state.draft.command)) moveToUrl(state.draft.command);
                }}
              />
            </Field>

            <McpRowList
              label={t("mcp.panel.arguments")}
              addLabel={t("mcp.panel.addArgument")}
              disabled={disabled()}
              onAdd={() =>
                setState((current) => {
                  current.draft.args.push("");
                })
              }
            >
              <For each={state.draft.args} keyed={false}>
                {(value, index) => (
                  <div class="server-mcp-repeat-row">
                    <Input
                      size="md"
                      aria-label={t("mcp.panel.argument", { position: index + 1 })}
                      value={value()}
                      disabled={disabled()}
                      onValueChange={(next) =>
                        setState((current) => {
                          current.draft.args[index] = next;
                        })
                      }
                    />
                    <IconButton
                      type="button"
                      variant="ghost"
                      label={t("mcp.panel.removeArgument", { position: index + 1 })}
                      disabled={disabled()}
                      onClick={() =>
                        setState((current) => {
                          current.draft.args.splice(index, 1);
                        })
                      }
                    >
                      <Trash2 aria-hidden="true" />
                    </IconButton>
                  </div>
                )}
              </For>
            </McpRowList>

            <McpRowList
              label={t("mcp.panel.environmentVariables")}
              addLabel={t("mcp.panel.addEnvironmentVariable")}
              disabled={disabled()}
              onAdd={() =>
                setState((current) => {
                  current.draft.env.push({ key: "", value: "" });
                })
              }
            >
              <For each={state.draft.env} keyed={false}>
                {(pair, index) => (
                  <div class="server-mcp-repeat-row server-mcp-repeat-row-pair">
                    <Input
                      size="md"
                      placeholder={t("mcp.panel.key")}
                      aria-label={t("mcp.panel.environmentVariableKey", { position: index + 1 })}
                      value={pair().key}
                      disabled={disabled()}
                      onValueChange={(next) =>
                        setState((current) => {
                          const entry = current.draft.env[index];
                          if (entry) entry.key = next;
                        })
                      }
                    />
                    <Input
                      size="md"
                      placeholder={t("mcp.panel.value")}
                      aria-label={t("mcp.panel.environmentVariableValue", { position: index + 1 })}
                      type="password"
                      autocomplete="off"
                      spellcheck={false}
                      value={pair().value}
                      disabled={disabled()}
                      onValueChange={(next) =>
                        setState((current) => {
                          const entry = current.draft.env[index];
                          if (entry) entry.value = next;
                        })
                      }
                    />
                    <IconButton
                      type="button"
                      variant="ghost"
                      label={t("mcp.panel.removeEnvironmentVariable", { position: index + 1 })}
                      disabled={disabled()}
                      onClick={() =>
                        setState((current) => {
                          current.draft.env.splice(index, 1);
                        })
                      }
                    >
                      <Trash2 aria-hidden="true" />
                    </IconButton>
                  </div>
                )}
              </For>
            </McpRowList>

            <McpRowList
              label={t("mcp.panel.passthrough")}
              addLabel={t("mcp.panel.addVariable")}
              disabled={disabled()}
              onAdd={() =>
                setState((current) => {
                  current.draft.envPassthrough.push("");
                })
              }
            >
              <For each={state.draft.envPassthrough} keyed={false}>
                {(value, index) => (
                  <div class="server-mcp-repeat-row">
                    <Input
                      size="md"
                      aria-label={t("mcp.panel.passthroughVariable", { position: index + 1 })}
                      value={value()}
                      disabled={disabled()}
                      onValueChange={(next) =>
                        setState((current) => {
                          current.draft.envPassthrough[index] = next;
                        })
                      }
                    />
                    <IconButton
                      type="button"
                      variant="ghost"
                      label={t("mcp.panel.removePassthroughVariable", { position: index + 1 })}
                      disabled={disabled()}
                      onClick={() =>
                        setState((current) => {
                          current.draft.envPassthrough.splice(index, 1);
                        })
                      }
                    >
                      <Trash2 aria-hidden="true" />
                    </IconButton>
                  </div>
                )}
              </For>
            </McpRowList>

            <Field label={t("mcp.panel.workingDirectory")} description={t("mcp.panel.workingDirectoryDescription")}>
              <Input
                size="md"
                placeholder={WORKING_DIRECTORY_PLACEHOLDER}
                value={state.draft.workingDirectory}
                disabled={disabled()}
                onValueChange={(value) =>
                  setState((current) => {
                    current.draft.workingDirectory = value;
                  })
                }
              />
            </Field>
          </SettingsSection>
        </SlidingTabs.Content>

        <SlidingTabs.Content value="http" class="server-mcp-transport-panel">
          <SettingsSection
            class="server-mcp-section"
            title={t("mcp.panel.endpointTitle")}
            description={t("mcp.panel.endpointDescription")}
          >
            <Field label={t("mcp.panel.serverUrl")} error={visible("url")}>
              <Input
                ref={(element: HTMLInputElement) => {
                  urlInput = element;
                }}
                size="md"
                type="url"
                placeholder={URL_PLACEHOLDER}
                value={state.draft.url}
                disabled={disabled()}
                onValueChange={(value) =>
                  setState((current) => {
                    current.draft.url = value;
                  })
                }
                onBlur={() =>
                  setState((current) => {
                    current.touched = true;
                  })
                }
              />
            </Field>

            <McpRowList
              label={t("mcp.panel.headers")}
              addLabel={t("mcp.panel.addHeader")}
              error={visible("headers") ? t("error.backend.mcpHeaderNameInvalid") : undefined}
              disabled={disabled()}
              onAdd={() =>
                setState((current) => {
                  current.draft.headers.push({ key: "", value: "" });
                })
              }
            >
              <For each={state.draft.headers} keyed={false}>
                {(pair, index) => (
                  <div class="server-mcp-repeat-row server-mcp-repeat-row-pair">
                    <Input
                      ref={(element: HTMLInputElement) => {
                        if (index === 0) headerKeyInput = element;
                      }}
                      size="md"
                      placeholder={t("mcp.panel.key")}
                      aria-label={t("mcp.panel.headerKey", { position: index + 1 })}
                      invalid={state.touched && !isMcpHeaderName(pair().key)}
                      value={pair().key}
                      disabled={disabled()}
                      onValueChange={(next) =>
                        setState((current) => {
                          const entry = current.draft.headers[index];
                          if (entry) entry.key = next;
                        })
                      }
                    />
                    <Input
                      size="md"
                      placeholder={t("mcp.panel.value")}
                      aria-label={t("mcp.panel.headerValue", { position: index + 1 })}
                      type="password"
                      autocomplete="off"
                      spellcheck={false}
                      value={pair().value}
                      disabled={disabled()}
                      onValueChange={(next) =>
                        setState((current) => {
                          const entry = current.draft.headers[index];
                          if (entry) entry.value = next;
                        })
                      }
                    />
                    <IconButton
                      type="button"
                      variant="ghost"
                      label={t("mcp.panel.removeHeader", { position: index + 1 })}
                      disabled={disabled()}
                      onClick={() =>
                        setState((current) => {
                          current.draft.headers.splice(index, 1);
                        })
                      }
                    >
                      <Trash2 aria-hidden="true" />
                    </IconButton>
                  </div>
                )}
              </For>
            </McpRowList>
          </SettingsSection>

          <Show when={props.tools.signIn()?.app}>
            {(app) => (
              <McpSignInAppSection
                api={app()}
                mcpServerId={props.id}
                urlChanged={state.draft.url.trim() !== state.baseline.url.trim()}
                hostName={props.tools.signIn()?.relay?.hostName}
                relayed={props.tools.signIn()?.relay !== undefined}
                disabled={disabled()}
              />
            )}
          </Show>
        </SlidingTabs.Content>
      </SlidingTabs.ContentSlot>

      <SettingsSection
        class="server-mcp-section"
        title={t("mcp.panel.testTitle")}
        description={t("mcp.panel.testDescription")}
        actions={
          <>
            <Show when={runs.canSignIn(state.draft)}>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled() || waiting()}
                onClick={() => void signInDraft()}
              >
                <LogIn aria-hidden="true" />
                {t("mcp.panel.signIn")}
              </Button>
            </Show>
            <Button
              ref={(element: HTMLButtonElement) => {
                testButton = element;
              }}
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled() || waiting()}
              loading={test()?.status === "testing"}
              loadingLabel={t("common.connecting")}
              onClick={() => void testDraft()}
            >
              <Plug aria-hidden="true" />
              {t("mcp.panel.testConnection")}
            </Button>
          </>
        }
      >
        <Show
          when={signingIn() ? state.test : test()}
          fallback={
            <Text variant="caption" tone="muted">
              {t("mcp.panel.notTested")}
            </Text>
          }
        >
          {(shown) => (
            <>
              <Text class="server-mcp-test-result" variant="caption" tone={mcpTestTone(shown())} role="status">
                {runs.testMessage(shown())}
              </Text>
              <Show when={signingIn() ? undefined : failedAddress(shown())}>
                {(address) => (
                  <div class="server-mcp-row-next">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={disabled() || waiting()}
                      onClick={() => switchAddress(address())}
                    >
                      {t("mcp.panel.useAddress")}
                    </Button>
                  </div>
                )}
              </Show>
              <Show when={signingIn()}>
                {(pending) => (
                  <div class="server-mcp-row-next">
                    <Button type="button" size="sm" variant="outline" onClick={() => cancelSignIn(pending().url)}>
                      {t("mcp.panel.cancelSignIn")}
                    </Button>
                  </div>
                )}
              </Show>
            </>
          )}
        </Show>
        <Show when={state.draft.transport === "stdio" ? props.tools.toolRuntimeNote() : null}>
          {(note) => (
            <Text class="server-mcp-runtime-note" variant="caption" tone="muted">
              {note()}
            </Text>
          )}
        </Show>
      </SettingsSection>

      <div class="server-mcp-form-actions">
        <Show when={state.error}>
          <Text class="server-mcp-form-error" variant="caption" tone="danger" role="alert">
            {state.error}
          </Text>
        </Show>
        <Button type="button" variant="outline" disabled={disabled()} onClick={() => props.onClose(null)}>
          {t("common.cancel")}
        </Button>
        <Button
          type="button"
          loading={state.saving}
          disabled={waiting() || (props.id !== null && !changed()) || (state.touched && !mcpConfigIsValid(state.draft))}
          onClick={() => void save()}
        >
          {t("common.save")}
        </Button>
      </div>

      <McpRelaySignIn
        tools={props.tools}
        pending={signingIn()}
        onCancel={cancelSignIn}
        returnFocus={() => testButton}
      />
    </SlidingTabs.Root>
  );
}

function McpRowList(props: {
  label: string;
  addLabel: string;
  error?: string | undefined;
  disabled: boolean;
  onAdd: () => void;
  children: JSX.Element;
}) {
  return (
    <fieldset class="server-mcp-repeat">
      <legend class="server-mcp-repeat-legend">
        <Text variant="caption" tone="muted">
          {props.label}
        </Text>
      </legend>
      {props.children}
      <Show when={props.error}>
        <Text variant="caption" tone="danger" role="alert">
          {props.error}
        </Text>
      </Show>
      <Button
        type="button"
        class="server-mcp-repeat-add"
        variant="ghost"
        size="sm"
        disabled={props.disabled}
        onClick={props.onAdd}
      >
        <Plus aria-hidden="true" />
        {props.addLabel}
      </Button>
    </fieldset>
  );
}
