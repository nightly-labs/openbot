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
  LogIn,
  LogOut,
  Pencil,
  Plug,
  Plus,
  SettingsSection,
  SlidingTabs,
  Switch,
  Text,
  Trash2,
} from "@openbot/ui";
import type { BrowserViewRuntime } from "@openbot/ui/features/browser/BrowserLiveView";
import {
  McpSignInPageDialog,
  McpSignInRelayDialog,
  type McpSignInRelaySource,
} from "@openbot/ui/features/settings/McpSignInPage";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createEffect, createMemo, createStore, For, onCleanup, Show } from "solid-js";
import { type McpPanelSignInApp, McpSignInAppSection } from "./McpSignInAppSection";
import {
  emptyMcpConfig,
  isMcpHttpAddress,
  isMcpSignInCancelled,
  isMcpSignInOnHost,
  type McpServerConfig,
  type McpSignInState,
  type McpTestResult,
  type McpTestState,
  mcpConfigChanged,
  mcpConfigDraft,
  mcpConfigErrors,
  mcpConfigIsValid,
  mcpFailureKind,
  mcpProviderLimitNote,
  mcpSaveConnects,
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
  menuMount?: HTMLElement | undefined;
  /** Reports the form view, so the header shows a breadcrumb instead of the panel holding a back row. */
  onDetailChange?: ((detail: McpPanelDetail | null) => void) | undefined;
  /** Empty-list reason when the read failed; a failed read must not say "No MCP servers yet." */
  loadError?: string | null | undefined;
  /**
   * One sentence about the managed runtime a STDIO server is started with, or nothing.
   *
   * Not a health claim about any server, and not stored: it is what the download on this computer
   * is doing right now, and the panel only repeats it. The caller leaves it out for a remote
   * server, whose host holds its own runtime.
   */
  toolRuntimeNote?: string | null | undefined;
  /** Re-read the list; without it the error has no way out except closing the dialog. */
  onRetryLoad?: (() => void) | undefined;
  onSave: (config: McpServerConfig) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onSetEnabled: (id: string, enabled: boolean) => Promise<void>;
  /** Test an unsaved draft config. */
  onTest: (config: McpServerConfig) => Promise<McpTestResult>;
  /**
   * Browser sign-in for http servers. This computer signs in with its own browser; a joined server
   * signs in with the host's browser, and this panel shows that page.
   */
  signIn?: McpPanelSignIn | undefined;
  /** A row to sign in to as soon as the list holds it: the user pressed Sign in on an agent's card. */
  signInRequest?: string | null | undefined;
  /** Called once the panel started the requested sign-in, so it does not start again. */
  onSignInRequestHandled?: (() => void) | undefined;
  /** Opens the form for a new server as soon as the panel shows: the user pressed Add custom in the Marketplace. */
  addRequest?: boolean | undefined;
  /** Called once the panel opened the requested form, so it does not open again. */
  onAddRequestHandled?: (() => void) | undefined;
}

export interface McpPanelSignIn {
  /** The host's sign-in state, by row id: whether it holds a sign-in, and whether one was lost. */
  states: Record<string, McpSignInState>;
  /**
   * A joined server's host signs in with its own browser, and its page shows here: the grant comes
   * back on an address only that host can reach. Absent when this computer signs in.
   */
  remote?: McpPanelRemoteSignIn | undefined;
  /** Opens the browser when the server asks, and answers once it came back and the server took the token. */
  start: (config: McpServerConfig) => Promise<McpTestResult>;
  /** Stops the wait for the browser; the pending `start` then answers that it was cancelled. */
  cancel: (url: string) => Promise<void>;
  signOut: (id: string) => Promise<void>;
  /** A pre-registered OAuth app for a server without client registration. Absent when the host has none. */
  app?: McpPanelSignInApp | undefined;
}

interface McpPanelRemoteSignIn {
  hostName: string;
  runtime: BrowserViewRuntime;
  /** Whether the host pastes and copies for a live view. */
  clipboard: boolean;
  /** The host tab with the sign-in page, by the address it signs in to, once the host opened it. */
  pages: Record<string, string>;
  /** A host with `sign-in-relay-v1` opens no tab: the page is in the user's own browser. Absent for an older host. */
  relay?: McpPanelRelay | undefined;
}

