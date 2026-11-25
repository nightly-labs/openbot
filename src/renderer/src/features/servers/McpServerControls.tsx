import {
  Badge,
  Button,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  LogIn,
  LogOut,
  Plug,
  SettingsSection,
  Switch,
  Text,
} from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createStore, Show } from "solid-js";
import { McpRelaySignIn } from "./McpRelaySignIn";
import { McpSignInAppSection } from "./McpSignInAppSection";
import { asksForSignIn, type McpServerTools, type SettledTest, useMcpRuns } from "./mcp-server-tools";
import {
  type McpServerConfig,
  type McpTestState,
  mcpConfigChanged,
  mcpProviderLimitNote,
  mcpStatusLabel,
  mcpStatusVariant,
  mcpUrlAtAddress,
  normalizeMcpConfig,
} from "./mcp-servers";

interface ControlsState {
  busy: string | null;
  error: string;
  test: { test: McpTestState; config: McpServerConfig } | null;
  signInAppShown: boolean;
}

export function McpServerControls(props: { tools: McpServerTools; id: string }) {
  const { t, errorMessage } = useText();
  const runs = useMcpRuns(() => props.tools);
  const [state, setState] = createStore<ControlsState>({ busy: null, error: "", test: null, signInAppShown: false });
  let run = 0;
  let testButton: HTMLButtonElement | undefined;

  const config = createMemo(() => props.tools.servers().find((candidate) => candidate.id === props.id));
  const signedIn = () => Boolean(props.tools.signIns()[props.id]?.signedIn);
  const signInApp = () => (config()?.transport === "http" ? props.tools.signIn()?.app : undefined);

  const test = createMemo((): McpTestState | undefined => {
    const current = config();
    if (!current) return undefined;
    const entry = state.test;
    if (entry && !mcpConfigChanged({ ...current, enabled: entry.config.enabled }, entry.config)) return entry.test;
    if (runs.canSignIn(current) && props.tools.signIns()[props.id]?.needsSignIn)
      return { status: "failed", error: t("error.backend.mcpSignInRequired"), kind: "sign-in" };
    return undefined;
  });
  const waiting = () => (test()?.status === "signing-in" ? state.test?.config : undefined);
  const otherAddress = () => {
    const current = test();
    const row = config();
    return current?.status === "failed" && row ? mcpUrlAtAddress(row.url, current.address) : undefined;
  };

  async function latch(key: string, action: () => Promise<void>): Promise<void> {
    if (state.busy !== null) return;
    setState((current) => {
      current.busy = key;
      current.error = "";
    });
    try {
      await action();
    } catch (error) {
      setState((current) => {
        current.error = errorMessage(error, t("mcp.panel.saveFailed"));
      });
    } finally {
      setState((current) => {
        current.busy = null;
      });
    }
  }

  async function measure(
    pending: "testing" | "signing-in",
    answer: (config: McpServerConfig) => Promise<SettledTest | null>,
  ): Promise<void> {
    const current = config();
    if (!current) return;
    const mine = ++run;
    const tested = normalizeMcpConfig(current);
    setState((draft) => {
      draft.test = { test: { status: pending }, config: tested };
    });
    const result = await answer(tested);
    if (mine !== run) return;
    setState((draft) => {
      draft.test = result ? { test: result, config: tested } : null;
      if (result?.status === "failed" && result.kind === "sign-in-app") draft.signInAppShown = true;
    });
  }

  const testServer = () => measure("testing", runs.runTest);
  const signIn = () => measure("signing-in", runs.runSignIn);

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

  async function switchAddress(url: string): Promise<void> {
    const current = config();
    if (!current) return;
    let saved = false;
    await latch("address", async () => {
      await props.tools.save({ ...current, url });
      saved = true;
    });
    if (saved) void signIn();
  }

  function signOut(): void {
    const tools = props.tools.signIn();
    if (!tools) return;
    void latch("sign-out", async () => {
      await tools.signOut(props.id);
      run += 1;
      setState((current) => {
        current.test = null;
      });
    });
  }

  createEffect(
    () => ({ api: signInApp(), mcpServerId: props.id }),
    ({ api, mcpServerId }) => {
      if (!api) return;
      api
        .load(mcpServerId)
        .then((stored) => {
          if (stored.app)
            setState((current) => {
              current.signInAppShown = true;
            });
        })
        .catch(() => undefined);
    },
  );

  createEffect(
    () => {
      const current = config();
      return current && props.tools.signInRequest() === props.id ? current : undefined;
    },
    (current) => {
      if (!current) return;
      props.tools.endSignInRequest();
      if (runs.canSignIn(current)) void signIn();
    },
  );

  const connection = (
    <Show when={config()}>
      {(server) => (
        <SettingsSection
          class="server-mcp-section server-mcp-controls"
          data-disabled={server().enabled ? undefined : ""}
          title={t("marketplace.app.connection")}
        >
          <ItemGroup class="settings-modal-card">
            <Item class="settings-modal-row">
              <ItemContent>
                <div class="server-mcp-row-title">
                  <ItemTitle>{server().name}</ItemTitle>
                  <Badge variant={mcpStatusVariant(test())}>{mcpStatusLabel(server(), t, test())}</Badge>
                  <Show when={runs.canSignIn(server()) && signedIn()}>
                    <Badge variant="outline">{t("mcp.status.signedIn")}</Badge>
                  </Show>
                </div>
                <Show when={test()?.status === "failed" || test()?.status === "signing-in" ? test() : undefined}>
                  {(answer) => (
                    <ItemDescription class="server-mcp-row-text" role="status">
                      {runs.testMessage(answer())}
                    </ItemDescription>
                  )}
                </Show>
                <Show
                  when={
                    test()?.status !== "failed" && test()?.status !== "signing-in"
                      ? mcpProviderLimitNote(server(), t)
                      : null
                  }
                >
                  {(note) => <ItemDescription class="server-mcp-row-text">{note()}</ItemDescription>}
                </Show>
                <Show when={otherAddress()}>
                  {(address) => (
                    <div class="server-mcp-row-next">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={state.busy !== null}
                        loading={state.busy === "address"}
                        onClick={() => void switchAddress(address())}
                      >
                        {t("mcp.panel.useAddress")}
                      </Button>
                    </div>
                  )}
                </Show>
                <Show when={waiting()}>
                  {(pending) => (
                    <div class="server-mcp-row-next">
                      <Button type="button" size="sm" variant="outline" onClick={() => cancelSignIn(pending().url)}>
                        {t("mcp.panel.cancelSignIn")}
                      </Button>
                    </div>
                  )}
                </Show>
              </ItemContent>
              <ItemActions>
                <Show when={runs.canSignIn(server()) && !waiting()}>
                  <Show
                    when={signedIn() && !asksForSignIn(test() ?? { status: "testing" })}
                    fallback={
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={state.busy !== null}
                        aria-label={t("mcp.panel.signInTo", { name: server().name })}
                        onClick={() => void signIn()}
                      >
                        <LogIn aria-hidden="true" />
                        {t("mcp.panel.signIn")}
                      </Button>
                    }
                  >
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={state.busy !== null}
                      loading={state.busy === "sign-out"}
                      onClick={signOut}
                    >
                      <LogOut aria-hidden="true" />
                      {t("mcp.panel.signOut")}
                    </Button>
                  </Show>
                </Show>
                <Button
                  ref={(element: HTMLButtonElement) => {
                    testButton = element;
                  }}
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={Boolean(waiting())}
                  loading={test()?.status === "testing"}
                  loadingLabel={t("common.connecting")}
                  onClick={() => void testServer()}
                >
                  <Plug aria-hidden="true" />
                  {t("mcp.panel.testConnection")}
                </Button>
                <Switch
                  aria-label={t("mcp.panel.enable", { name: server().name })}
                  checked={server().enabled}
                  disabled={state.busy !== null}
                  onChange={(enabled) => void latch("enable", () => props.tools.setEnabled(props.id, enabled))}
                />
              </ItemActions>
            </Item>
          </ItemGroup>
          <Show when={state.error}>
            <Text class="server-mcp-runtime-note" variant="caption" tone="danger" role="alert">
              {state.error}
            </Text>
          </Show>
          <Show when={server().transport === "stdio" ? props.tools.toolRuntimeNote() : null}>
            {(note) => (
              <Text class="server-mcp-runtime-note" variant="caption" tone="muted">
                {note()}
              </Text>
            )}
          </Show>

          <McpRelaySignIn
            tools={props.tools}
            pending={waiting()}
            onCancel={cancelSignIn}
            returnFocus={() => testButton}
          />
        </SettingsSection>
      )}
    </Show>
  );
  return (
    <>
      {connection}
      <Show when={state.signInAppShown ? signInApp() : undefined}>
        {(api) => (
          <McpSignInAppSection
            api={api()}
            mcpServerId={props.id}
            urlChanged={false}
            hostName={props.tools.signIn()?.relay?.hostName}
            relayed={props.tools.signIn()?.relay !== undefined}
            disabled={state.busy !== null}
          />
        )}
      </Show>
    </>
  );
}
