import type {
  AcpRegistryEntry,
  AcpRegistryInstallInput,
  AcpRegistryOperation,
  CustomAgentResult,
} from "@openbot/contracts/ipc";
import { isNewCustomAgentId } from "@openbot/contracts/ipc";
import {
  Button,
  Field,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  SettingsSection,
  Text,
} from "@openbot/ui";
import { createEffect, createStore, For, Show } from "solid-js";
import { useText } from "../../text";

export interface AcpRegistrySettingsApi {
  search(query: string): Promise<AcpRegistryEntry[]>;
  status(): Promise<AcpRegistryOperation[]>;
  install(input: AcpRegistryInstallInput): Promise<CustomAgentResult>;
  cancel(registryId: string): Promise<void>;
  remove(registryId: string): Promise<void>;
}

/** Commands are installed on the host supplied by the application. Manual agents remain separate. */
export function AcpRegistrySettings(props: { api: AcpRegistrySettingsApi }) {
  const { t, errorMessage } = useText();
  const [state, setState] = createStore<{
    query: string;
    entries: AcpRegistryEntry[];
    opened: boolean;
    loading: boolean;
    busy: string | null;
    error: string | null;
    selected: AcpRegistryEntry | null;
    customAgentId: string;
  }>({
    query: "",
    entries: [],
    opened: false,
    loading: false,
    busy: null,
    error: null,
    selected: null,
    customAgentId: "",
  });
  createEffect(
    () => state.busy,
    (id) => {
      if (!id) return;
      let disposed = false;
      let reading = false;
      const timer = setInterval(async () => {
        if (reading) return;
        reading = true;
        try {
          const operations = await props.api.status();
          if (!disposed && !operations.some((item) => item.registryId === id && item.state === "installing")) {
            setState((s) => {
              s.busy = null;
            });
            await search();
          }
        } catch (error) {
          if (!disposed)
            setState((s) => {
              s.error = errorMessage(error, t("customProvider.registry.failed"));
            });
        } finally {
          reading = false;
        }
      }, 1000);
      return () => {
        disposed = true;
        clearInterval(timer);
      };
    },
  );
  async function search() {
    setState((s) => {
      s.loading = true;
      s.error = null;
      s.opened = true;
    });
    try {
      const entries = await props.api.search(state.query);
      const operations = await props.api.status();
      setState((s) => {
        s.entries = entries;
        s.busy = operations.find((item) => item.state === "installing")?.registryId ?? null;
      });
    } catch (error) {
      setState((s) => {
        s.error = errorMessage(error, t("customProvider.registry.failed"));
      });
    } finally {
      setState((s) => {
        s.loading = false;
      });
    }
  }
  async function install(entry: AcpRegistryEntry, customAgentId: string) {
    setState((s) => {
      s.busy = entry.id;
      s.error = null;
    });
    try {
      await props.api.install({ registryId: entry.id, customAgentId, name: entry.name });
      setState((s) => {
        s.selected = null;
      });
      await search();
    } catch (error) {
      setState((s) => {
        s.error = errorMessage(error, t("customProvider.registry.failed"));
      });
    } finally {
      setState((s) => {
        s.busy = null;
      });
    }
  }
  async function remove(id: string) {
    setState((s) => {
      s.busy = id;
      s.error = null;
    });
    try {
      await props.api.remove(id);
      await search();
    } catch (error) {
      setState((s) => {
        s.error = errorMessage(error, t("customProvider.registry.failed"));
      });
    } finally {
      setState((s) => {
        s.busy = null;
      });
    }
  }
  async function cancel(id: string) {
    try {
      await props.api.cancel(id);
      await search();
    } catch (error) {
      setState((s) => {
        s.error = errorMessage(error, t("customProvider.registry.failed"));
      });
    }
  }
  return (
    <SettingsSection title={t("customProvider.registry.title")} description={t("customProvider.registry.description")}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <Field label={t("customProvider.registry.search")}>
          <Input
            value={state.query}
            onValueChange={(query) =>
              setState((s) => {
                s.query = query;
              })
            }
          />
        </Field>
        <Button type="submit" disabled={state.loading}>
          {t("customProvider.registry.search")}
        </Button>
      </form>
      <Show when={state.error}>{(error) => <Text role="alert">{error()}</Text>}</Show>
      <Show when={state.opened && !state.loading && state.entries.length === 0}>
        <Text>{t("customProvider.registry.empty")}</Text>
      </Show>
      <Show when={state.selected}>
        {(entry) => (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void install(entry(), state.customAgentId);
            }}
          >
            <Field label={t("customProvider.registry.agentId")}>
              <Input
                value={state.customAgentId}
                onValueChange={(value) =>
                  setState((s) => {
                    s.customAgentId = value;
                  })
                }
              />
            </Field>
            <Button type="submit" disabled={state.busy !== null || !isNewCustomAgentId(state.customAgentId)}>
              {t("customProvider.registry.install")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={state.busy !== null}
              onClick={() =>
                setState((s) => {
                  s.selected = null;
                })
              }
            >
              {t("common.cancel")}
            </Button>
          </form>
        )}
      </Show>
      <ItemGroup>
        <For each={state.entries}>
          {(entry) => (
            <Item>
              <ItemContent>
                <ItemTitle>{entry.name}</ItemTitle>
                <ItemDescription>{entry.description}</ItemDescription>
                <Text tone="muted">{entry.version}</Text>
              </ItemContent>
              <ItemActions>
                <Show
                  when={state.busy === entry.id}
                  fallback={
                    <>
                      <Button
                        disabled={
                          state.busy !== null ||
                          entry.installedVersion === entry.version ||
                          entry.distributions.length === 0
                        }
                        onClick={() => {
                          if (entry.customAgentId) void install(entry, entry.customAgentId);
                          else
                            setState((s) => {
                              s.selected = entry;
                              s.customAgentId = isNewCustomAgentId(entry.id)
                                ? entry.id
                                : `registry-${entry.id}`.slice(0, 40);
                            });
                        }}
                      >
                        {t(
                          entry.installedVersion ? "customProvider.registry.update" : "customProvider.registry.install",
                        )}
                      </Button>
                      <Show when={entry.installedVersion}>
                        <Button
                          variant="destructive-ghost"
                          disabled={state.busy !== null}
                          onClick={() => void remove(entry.id)}
                        >
                          {t("customProvider.registry.remove")}
                        </Button>
                      </Show>
                    </>
                  }
                >
                  <Button variant="ghost" onClick={() => void cancel(entry.id)}>
                    {t("common.cancel")}
                  </Button>
                </Show>
              </ItemActions>
            </Item>
          )}
        </For>
      </ItemGroup>
    </SettingsSection>
  );
}