interface McpPanelRelay {
  /** The relayed sign-in page, by the address it signs in to, while it waits. */
  pages: Record<string, McpSignInRelaySource>;
  /** Sends the address that the browser shows at the end of the sign-in. */
  paste: (url: string, address: string) => Promise<void>;
  /** Opens the page in the user's browser. Nothing opens it before the user saw its host name and asked. */
  open: (url: string) => void | Promise<void>;
}

/** A test or a sign-in that has answered. */
type SettledTest = Exclude<McpTestState, { status: "testing" } | { status: "signing-in" }>;

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

const STDIO_LABEL = "STDIO";
const STREAMABLE_HTTP_LABEL = "Streamable HTTP";
const COMMAND_PLACEHOLDER = "openai-dev-mcp";
const WORKING_DIRECTORY_PLACEHOLDER = "~/code";
const URL_PLACEHOLDER = "https://mcp.example.com/mcp";

export function ServerMcpPanel(props: ServerMcpPanelProps) {
  const { t, sourceText } = useText();
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
  /** A test or a sign-in of the form is running; the form's two buttons wait for it. */
  const formWaiting = () => formSignIn() !== null || formTest()?.status === "testing";
  /**
   * The config of a form sign-in still waiting for the browser. Unlike a test result it outlives
   * edits to the draft: the browser is still out, so Cancel stays bound to the address it signs in to.
   */
  function formSignIn(): McpServerConfig | null {
    return state.formTest?.status === "signing-in" ? state.formTestConfig : null;
  }
  /** Row test result while it still describes the row; the enabled switch is not compared. */
  const rowTest = (config: McpServerConfig): McpTestState | undefined => {
    const entry = state.tests[config.id];
    if (entry && !mcpConfigChanged({ ...config, enabled: entry.config.enabled }, entry.config)) return entry.test;
    // The server refused the saved sign-in: the row asks for a new one as a failed test would.
    if (canSignIn(config) && props.signIn?.states[config.id]?.needsSignIn)
      return { status: "failed", error: t("error.backend.mcpSignInRequired"), kind: "sign-in" };
    return undefined;
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
        current.error = error instanceof Error ? sourceText(error.message) : t("mcp.panel.saveFailed");
      });
      return false;
    } finally {
      setState((current) => {
        current.busy = null;
      });
    }
  }

  /** Read from the English main sent, before it is translated: its key names the failure kind. */
  function settled(result: McpTestResult): SettledTest {
    if (result.error) return { status: "failed", error: failureText(result.error), kind: mcpFailureKind(result.error) };
    return { status: "passed", toolCount: result.toolCount };
  }

  /** A host tells every caller to sign in on the host; a panel that can sign in to it says Sign in instead. */
  function failureText(error: string): string {
    return props.signIn && isMcpSignInOnHost(error) ? t("error.backend.mcpSignInRequired") : sourceText(error);
  }

  function thrown(error: unknown): SettledTest {
    if (!(error instanceof Error)) return { status: "failed", error: t("mcp.panel.noAnswer"), kind: "other" };
    return { status: "failed", error: sourceText(error.message), kind: mcpFailureKind(error.message) };
  }

  /** Tests run without the busy latch so a slow server never blocks saving another. */
  async function runTest(config: McpServerConfig): Promise<SettledTest> {
    try {
      return settled(await props.onTest(config));
    } catch (error) {
      return thrown(error);
    }
  }

  /** A sign-in, read as a test is. `null` when the user cancelled it: that is not a failure to show. */
  async function runSignIn(config: McpServerConfig): Promise<SettledTest | null> {
    const signIn = props.signIn;
    if (!signIn) return null;
    try {
      const result = await signIn.start(config);
      return result.error && isMcpSignInCancelled(result.error) ? null : settled(result);
    } catch (error) {
      return thrown(error);
    }
  }

  /** Sign in is offered for an http server, where this computer or the joined host can sign in. */
  const canSignIn = (config: McpServerConfig) => Boolean(props.signIn) && config.transport === "http";
  const testMessage = (test: McpTestState) => mcpTestMessage(test, t, props.signIn?.remote?.hostName);

  /**
   * Counts each row's tests and sign-ins. A row can start a second one while the first still waits
   * - a Test during a sign-in, or a second Sign in that cancels the first - and only the newest
   * answer may describe the row.
   */
  const rowRuns: Record<string, number> = {};

  /** A row's test or sign-in: its pending state, then its answer. `null` clears the row. */
  async function runRow(
    config: McpServerConfig,
    pending: "testing" | "signing-in",
    answer: (config: McpServerConfig) => Promise<SettledTest | null>,
  ): Promise<void> {
    const run = (rowRuns[config.id] ?? 0) + 1;
    rowRuns[config.id] = run;
    const tested = normalizeMcpConfig(config);
    setState((current) => {
      current.tests[config.id] = { test: { status: pending }, config: tested };
    });
    const test = await answer(tested);
    if (rowRuns[config.id] !== run) return;
    setState((current) => {
      if (test) current.tests[config.id] = { test, config: tested };
      else delete current.tests[config.id];
    });
  }

  const testRow = (config: McpServerConfig) => runRow(config, "testing", runTest);
  const signInRow = (config: McpServerConfig) => runRow(config, "signing-in", runSignIn);

  /**
   * The form's test or sign-in, which answers for the draft on screen and not for any stored row.
   * It also returns the answer; `null` when there is none for this draft: the user cancelled, or
   * left or reset the form while it waited.
   */
  async function runDraft(
    pending: "testing" | "signing-in",
    answer: (config: McpServerConfig) => Promise<SettledTest | null>,
  ): Promise<SettledTest | null> {
    setState((current) => {
      current.touched = true;
    });
    if (!mcpConfigIsValid(state.draft)) return null;
    const run = ++draftTestRun;
    const tested = normalizeMcpConfig(state.draft);
    setState((current) => {
      current.formTest = { status: pending };
      current.formTestConfig = tested;
    });
    const test = await answer(tested);
    if (run !== draftTestRun) return null;
    setState((current) => {
      current.formTest = test;
      if (!test) current.formTestConfig = null;
    });
    return test;
  }

  const testDraft = () => runDraft("testing", runTest);
  const signInDraft = () => runDraft("signing-in", runSignIn);

  /**
   * Not behind the busy latch: a save or a toggle elsewhere in the panel must not leave the user
   * unable to stop a browser wait. The pending sign-in answers "cancelled" and clears itself.
   */
  function cancelSignIn(url: string): void {
    props.signIn?.cancel(url).catch((error: unknown) => {
      setState((current) => {
        current.error = error instanceof Error ? sourceText(error.message) : t("mcp.panel.saveFailed");
      });
    });
  }

  function signOut(config: McpServerConfig): void {
    const signIn = props.signIn;
    if (!signIn) return;
    void run(`sign-out:${config.id}`, async () => {
      await signIn.signOut(config.id);
      rowRuns[config.id] = (rowRuns[config.id] ?? 0) + 1;
      setState((current) => {
        delete current.tests[config.id];
      });
    });
  }

  /**
   * A joined server's waiting sign-in whose page the host opened. The form's comes first. The same
   * page stays the same value, so another row's answer does not open its dialog again.
   */
  const remotePage = createMemo(
    () => {
      const remote = props.signIn?.remote;
      if (!remote) return null;
      const form = formSignIn();
      const waiting = form
        ? { url: form.url, name: state.draft.name, rowId: null }
        : Object.entries(state.tests)
            .filter(([, entry]) => entry.test.status === "signing-in")
            .map(([rowId, entry]) => ({ url: entry.config.url, name: entry.config.name, rowId }))[0];
      if (!waiting) return null;
      const relay = remote.relay?.pages[waiting.url];
      if (relay) return { ...waiting, tabId: null, relay, remote };
      const tabId = remote.pages[waiting.url];
      return tabId ? { ...waiting, tabId, relay: null, remote } : null;
    },
    {
      equals: (previous, next) =>
        previous?.tabId === next?.tabId &&
        previous?.relay?.authorizeHost === next?.relay?.authorizeHost &&
        previous?.relay?.listening === next?.relay?.listening,
    },
  );

  // The dialog leaves with its sign-in, before it can give the focus back, and what opened it can be
  // gone: a row's Sign in button leaves as the wait starts. The row's menu button, or the form's
  // Test connection, gets the focus one frame after the dialog left.
  const menuButtons: Record<string, HTMLElement> = {};
  let formTestButton: HTMLButtonElement | undefined;
  // A URL in the command moves to Server URL, and refused credentials send the user to Headers.
  let urlInput: HTMLInputElement | undefined;
  let commandInput: HTMLInputElement | undefined;
  let headerKeyInput: HTMLInputElement | undefined;

  /** A web address in the stdio command names an http server: the form switches to it. */
  function moveToUrl(address: string): void {
    const from = document.activeElement;
    setState((current) => {
      current.draft.transport = "http";
      current.draft.url = address.trim();
      current.draft.command = "";
    });
    // A paste into an empty field leaves the stored command at "", so the field is not redrawn.
    if (commandInput) commandInput.value = "";
    // One frame later, once Server URL is mounted. The focus is still in the hidden command field
    // after a paste, or nowhere after a blur to another stdio field. A click elsewhere keeps it.
    requestAnimationFrame(() => {
      if (document.activeElement === document.body || document.activeElement === from) urlInput?.focus();
    });
  }

  createEffect(
    () => Boolean(props.addRequest),
    (requested) => {
      if (!requested) return;
      // A user who cannot add a server ends the request, so the form does not open later unasked.
      props.onAddRequestHandled?.();
      if (props.canManage) openForm(null);
    },
  );

  createEffect(
    () => {
      const id = props.signInRequest;
      return id ? props.servers.find((candidate) => candidate.id === id) : undefined;
    },
    (config) => {
      if (!config) return;
      // A row this panel cannot sign in to ends the request, so no sign-in starts later unasked.
      props.onSignInRequestHandled?.();
      if (canSignIn(config)) void signInRow(config);
    },
  );

  createEffect(
    () => remotePage()?.rowId,
    (rowId, previous) => {
      if (previous === undefined || rowId === previous) return;
      const target = previous === null ? formTestButton : menuButtons[previous];
      requestAnimationFrame(() => {
        // A connect dialog that is still open, such as the relayed sign-in, keeps the focus.
        if (target?.isConnected && !document.querySelector(".integration-wizard-dialog"))
          target.focus({ preventScroll: true });
      });
    },
  );

  function openForm(config: McpServerConfig | null): void {
    // The row's Cancel is not on the form, and an edit can change the address it signs in to: a
    // sign-in still waiting on this row ends here rather than storing a token for the old address.
    const pending = config ? state.tests[config.id] : undefined;
    if (pending?.test.status === "signing-in") cancelSignIn(pending.config.url);
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
      title: config ? t("mcp.panel.editTitle") : t("mcp.panel.connectTitle"),
      back: backToList,
      saveBar,
      save: () => void save(),
      reset: resetForm,
    });
  }

  /** Leaving or resetting the form drops its Cancel, so a sign-in still waiting ends with it. */
  function endFormSignIn(): void {
    const pending = formSignIn();
    if (pending) cancelSignIn(pending.url);
  }

  function backToList(): void {
    endFormSignIn();
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
    // A test the user already ran for this draft answers for the save too.
    const tested = formTest();
    setState((current) => {
      current.touched = true;
    });
    if (!mcpConfigIsValid(state.draft)) return;
    const connects = mcpSaveConnects(state.draft, state.baseline, state.editingId === null);
    // The connect step runs inside the save latch, so the form stays locked until the row is stored.
    let stored = false;
    await run("save", async () => {
      if (connects && !(await connectBeforeSave(tested))) return;
      // The draft's empty id stays empty: the store mints the id on insert, and a client-minted one
      // reads to it as an edit of a row that is not there.
      await props.onSave(normalizeMcpConfig(state.draft));
      stored = true;
    });
    if (stored) backToList();
  }

  /**
   * Save connects an http server first, so a server that asks for a sign-in gets one before it is
   * stored. A server that answered, or that cannot be reached now, saves as before: the address can
   * be right while the server is down. Refused credentials do not save; the user fixes Headers.
   * The save bar repeats why it did not save, as for a failed save: the test result can be off screen.
   */
  async function connectBeforeSave(tested: McpTestState | null): Promise<boolean> {
    const test = tested?.status === "passed" || tested?.status === "failed" ? tested : await testDraft();
    if (!test) return false;
    if (test.status === "passed") return true;
    if (test.kind === "refused") {
      setState((current) => {
        current.error = test.error;
      });
      // With every header row removed there is no field to focus: Add header's row comes back.
      if (state.draft.headers.length === 0)
        setState((current) => {
          current.draft.headers.push({ key: "", value: "" });
        });
      // One frame later, once the busy latch no longer disables the field and the row is mounted.
      requestAnimationFrame(() => headerKeyInput?.focus());
      return false;
    }
    if (test.kind !== "sign-in" || !canSignIn(state.draft)) return true;
    const signedIn = await signInDraft();
    if (signedIn?.status === "failed")
      setState((current) => {
        current.error = signedIn.error;
      });
    return signedIn?.status === "passed";
  }

  /** Puts the form back to what is stored, the way the General tab's save bar resets its fields. */
  function resetForm(): void {
    endFormSignIn();
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
      message: state.error || t("mcp.panel.changesNotSaved"),
      failed: Boolean(state.error),
      saving: state.busy === "save",
      resetDisabled: state.busy !== null,
      saveDisabled: disabled() || formWaiting() || (state.touched && !mcpConfigIsValid(state.draft)),
    };
  }

  function listView() {
    return (
      <SettingsSection
        class="server-mcp-section"
        title={t("mcp.panel.title")}
        /*
         * The second sentence is the panel telling the truth about its own reach. Claude is
         * started with `strictMcpConfig` and Codex is started with the names in its own file
         * turned off, so for those two this list is the whole set. OpenCode and Grok document
         * no such flag, and guessing a key name would fail silently at the next turn, so the
         * limit is stated rather than hidden.
         */
        description={t("mcp.panel.description")}
        actions={
          <Show when={props.servers.length > 0}>
            <Button type="button" size="sm" variant="outline" disabled={disabled()} onClick={() => openForm(null)}>
              <Plus aria-hidden="true" />
              {t("mcp.panel.connectCustom")}
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
                      {t("mcp.panel.empty")}
                    </Text>
                    <Button type="button" variant="outline" disabled={disabled()} onClick={() => openForm(null)}>
                      <Plus aria-hidden="true" />
                      {t("mcp.panel.connectCustom")}
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
                        {t("common.retry")}
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
                        <Badge variant={mcpStatusVariant(test())}>{mcpStatusLabel(config(), t, test())}</Badge>
                        <Show when={canSignIn(config()) && props.signIn?.states[config().id]?.signedIn}>
                          <Badge variant="outline">{t("mcp.status.signedIn")}</Badge>
                        </Show>
                      </div>
                      <Show when={test()?.status === "signing-in" && test()}>
                        {(waiting) => (
                          <>
                            <ItemDescription>{testMessage(waiting())}</ItemDescription>
                            <div class="server-mcp-row-next">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={!props.canManage}
                                aria-label={t("mcp.panel.cancelSignInTo", { name: config().name })}
                                onClick={() => cancelSignIn(config().url)}
                              >
                                {t("mcp.panel.cancelSignIn")}
                              </Button>
                            </div>
                          </>
                        )}
                      </Show>
                      <Show when={test()?.status === "failed" && test()}>
                        {(failed) => (
                          <>
                            <ItemDescription>{testMessage(failed())}</ItemDescription>
                            <Show when={asksForSignIn(failed()) && canSignIn(config())}>
                              <div class="server-mcp-row-next">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={disabled()}
                                  aria-label={t("mcp.panel.signInTo", { name: config().name })}
                                  onClick={() => void signInRow(config())}
                                >
                                  <LogIn aria-hidden="true" />
                                  {t("mcp.panel.signIn")}
                                </Button>
                              </div>
                            </Show>
                          </>
                        )}
                      </Show>
                      {/* Only when no answer is shown: a test the user just ran answers about this
                          server now, and the standing limit must not push it out of the slot. */}
                      <Show
                        when={
                          test()?.status !== "failed" &&
                          test()?.status !== "signing-in" &&
                          mcpProviderLimitNote(config(), t)
                        }
                      >
                        {(note) => <ItemDescription>{note()}</ItemDescription>}
                      </Show>
                    </ItemContent>
                    <ItemActions>
                      <Switch
                        aria-label={t("mcp.panel.enable", { name: config().name })}
                        checked={config().enabled}
                        disabled={disabled()}
                        onChange={(enabled) =>
                          void run(`enable:${config().id}`, () => props.onSetEnabled(config().id, enabled))
                        }
                      />
                      <McpRowMenu
                        name={config().name}
                        mount={props.menuMount}
                        triggerRef={(element) => {
                          menuButtons[config().id] = element;
                        }}
                        disabled={disabled()}
                        // A Test would replace the sign-in waiting on this row, and with it Cancel.
                        testDisabled={test()?.status === "signing-in"}
                        onTest={() => void testRow(config())}
                        signIn={
                          canSignIn(config())
                            ? {
                                signedIn: Boolean(props.signIn?.states[config().id]?.signedIn),
                                busy: test()?.status === "signing-in",
                                onSignIn: () => void signInRow(config()),
                                onSignOut: () => signOut(config()),
                              }
                            : undefined
                        }
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
                    // A paste moves at once. Typed text waits for the blur: the field leaves with the
                    // stdio panel, and the keys typed before Server URL has the focus would be lost.
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

              {/* The limit is named here, before the save, because it cannot be fixed afterwards:
                  the ACP schema carries no working directory, and no key for one survived testing
                  against the pinned Codex app-server, so only Claude and the test honour this
                  field. The other providers skip such a server rather than start it somewhere
                  else, and say so: the row keeps the note, and the hand-off reports the skip. */}
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

            <Show when={props.signIn?.app}>
              {(app) => (
                <McpSignInAppSection
                  api={app()}
                  mcpServerId={state.editingId}
                  urlChanged={state.draft.url.trim() !== state.baseline.url.trim()}
                  hostName={props.signIn?.remote?.hostName}
                  relayed={props.signIn?.remote?.relay !== undefined}
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
              <Show when={canSignIn(state.draft)}>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!props.canManage || formWaiting()}
                  onClick={() => void signInDraft()}
                >
                  <LogIn aria-hidden="true" />
                  {t("mcp.panel.signIn")}
                </Button>
              </Show>
              <Button
                ref={(element: HTMLButtonElement) => {
                  formTestButton = element;
                }}
                type="button"
                size="sm"
                variant="outline"
                disabled={!props.canManage || formWaiting()}
                loading={formTest()?.status === "testing"}
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
            when={formSignIn() ? state.formTest : formTest()}
            fallback={
              <Text variant="caption" tone="muted">
                {t("mcp.panel.notTested")}
              </Text>
            }
          >
            {(test) => (
              <>
                <Text class="server-mcp-test-result" variant="caption" tone={mcpTestTone(test())} role="status">
                  {testMessage(test())}
                </Text>
                <Show when={formSignIn()}>
                  {(pending) => (
                    <div class="server-mcp-row-next">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!props.canManage}
                        onClick={() => cancelSignIn(pending().url)}
                      >
                        {t("mcp.panel.cancelSignIn")}
                      </Button>
                    </div>
                  )}
                </Show>
              </>
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
      {/* Keyed by the page, so each sign-in opens a dialog of its own and a Cancel does not carry over. */}
      <Show when={remotePage()} keyed>
        {(page) => (
          <Show
            when={page.relay}
            fallback={
              <McpSignInPageDialog
                name={page.name}
                hostName={page.remote.hostName}
                page={{ runtime: page.remote.runtime, tabId: page.tabId ?? "", clipboard: page.remote.clipboard }}
                onCancel={() => cancelSignIn(page.url)}
              />
            }
          >
            {(relay) => (
              <McpSignInRelayDialog
                name={page.name}
                hostName={page.remote.hostName}
                page={relay()}
                onOpen={() => page.remote.relay?.open(page.url)}
                onPaste={(address) => page.remote.relay?.paste(page.url, address) ?? Promise.resolve()}
                onCancel={() => cancelSignIn(page.url)}
              />
            )}
          </Show>
        )}
      </Show>

      <Show when={removeTarget()}>
        {(config) => (
          <ConfirmDialog
            open
            initialFocus="cancel"
            pending={state.busy === `remove:${config().id}`}
            title={t("mcp.panel.removeTitle", { name: config().name })}
            description={t("mcp.panel.removeDescription")}
            confirmLabel={t("mcp.panel.removeConfirm")}
            pendingLabel={t("common.removing")}
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
  mount?: HTMLElement | undefined;
  triggerRef?: (element: HTMLElement) => void;
  disabled: boolean;
  testDisabled: boolean;
  onTest: () => void;
  /** Present for an http row on this computer: Sign in, or Sign out once a sign-in is held. */
  signIn?: { signedIn: boolean; busy: boolean; onSignIn: () => void; onSignOut: () => void } | undefined;
  onEdit: () => void;
  onRemove: (trigger: HTMLElement) => void;
}) {
  const { t } = useText();
  let triggerElement: HTMLElement | undefined;
  // A joined server's sign-in opens a dialog, so it starts once the menu is gone. The menu gives the
  // focus back to its trigger two frames after it closes (focusRestoreHandler in @openbot/ui
  // complex.tsx); a dialog that opened sooner would lose its focus to that. Keep the counts in step.
  let afterClose: (() => void) | undefined;
  return (
    <DropdownMenu.Root
      placement="bottom-end"
      gutter={4}
      modal={false}
      onOpenChange={(open) => {
        const next = afterClose;
        afterClose = undefined;
        if (open || !next) return;
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(next)));
      }}
    >
      <DropdownMenu.Trigger
        ref={(element) => {
          triggerElement = element;
          props.triggerRef?.(element);
        }}
        class={`${buttonVariants({ variant: "ghost", size: "icon-sm" })} ui-icon-button`}
        aria-label={t("mcp.panel.actionsFor", { name: props.name })}
        disabled={props.disabled}
      >
        <Ellipsis aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal mount={props.mount ?? document.body}>
        <DropdownMenu.Content class="server-mcp-row-menu">
          <DropdownMenu.Item disabled={props.testDisabled} onSelect={() => props.onTest()}>
            <Plug aria-hidden="true" />
            {t("mcp.panel.testConnection")}
          </DropdownMenu.Item>
          <Show when={props.signIn}>
            {(signIn) => (
              <Show
                when={signIn().signedIn}
                fallback={
                  <DropdownMenu.Item disabled={signIn().busy} onSelect={() => (afterClose = signIn().onSignIn)}>
                    <LogIn aria-hidden="true" />
                    {t("mcp.panel.signIn")}
                  </DropdownMenu.Item>
                }
              >
                <DropdownMenu.Item onSelect={() => signIn().onSignOut()}>
                  <LogOut aria-hidden="true" />
                  {t("mcp.panel.signOut")}
                </DropdownMenu.Item>
              </Show>
            )}
          </Show>
          <DropdownMenu.Item onSelect={() => props.onEdit()}>
            <Pencil aria-hidden="true" />
            {t("common.edit")}
          </DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item
            class="ui-action-menu-danger"
            onSelect={() => triggerElement && props.onRemove(triggerElement)}
          >
            <Trash2 aria-hidden="true" />
            {t("common.remove")}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** A server that asked for a sign-in: the row offers Sign in beside the sentence. */
function asksForSignIn(test: McpTestState): boolean {
  return test.status === "failed" && test.kind === "sign-in";
}

/** A failed test is the only one that reads as an error; a pass is a plain, quiet sentence. */
function mcpTestTone(test: McpTestState): "danger" | "success" | "muted" {
  if (test.status === "failed") return "danger";
  return test.status === "passed" ? "success" : "muted";
}
