import type { McpSignInAppState, SaveMcpSignInAppInput } from "@openbot/contracts/ipc";
import { Button, CopyButton, Field, Input, SettingsSection, Text, Trash2 } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createEffect, createStore, Show } from "solid-js";

export interface McpPanelSignInApp {
  load: (mcpServerId: string) => Promise<McpSignInAppState>;
  save: (input: SaveMcpSignInAppInput) => Promise<McpSignInAppState>;
  remove: (mcpServerId: string) => Promise<McpSignInAppState>;
}

interface AppFormState {
  stored: McpSignInAppState | null;
  loadError: string;
  clientId: string;
  clientSecret: string;
  clearSecret: boolean;
  scope: string;
  busy: "save" | "remove" | null;
  status: string;
  error: string;
}

export function McpSignInAppSection(props: {
  api: McpPanelSignInApp;
  mcpServerId: string | null;
  urlChanged: boolean;
  hostName?: string | undefined;
  relayed?: boolean | undefined;
  disabled: boolean;
}) {
  const { t, errorMessage } = useText();
  const [state, setState] = createStore<AppFormState>({
    stored: null,
    loadError: "",
    clientId: "",
    clientSecret: "",
    clearSecret: false,
    scope: "",
    busy: null,
    status: "",
    error: "",
  });
  let loadRun = 0;

  function show(stored: McpSignInAppState): void {
    setState((current) => {
      current.stored = stored;
      current.loadError = "";
      current.clientId = stored.app?.clientId ?? "";
      current.clientSecret = "";
      current.clearSecret = false;
      current.scope = stored.app?.scope ?? "";
    });
  }

  createEffect(
    () => ({ mcpServerId: props.mcpServerId, load: props.api.load }),
    ({ mcpServerId, load }) => {
      const run = ++loadRun;
      if (!mcpServerId) return;
      load(mcpServerId).then(
        (stored) => {
          if (run === loadRun) show(stored);
        },
        (error: unknown) => {
          if (run !== loadRun) return;
          setState((current) => {
            current.loadError = errorMessage(error, t("mcp.panel.appLoadFailed"));
          });
        },
      );
    },
  );

  const app = () => state.stored?.app ?? null;
  const changed = () =>
    state.clientId.trim() !== (app()?.clientId ?? "") ||
    state.scope.trim() !== (app()?.scope ?? "") ||
    state.clientSecret !== "" ||
    state.clearSecret;
  const locked = () => props.disabled || state.busy !== null || state.stored === null;

  async function run(
    busy: "save" | "remove",
    action: (mcpServerId: string) => Promise<McpSignInAppState>,
    done: string,
  ): Promise<void> {
    const mcpServerId = props.mcpServerId;
    if (!mcpServerId || state.busy !== null) return;
    setState((current) => {
      current.busy = busy;
      current.status = "";
      current.error = "";
    });
    try {
      show(await action(mcpServerId));
      setState((current) => {
        current.status = done;
      });
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

  const save = () =>
    run(
      "save",
      (mcpServerId) =>
        props.api.save({
          mcpServerId,
          clientId: state.clientId.trim(),
          clientSecret: state.clearSecret ? "" : state.clientSecret || null,
          scope: state.scope.trim(),
        }),
      t("mcp.panel.appSaved"),
    );
  const remove = () => run("remove", props.api.remove, t("mcp.panel.appRemoved"));

  return (
    <SettingsSection
      class="server-mcp-section"
      title={t("mcp.panel.appTitle")}
      description={t("mcp.panel.appDescription")}
      actions={
        <Show when={props.mcpServerId && !props.urlChanged}>
          <Show when={app()}>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={locked()}
              loading={state.busy === "remove"}
              loadingLabel={t("common.removing")}
              onClick={() => void remove()}
            >
              {t("mcp.panel.removeApp")}
            </Button>
          </Show>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={locked() || !changed() || state.clientId.trim() === ""}
            loading={state.busy === "save"}
            loadingLabel={t("common.saving")}
            onClick={() => void save()}
          >
            {t("mcp.panel.saveApp")}
          </Button>
        </Show>
      }
    >
      <Show
        when={props.mcpServerId && !props.urlChanged}
        fallback={
          <Text variant="caption" tone="muted">
            {t(props.mcpServerId ? "mcp.panel.appUrlChanged" : "mcp.panel.appSaveFirst")}
          </Text>
        }
      >
        <Show when={state.loadError}>
          <Text class="server-mcp-error" variant="caption" tone="danger" role="alert">
            {state.loadError}
          </Text>
        </Show>
        <Field
          label={t("mcp.panel.callbackUrl")}
          description={
            props.hostName
              ? t(props.relayed ? "mcp.panel.callbackUrlRelayed" : "mcp.panel.callbackUrlOnHost", {
                  host: props.hostName,
                })
              : t("mcp.panel.callbackUrlDescription")
          }
        >
          <div class="server-mcp-callback">
            <Show
              when={state.stored?.redirectUrl}
              fallback={
                <Text variant="caption" tone="muted">
                  {t(state.stored ? "mcp.panel.callbackUrlUnavailable" : "common.loading")}
                </Text>
              }
            >
              {(url) => (
                <>
                  <code class="server-mcp-callback-url">{url()}</code>
                  <CopyButton value={url()} label={t("mcp.panel.copyCallbackUrl")} iconOnly />
                </>
              )}
            </Show>
          </div>
        </Field>
        <Field label={t("mcp.panel.clientId")}>
          <Input
            size="md"
            autocomplete="off"
            spellcheck={false}
            value={state.clientId}
            disabled={locked()}
            onValueChange={(value) =>
              setState((current) => {
                current.clientId = value;
              })
            }
          />
        </Field>
        <Field
          label={t("mcp.panel.clientSecret")}
          description={
            state.clearSecret
              ? t("mcp.panel.clientSecretRemoved")
              : app()?.secretSaved
                ? t("mcp.panel.clientSecretSaved")
                : t("mcp.panel.clientSecretDescription")
          }
        >
          <div class="server-mcp-repeat-row">
            <Input
              size="md"
              type="password"
              autocomplete="off"
              spellcheck={false}
              value={state.clientSecret}
              disabled={locked() || state.clearSecret}
              onValueChange={(value) =>
                setState((current) => {
                  current.clientSecret = value;
                })
              }
            />
            <Show when={app()?.secretSaved && !state.clearSecret}>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={locked()}
                onClick={() =>
                  setState((current) => {
                    current.clearSecret = true;
                    current.clientSecret = "";
                  })
                }
              >
                <Trash2 aria-hidden="true" />
                {t("mcp.panel.removeClientSecret")}
              </Button>
            </Show>
          </div>
        </Field>
        <Field label={t("mcp.panel.scopes")} description={t("mcp.panel.scopesDescription")}>
          <Input
            size="md"
            autocomplete="off"
            spellcheck={false}
            value={state.scope}
            disabled={locked()}
            onValueChange={(value) =>
              setState((current) => {
                current.scope = value;
              })
            }
          />
        </Field>
        <Show when={state.error || state.status}>
          <Text
            class="server-mcp-test-result"
            variant="caption"
            tone={state.error ? "danger" : "success"}
            role={state.error ? "alert" : "status"}
          >
            {state.error || state.status}
          </Text>
        </Show>
      </Show>
    </SettingsSection>
  );
}
