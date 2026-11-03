import type { GoogleConnectionsSnapshot, McpSignInRelayPage, OpenBotDesktopApi } from "@openbot/contracts/ipc";
import {
  Button,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  SearchSelect,
  SettingsSection,
  Text,
} from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createEffect, createStore, For, onSettled, Show, untrack } from "solid-js";
export interface ServerGoogleOptions {
  calls?: OpenBotDesktopApi["googleConnections"];
}
interface State {
  snapshot: GoogleConnectionsSnapshot | null;
  busy: boolean;
  error: string | null;
  template: string;
  selected: Record<string, string>;
  page: McpSignInRelayPage | null;
  callback: string;
}
/** Personal Google accounts are visible to their owner, including regular members. */
export function ServerGooglePanel(
  props: ServerGoogleOptions & { serverId: string; active: boolean; menuMount: HTMLElement | undefined },
) {
  const { t, errorMessage } = useText();
  const calls = () => props.calls ?? window.openbot.googleConnections;
  const [state, setState] = createStore<State>({
    snapshot: null,
    busy: false,
    error: null,
    template: "",
    selected: {},
    page: null,
    callback: "",
  });
  let alive = true;
  onSettled(() => () => {
    alive = false;
    generation++;
  });
  let generation = 0;
  let loading = false;
  async function load(serverId: string, current: number) {
    if (loading) return;
    loading = true;
    try {
      const next = await calls().state(serverId);
      const page = await calls().page(serverId);
      if (current === generation)
        setState((s) => {
          s.snapshot = next;
          s.page = page;
        });
    } catch (error) {
      if (current === generation)
        setState((s) => {
          s.error = errorMessage(error, t("server.google.failed"));
        });
    } finally {
      loading = false;
    }
  }
  createEffect(
    () => ({ serverId: props.serverId, active: props.active }),
    ({ serverId, active }) => {
      const current = ++generation;
      if (!active) return;
      void untrack(() => load(serverId, current));
      const timer = setInterval(() => {
        void load(serverId, current);
      }, 1500);
      return () => {
        clearInterval(timer);
      };
    },
  );
  async function run(
    action: (api: OpenBotDesktopApi["googleConnections"], serverId: string) => Promise<GoogleConnectionsSnapshot>,
  ) {
    if (state.busy) return;
    const serverId = props.serverId;
    const current = generation;
    const api = calls();
    setState((s) => {
      s.busy = true;
      s.error = null;
    });
    try {
      const next = await action(api, serverId);
      if (next && current === generation)
        setState((s) => {
          s.snapshot = next;
        });
    } catch (error) {
      if (current === generation)
        setState((s) => {
          s.error = errorMessage(error, t("server.google.failed"));
        });
    } finally {
      if (alive)
        setState((s) => {
          s.busy = false;
          s.page = null;
        });
    }
  }
  async function control(action: () => Promise<void>) {
    try {
      await action();
    } catch (error) {
      if (alive)
        setState((s) => {
          s.error = errorMessage(error, t("server.google.failed"));
        });
    }
  }
  return (
    <>
      <Show when={state.error}>
        <Text role="alert" variant="body">
          {state.error}
        </Text>
      </Show>
      <Show when={state.snapshot} fallback={<Text variant="body">{t("server.google.loading")}</Text>}>
        {(snapshot) => (
          <>
            <Show when={!snapshot().configured}>
              <SettingsSection title={t("server.google.setupTitle")}>
                <ItemGroup class="settings-modal-card">
                  <Item>
                    <ItemContent>
                      <ItemTitle>{t("server.google.setupTitle")}</ItemTitle>
                      <ItemDescription>
                        {t(snapshot().canConfigure ? "server.google.setupAdmin" : "server.google.setupMember")}
                      </ItemDescription>
                    </ItemContent>
                    <Show when={snapshot().canConfigure}>
                      <ItemActions>
                        <SearchSelect<string>
                          options={snapshot().templates.map((p) => p.id)}
                          value={state.template}
                          label={(id) =>
                            snapshot().templates.find((p) => p.id === id)?.name ?? t("server.google.chooseConnector")
                          }
                          onChange={(id) =>
                            id &&
                            setState((s) => {
                              s.template = id;
                            })
                          }
                          disabled={state.busy}
                          mount={props.menuMount}
                          aria-label={t("server.google.chooseConnector")}
                        />
                        <Button
                          disabled={state.busy || !state.template}
                          onClick={() => void run((api, id) => api.configure({ mcpServerId: state.template }, id))}
                        >
                          {t("server.google.enable")}
                        </Button>
                      </ItemActions>
                    </Show>
                  </Item>
                </ItemGroup>
              </SettingsSection>
            </Show>
            <Show when={snapshot().configured}>
              <SettingsSection title={t("server.google.accounts")}>
                <ItemGroup class="settings-modal-card">
                  <Item>
                    <ItemContent>
                      <ItemTitle>{t("server.google.connectTitle")}</ItemTitle>
                      <ItemDescription>{t("server.google.connectDescription")}</ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Button
                        disabled={state.busy}
                        onClick={() => void run((api, id) => api.signIn({ profileId: null }, id))}
                      >
                        {t("server.google.connect")}
                      </Button>
                    </ItemActions>
                  </Item>
                </ItemGroup>
                <For each={snapshot().profiles}>
                  {(profile) => (
                    <ItemGroup class="settings-modal-card">
                      <Item>
                        <ItemContent>
                          <ItemTitle>{profile.email ?? t("server.google.pendingAccount")}</ItemTitle>
                          <ItemDescription>
                            {profile.signingIn
                              ? t("server.google.waiting")
                              : profile.agentName
                                ? t("server.google.assigned", { name: profile.agentName })
                                : t(profile.connected ? "server.google.chooseAgent" : "server.google.disconnected")}
                          </ItemDescription>
                          <Show when={profile.error}>
                            <ItemDescription>{profile.error}</ItemDescription>
                          </Show>
                        </ItemContent>
                        <ItemActions>
                          <Show when={!profile.connected && !profile.signingIn}>
                            <Button
                              variant="secondary"
                              disabled={state.busy}
                              onClick={() => void run((api, id) => api.signIn({ profileId: profile.id }, id))}
                            >
                              {t("server.google.reconnect")}
                            </Button>
                          </Show>
                          <Show when={profile.connected}>
                            <Button
                              variant="secondary"
                              disabled={state.busy}
                              onClick={() => void run((api, id) => api.disconnect({ profileId: profile.id }, id))}
                            >
                              {t("server.google.disconnect")}
                            </Button>
                          </Show>
                        </ItemActions>
                      </Item>
                      <Show when={profile.connected}>
                        <Item>
                          <ItemContent>
                            <ItemTitle>{t("server.google.chooseAgent")}</ItemTitle>
                            <ItemDescription>{t("server.google.assignmentPrivacy")}</ItemDescription>
                            <Show when={profile.eligibleAgentIds.length === 0}>
                              <ItemDescription>{t("server.google.noAgents")}</ItemDescription>
                            </Show>
                          </ItemContent>
                          <ItemActions>
                            <SearchSelect<string>
                              options={profile.eligibleAgentIds}
                              value={state.selected[profile.id] ?? profile.agentId ?? ""}
                              label={(id) =>
                                snapshot().eligibleAgents.find((a) => a.id === id)?.name ??
                                t("server.google.chooseAgent")
                              }
                              disabled={state.busy}
                              mount={props.menuMount}
                              aria-label={t("server.google.chooseAgent")}
                              onChange={(id) =>
                                id &&
                                setState((s) => {
                                  s.selected[profile.id] = id;
                                })
                              }
                            />
                            <Button
                              disabled={
                                state.busy ||
                                !state.selected[profile.id] ||
                                state.selected[profile.id] === profile.agentId
                              }
                              onClick={() => {
                                const agentId = state.selected[profile.id];
                                if (agentId) void run((api, id) => api.assign({ profileId: profile.id, agentId }, id));
                              }}
                            >
                              {t("server.google.assign")}
                            </Button>
                          </ItemActions>
                        </Item>
                      </Show>
                    </ItemGroup>
                  )}
                </For>
              </SettingsSection>
            </Show>
            <Show when={state.busy}>
              <Item>
                <ItemContent>
                  <ItemTitle>{t("server.google.waiting")}</ItemTitle>
                  <ItemDescription>{t("server.google.browser")}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button variant="secondary" onClick={() => void control(() => calls().cancel(props.serverId))}>
                    {t("server.google.cancel")}
                  </Button>
                </ItemActions>
              </Item>
            </Show>
            <Show when={state.page}>
              <ItemGroup class="settings-modal-card">
                <Item>
                  <ItemContent>
                    <ItemTitle>{t("server.google.browser")}</ItemTitle>
                    <ItemDescription>{t("server.google.callbackHelp")}</ItemDescription>
                    <Input
                      type="password"
                      autocomplete="off"
                      value={state.callback}
                      aria-label={t("server.google.callbackLabel")}
                      onInput={(event) =>
                        setState((s) => {
                          s.callback = event.currentTarget.value;
                        })
                      }
                    />
                  </ItemContent>
                  <ItemActions>
                    <Button variant="secondary" onClick={() => void control(() => calls().open(props.serverId))}>
                      {t("server.google.openBrowser")}
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={!state.callback}
                      onClick={() => {
                        const callback = state.callback;
                        setState((s) => {
                          s.callback = "";
                        });
                        void calls()
                          .paste({ address: callback }, props.serverId)
                          .catch((error) =>
                            setState((s) => {
                              s.error = errorMessage(error, t("server.google.failed"));
                            }),
                          );
                      }}
                    >
                      {t("server.google.finish")}
                    </Button>
                  </ItemActions>
                </Item>
              </ItemGroup>
            </Show>
          </>
        )}
      </Show>
    </>
  );
}
