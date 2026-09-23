import {
  Badge,
  Blocks,
  Button,
  buttonVariants,
  ConfirmDialog,
  DropdownMenu,
  Ellipsis,
  Field,
  IconButton,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  Pencil,
  Plug,
  Plus,
  SettingsSection,
  SlidingTabs,
  Switch,
  Text,
  Trash2,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createMemo, createStore, For, onCleanup, Show } from "solid-js";
import {
  emptyMcpConfig,
  type McpServerConfig,
  type McpTestResult,
  type McpTestState,
  mcpConfigChanged,
  mcpConfigDraft,
  mcpConfigErrors,
  mcpConfigIsValid,
  mcpProviderLimitNote,
  mcpStatusLabel,
  mcpStatusVariant,
  mcpTestMessage,
  normalizeMcpConfig,
} from "./mcp-servers";

/** Save-bar state, read live by the dialog footer. */
export interface McpPanelSaveBar {
  message: string;
  /** True when `message` reports a failed save rather than the state of the draft. */
  failed: boolean;
  saving: boolean;
  resetDisabled: boolean;
  saveDisabled: boolean;
}

/** Form view descriptor for the dialog header/footer. */
export interface McpPanelDetail {
  title: string;
  back: () => void;
  /** `null` while the form matches what is stored, so the dialog holds no save bar. */
  saveBar: () => McpPanelSaveBar | null;
  save: () => void;
  reset: () => void;
}

export interface ServerMcpPanelProps {
  servers: McpServerConfig[];
  canManage: boolean;
  /** The dialog element the row menus portal into, so a menu is not clipped by the modal. */
  menuMount?: HTMLElement;
  /** Reports the form view, so the header shows a breadcrumb instead of the panel holding a back row. */
  onDetailChange?: (detail: McpPanelDetail | null) => void;
  /** Empty-list reason when the read failed; a failed read must not say "No MCP servers yet." */
  loadError?: string | null;
  /**
   * One sentence about the managed runtime a STDIO server is started with, or nothing.
   *
   * Not a health claim about any server, and not stored: it is what the download on this computer
   * is doing right now, and the panel only repeats it. The caller leaves it out for a remote
   * server, whose host holds its own runtime.
   */
  toolRuntimeNote?: string | null;
  /** Re-read the list; without it the error has no way out except closing the dialog. */
  onRetryLoad?: () => void;
  onSave: (config: McpServerConfig) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onSetEnabled: (id: string, enabled: boolean) => Promise<void>;
  /** Test an unsaved draft config. */
  onTest: (config: McpServerConfig) => Promise<McpTestResult>;
}

/** One record for form view/edit/draft/touched, which change together. */
interface McpPanelState {
  view: "list" | "form";
  /** `null` in the form view means the user is connecting a new server. */
  editingId: string | null;
  draft: McpServerConfig;
  /** What the draft started as, so the panel can tell an edit from an untouched form. */
  baseline: McpServerConfig;
  /** Gates the error copy until the user has tried to save or left a field. */
  touched: boolean;
  removeId: string | null;
  /** The key of the one action in flight, gating the whole panel rather than any one row. */
  busy: string | null;
  error: string;
  /**
   * Row test answers keyed by server id. Each carries the config it was measured for: edits and
   * tests race both ways, so a stale pass must not describe the edited endpoint.
   */
  tests: Record<string, { test: McpTestState; config: McpServerConfig }>;
  /** The form's own test, which answers for the draft on screen and not for any stored row. */
  formTest: McpTestState | null;
  /** The config the form test ran with; a test only describes the settings it measured. */
  formTestConfig: McpServerConfig | null;
}

const CONNECT_TITLE = "Connect to a custom MCP";
const EDIT_TITLE = "Edit MCP server";

export function ServerMcpPanel(props: ServerMcpPanelProps) {
  const [state, setState] = createStore<McpPanelState>({
    view: "list",
    editingId: null,
    draft: emptyMcpConfig(),
    baseline: emptyMcpConfig(),
    touched: false,
    removeId: null,
    busy: null,
    error: "",
    tests: {},
    formTest: null,
    formTestConfig: null,
  });
  // Counts the form's tests, so an answer that arrives after the user left is dropped.
  let draftTestRun = 0;

  const errors = createMemo(() => mcpConfigErrors(state.draft));
  /** Form test result while it still describes the form; typing a value back restores it. */
  const formTest = createMemo(() =>
    state.formTestConfig && !mcpConfigChanged(state.draft, state.formTestConfig) ? state.formTest : null,
  );
  /** Row test result while it still describes the row; the enabled switch is not compared. */
  const rowTest = (config: McpServerConfig): McpTestState | undefined => {
    const entry = state.tests[config.id];
    if (!entry || mcpConfigChanged({ ...config, enabled: entry.config.enabled }, entry.config)) return undefined;
    return entry.test;
  };
  const visible = (key: "name" | "command" | "url") => (state.touched ? errors()[key] : undefined);
  const removeTarget = createMemo(() => props.servers.find((config) => config.id === state.removeId) ?? null);
  const disabled = () => !props.canManage || state.busy !== null;
  // The dialog holds the form's breadcrumb and save bar, and it outlives this panel: the capability
  // gate that shows the panel drops it while the section stays on MCP. Without this the header would
  // name a form that is gone, and its save bar would call back into a panel that no longer exists.
  onCleanup(() => props.onDetailChange?.(null));

  async function run(key: string, action: () => Promise<void>): Promise<boolean> {
    if (state.busy !== null) return false;
    setState((current) => {
      current.busy = key;
      current.error = "";
    });
    try {
      await action();
      return true;
    } catch (error) {
      setState((current) => {
        current.error = error instanceof Error ? error.message : "That change could not be saved.";
      });
      return false;
    } finally {
      setState((current) => {
        current.busy = null;
      });
    }
  }

  /** Tests run without the busy latch so a slow server never blocks saving another. */
  async function runTest(config: McpServerConfig): Promise<McpTestState> {
    try {
      const result = await props.onTest(config);
      if (result.error) return { status: "failed", error: result.error };
      return { status: "passed", toolCount: result.toolCount };
    } catch (error) {
      return { status: "failed", error: error instanceof Error ? error.message : "That server did not answer." };
    }
  }

  async function testRow(config: McpServerConfig): Promise<void> {
    const tested = normalizeMcpConfig(config);
    setState((current) => {
      current.tests[config.id] = { test: { status: "testing" }, config: tested };
    });
    const test = await runTest(tested);
    setState((current) => {
      current.tests[config.id] = { test, config: tested };
    });
  }

  async function testDraft(): Promise<void> {
    setState((current) => {
      current.touched = true;
    });
    if (!mcpConfigIsValid(state.draft)) return;
    const run = ++draftTestRun;
    const tested = normalizeMcpConfig(state.draft);
    setState((current) => {
      current.formTest = { status: "testing" };
      current.formTestConfig = tested;
    });
    const test = await runTest(tested);
    if (run !== draftTestRun) return;
    setState((current) => {
      current.formTest = test;
    });
  }

  function openForm(config: McpServerConfig | null): void {
    const draft = config ? mcpConfigDraft(config) : emptyMcpConfig();
    setState((current) => {
      current.view = "form";
      current.editingId = config?.id ?? null;
      current.draft = draft;
      // Copy, not alias: the form edits `draft` in place while the baseline holds still.
      current.baseline = mcpConfigDraft(draft);
      current.touched = false;
      current.error = "";
      current.formTest = null;
      current.formTestConfig = null;
    });
    draftTestRun += 1;
    // Store writes are not visible to reads in the same tick: read from the argument.
    props.onDetailChange?.({
      title: config ? EDIT_TITLE : CONNECT_TITLE,
      back: backToList,
      saveBar,
      save: () => void save(),
      reset: resetForm,
    });
  }

  function backToList(): void {
    props.onDetailChange?.(null);
    setState((current) => {
      current.view = "list";
      current.editingId = null;
      current.touched = false;
      current.error = "";
      current.formTest = null;
      current.formTestConfig = null;
    });
    draftTestRun += 1;
  }

  async function save(): Promise<void> {
    setState((current) => {
      current.touched = true;
    });
    if (!mcpConfigIsValid(state.draft)) return;
    // The draft's empty id stays empty: the store mints the id on insert, and a client-minted one
    // reads to it as an edit of a row that is not there.
    const config = normalizeMcpConfig(state.draft);
    const saved = await run("save", () => props.onSave(config));
    if (saved) backToList();
  }

  /** Puts the form back to what is stored, the way the General tab's save bar resets its fields. */
  function resetForm(): void {
    setState((current) => {
      current.draft = mcpConfigDraft(current.baseline);
      current.touched = false;
      current.error = "";
      current.formTest = null;
      current.formTestConfig = null;
    });
    draftTestRun += 1;
  }

  /**
   * The dialog footer calls this while it renders, so each field is a live read of the store. It
   * answers `null` while the form still matches what is stored, which is what keeps the save bar
   * off screen until there is something to save.
   */
  function saveBar(): McpPanelSaveBar | null {
    if (!mcpConfigChanged(state.draft, state.baseline)) return null;
    return {
      message: state.error || "Changes not saved",
      failed: Boolean(state.error),
      saving: state.busy === "save",
      resetDisabled: state.busy !== null,
      saveDisabled: disabled() || (state.touched && !mcpConfigIsValid(state.draft)),
    };
  }

  function listView() {
    return (
      <SettingsSection
        class="server-mcp-section"
        title="MCP servers"
        /*
         * The second sentence is the panel telling the truth about its own reach. Claude is
         * started with `strictMcpConfig` and Codex is started with the names in its own file
         * turned off, so for those two this list is the whole set. OpenCode and Grok document
         * no such flag, and guessing a key name would fail silently at the next turn, so the
         * limit is stated rather than hidden.
         */
        description="Model Context Protocol servers give this server’s agents extra tools. Claude and Codex agents get only the servers in this list; OpenCode and Grok agents can also start servers from their own configuration files."
        actions={
          <Show when={props.servers.length > 0}>
            <Button type="button" size="sm" variant="outline" disabled={disabled()} onClick={() => openForm(null)}>
              <Plus aria-hidden="true" />
              Connect a custom MCP
            </Button>
          </Show>
        }
      >
        <Show when={state.error}>
          <Text class="server-mcp-error" variant="caption" tone="danger" role="alert">
            {state.error}
          </Text>
        </Show>
        <Show when={props.toolRuntimeNote}>
          {(note) => (
            <Text class="server-mcp-runtime-note" variant="caption" tone="muted">
              {note()}
            </Text>
          )}
        </Show>
        <Show
          when={props.servers.length > 0}
          fallback={
            <div class="server-mcp-empty">
              <Show
                when={props.loadError}
                fallback={
                  <>
                    <Text variant="caption" tone="muted">
                      No MCP servers yet.
                    </Text>
                    <Button type="button" variant="outline" disabled={disabled()} onClick={() => openForm(null)}>
                      <Plus aria-hidden="true" />
                      Connect a custom MCP
                    </Button>
                  </>
                }
              >
                {(message) => (
                  <>
                    <Text variant="caption" tone="danger" role="alert">
                      {message()}
                    </Text>
                    <Show when={props.onRetryLoad}>
                      <Button type="button" variant="outline" onClick={() => props.onRetryLoad?.()}>
                        Retry
                      </Button>
                    </Show>
                  </>
                )}
              </Show>
            </div>
          }
        >
          <ItemGroup class="server-mcp-list">
            {/* Keyed by id, so an enabled or test change updates the row that is already on screen.
                A row that remounts would drop the switch mid-animation. */}
            <For each={props.servers} keyed={(config) => config.id}>
              {(config) => {
                const test = () => rowTest(config());
                return (
                  <Item class="server-mcp-row" data-disabled={config().enabled ? undefined : ""}>
                    <ItemMedia class="server-mcp-row-icon">
                      <Blocks aria-hidden="true" />
                    </ItemMedia>
                    <ItemContent>
                      <div class="server-mcp-row-title">
                        <ItemTitle>{config().name}</ItemTitle>
                        <Badge variant={mcpStatusVariant(test())}>{mcpStatusLabel(config(), test())}</Badge>
                      </div>
                      <Show when={test()?.status === "failed" && test()}>
                        {(failed) => <ItemDescription>{mcpTestMessage(failed())}</ItemDescription>}
                      </Show>
                      {/* Only when no failure is shown: a test the user just ran answers about this
                          server now, and the standing limit must not push it out of the slot. */}
                      <Show when={test()?.status !== "failed" && mcpProviderLimitNote(config())}>
                        {(note) => <ItemDescription>{note()}</ItemDescription>}
                      </Show>
                    </ItemContent>
                    <ItemActions>
                      <Switch
                        aria-label={`Enable ${config().name}`}
                        checked={config().enabled}
                        disabled={disabled()}
                        onChange={(enabled) =>
                          void run(`enable:${config().id}`, () => props.onSetEnabled(config().id, enabled))
                        }
                      />
                      <McpRowMenu
                        name={config().name}
                        mount={props.menuMount}
                        disabled={disabled()}
                        onTest={() => void testRow(config())}
                        onEdit={() => openForm(config())}
                        onRemove={(trigger) => {
                          // The confirmation returns focus to the element focused when it opens.
                          trigger.focus({ preventScroll: true });
                          setState((current) => {
                            current.removeId = config().id;
                          });
                        }}
                      />
                    </ItemActions>
                  </Item>
                );
              }}
            </For>
          </ItemGroup>
        </Show>
      </SettingsSection>
    );
  }

  function formView() {
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
        {/* The dialog header already names the view, so this section only labels the group. */}
        <SettingsSection
          class="server-mcp-section"
          title="Details"
          description="Name this server and choose how OpenBot reaches it."
          actions={
            <SlidingTabs.List aria-label="Transport">
              <SlidingTabs.Trigger value="stdio">STDIO</SlidingTabs.Trigger>
              <SlidingTabs.Trigger value="http">Streamable HTTP</SlidingTabs.Trigger>
            </SlidingTabs.List>
          }
        >
          <Field label="Name" error={visible("name")}>
            <Input
              size="md"
              placeholder="MCP server name"
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
            <SettingsSection class="server-mcp-section" title="Launch">
              <Field
                label="Command to launch"
                description="The program only. The launch does not read this field as a command line, so a word such as serve-sqlite goes in Arguments below."
                error={visible("command")}
              >
                <Input
                  size="md"
                  placeholder="openai-dev-mcp"
                  value={state.draft.command}
                  disabled={disabled()}
                  onValueChange={(value) =>
                    setState((current) => {
                      current.draft.command = value;
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
                label="Arguments"
                addLabel="Add argument"
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
                        aria-label={`Argument ${index + 1}`}
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
                        label={`Remove argument ${index + 1}`}
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
                label="Environment variables"
                addLabel="Add environment variable"
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
                        placeholder="Key"
                        aria-label={`Environment variable ${index + 1} key`}
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
                        placeholder="Value"
                        aria-label={`Environment variable ${index + 1} value`}
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
                        label={`Remove environment variable ${index + 1}`}
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
                label="Environment variable passthrough"
                addLabel="Add variable"
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
                        aria-label={`Passthrough variable ${index + 1}`}
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
                        label={`Remove passthrough variable ${index + 1}`}
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

              {/* The limit is named here, before the save, because it cannot be fixed afterwards:
                  the ACP schema carries no working directory, and no key for one survived testing
                  against the pinned Codex app-server, so only Claude and the test honour this
                  field. The other providers skip such a server rather than start it somewhere
                  else, and say so: the row keeps the note, and the hand-off reports the skip. */}
              <Field
                label="Working directory"
                description="Claude agents and the connection test start the server here. Leave it empty to give this server to every provider: no other provider can set a directory, so it skips a server that names one."
              >
                <Input
                  size="md"
                  placeholder="~/code"
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
              title="Endpoint"
              description="Every provider can use an HTTP MCP server."
            >
              <Field label="Server URL" error={visible("url")}>
                <Input
                  size="md"
                  type="url"
                  placeholder="https://mcp.example.com/mcp"
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
                label="Headers"
                addLabel="Add header"
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
                        size="md"
                        placeholder="Key"
                        aria-label={`Header ${index + 1} key`}
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
                        placeholder="Value"
                        aria-label={`Header ${index + 1} value`}
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
                        label={`Remove header ${index + 1}`}
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
          </SlidingTabs.Content>
        </SlidingTabs.ContentSlot>

        <SettingsSection
          class="server-mcp-section"
          title="Test"
          description="Connects once with these settings and reports the tools it offers. Nothing is saved or kept."
          actions={
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!props.canManage || formTest()?.status === "testing"}
              loading={formTest()?.status === "testing"}
              loadingLabel="Connecting…"
              onClick={() => void testDraft()}
            >
              <Plug aria-hidden="true" />
              Test connection
            </Button>
          }
        >
          <Show
            when={formTest()}
            fallback={
              <Text variant="caption" tone="muted">
                Not tested yet.
              </Text>
            }
          >
            {(test) => (
              <Text class="server-mcp-test-result" variant="caption" tone={mcpTestTone(test())} role="status">
                {mcpTestMessage(test())}
              </Text>
            )}
          </Show>
        </SettingsSection>
      </SlidingTabs.Root>
    );
  }

  return (
    <div class="server-mcp-panel t-page-slide" data-page={state.view === "form" ? "2" : "1"}>
      {/* The list and the form are the two pages of one flow: the form enters from the right, and
          the list comes back from the left. Only the entering page is mounted, so the panel CSS
          gives it an entry state through `@starting-style`. */}
      <Show
        when={state.view === "list"}
        fallback={
          <div class="t-page" data-page-id="2">
            {formView()}
          </div>
        }
      >
        <div class="t-page" data-page-id="1">
          {listView()}
        </div>
      </Show>

      {/* The dialog unmounts with its target, so its title never shows an empty name while it closes. */}
      <Show when={removeTarget()}>
        {(config) => (
          <ConfirmDialog
            open
            initialFocus="cancel"
            pending={state.busy === `remove:${config().id}`}
            title={`Remove ${config().name}?`}
            description="Its tools stop being offered to this server’s agents. The configuration is not kept."
            confirmLabel="Remove MCP server"
            pendingLabel="Removing…"
            onCancel={() =>
              setState((current) => {
                current.removeId = null;
              })
            }
            onConfirm={async () => {
              await run(`remove:${config().id}`, async () => {
                await props.onRemove(config().id);
                setState((current) => {
                  current.removeId = null;
                });
              });
            }}
          />
        )}
      </Show>
    </div>
  );
}

/**
 * The frame the four repeatable lists share: a named group, its rows, and the button that appends
 * one. The rows differ - a single value or a key/value pair - so each caller supplies its own `For`.
 */
function McpRowList(props: {
  label: string;
  addLabel: string;
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

function McpRowMenu(props: {
  name: string;
  mount?: HTMLElement;
  disabled: boolean;
  onTest: () => void;
  onEdit: () => void;
  onRemove: (trigger: HTMLElement) => void;
}) {
  let triggerElement: HTMLElement | undefined;
  return (
    <DropdownMenu.Root placement="bottom-end" gutter={4} modal={false}>
      <DropdownMenu.Trigger
        ref={(element) => (triggerElement = element)}
        class={`${buttonVariants({ variant: "ghost", size: "icon-sm" })} ui-icon-button`}
        aria-label={`Actions for ${props.name}`}
        disabled={props.disabled}
      >
        <Ellipsis aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal mount={props.mount}>
        <DropdownMenu.Content class="server-mcp-row-menu">
          <DropdownMenu.Item onSelect={() => props.onTest()}>
            <Plug aria-hidden="true" />
            Test connection
          </DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => props.onEdit()}>
            <Pencil aria-hidden="true" />
            Edit
          </DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item
            class="ui-action-menu-danger"
            onSelect={() => triggerElement && props.onRemove(triggerElement)}
          >
            <Trash2 aria-hidden="true" />
            Remove
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** A failed test is the only one that reads as an error; a pass is a plain, quiet sentence. */
function mcpTestTone(test: McpTestState): "danger" | "success" | "muted" {
  if (test.status === "failed") return "danger";
  return test.status === "passed" ? "success" : "muted";
}
