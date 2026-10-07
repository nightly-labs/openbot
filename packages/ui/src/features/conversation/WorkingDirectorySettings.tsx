import type {
  BrowseWorkingDirectoryInput,
  HostDirectory,
  WorkingDirectorySettings as Settings,
  SetWorkingDirectoryInput,
} from "@openbot/contracts/ipc";
import { Button, Input, Text } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createEffect, createStore, For, Show } from "solid-js";

export interface WorkingDirectoryCalls {
  getWorkingDirectory(agentId: string): Promise<Settings>;
  setWorkingDirectory(input: SetWorkingDirectoryInput): Promise<Settings>;
  browseWorkingDirectory(input: BrowseWorkingDirectoryInput): Promise<HostDirectory>;
  chooseWorkingDirectory?(agentId: string): Promise<string | null>;
}

export function WorkingDirectorySettings(props: {
  agentId: string;
  revision?: string | null;
  hostName: string;
  working: boolean;
  calls: WorkingDirectoryCalls;
}) {
  const { t, errorMessage } = useText();
  const [state, setState] = createStore<{
    settings: Settings | null;
    directory: HostDirectory | null;
    path: string;
    hidden: boolean;
    pending: boolean;
    error: string | null;
  }>({ settings: null, directory: null, path: "", hidden: false, pending: false, error: null });
  let revision = 0;
  createEffect(
    () => [props.agentId, props.calls, props.working, props.revision] as const,
    ([agentId, calls]) => {
      const current = ++revision;
      setState((draft) => {
        Object.assign(draft, { settings: null, directory: null, path: "", hidden: false, pending: false, error: null });
      });
      void calls
        .getWorkingDirectory(agentId)
        .then((settings) => {
          if (revision === current)
            setState((draft) => {
              Object.assign(draft, { settings });
            });
        })
        .catch((error) => {
          if (revision === current)
            setState((draft) => {
              Object.assign(draft, { error: errorMessage(error, t("agentSettings.directory.failed")) });
            });
        });
      return () => {
        revision++;
      };
    },
  );
  const disabled = () => props.working || state.pending || state.settings?.busy;
  async function browse(path: string | null, offset = 0, showHidden = state.hidden) {
    const current = revision;
    setState((draft) => {
      Object.assign(draft, { pending: true, error: null });
    });
    try {
      const directory = await props.calls.browseWorkingDirectory({
        agentId: props.agentId,
        path,
        offset,
        showHidden,
      });
      if (current === revision)
        setState((draft) => {
          Object.assign(draft, { directory, path: directory.path });
        });
    } catch (error) {
      if (current === revision)
        setState((draft) => {
          Object.assign(draft, { error: errorMessage(error, t("agentSettings.directory.failed")) });
        });
    } finally {
      if (current === revision)
        setState((draft) => {
          Object.assign(draft, { pending: false });
        });
    }
  }
  async function choose() {
    if (!props.calls.chooseWorkingDirectory) return browse(null);
    const current = revision;
    try {
      const path = await props.calls.chooseWorkingDirectory(props.agentId);
      if (current === revision && path !== null) await browse(path);
    } catch (error) {
      if (current === revision)
        setState((draft) => {
          Object.assign(draft, { error: errorMessage(error, t("agentSettings.directory.failed")) });
        });
    }
  }
  async function save(path: string | null) {
    const current = revision;
    setState((draft) => {
      Object.assign(draft, { pending: true, error: null });
    });
    try {
      const settings = await props.calls.setWorkingDirectory({ agentId: props.agentId, path });
      if (current === revision)
        setState((draft) => {
          Object.assign(draft, { settings, directory: null });
        });
    } catch (error) {
      if (current === revision)
        setState((draft) => {
          Object.assign(draft, { error: errorMessage(error, t("agentSettings.directory.failed")) });
        });
    } finally {
      if (current === revision)
        setState((draft) => {
          Object.assign(draft, { pending: false });
        });
    }
  }
  return (
    <div class="agent-working-directory">
      <span class="agent-settings-runtime-label">{t("agentSettings.runtime.workingDirectory")}</span>
      <Text as="p">{props.hostName}</Text>
      <Text as="p">{state.settings?.effectivePath}</Text>
      <Button disabled={disabled()} onClick={() => void choose()}>
        {t("agentSettings.directory.choose")}
      </Button>
      <Button disabled={disabled() || !state.settings?.workingDirectory} onClick={() => void save(null)}>
        {t("agentSettings.directory.default")}
      </Button>
      <Show when={state.directory}>
        {(directory) => (
          <div class="agent-working-directory-browser">
            <Input
              aria-label={t("agentSettings.directory.path")}
              value={state.path}
              onInput={(event) =>
                setState((draft) => {
                  Object.assign(draft, { path: event.currentTarget.value });
                })
              }
            />
            <Button disabled={disabled()} onClick={() => void browse(state.path)}>
              {t("agentSettings.directory.open")}
            </Button>
            <Button
              disabled={disabled() || !directory().parentPath}
              onClick={() => void browse(directory().parentPath)}
            >
              {t("agentSettings.directory.parent")}
            </Button>
            <Button
              disabled={disabled()}
              aria-pressed={state.hidden ? "true" : "false"}
              onClick={() => {
                const hidden = !state.hidden;
                setState((draft) => {
                  Object.assign(draft, { hidden });
                });
                void browse(directory().path, 0, hidden);
              }}
            >
              {t("agentSettings.directory.hidden")}
            </Button>
            <For each={directory().roots}>
              {(root) => (
                <Button disabled={disabled()} onClick={() => void browse(root.path)}>
                  {root.name}
                </Button>
              )}
            </For>
            <For each={directory().entries}>
              {(entry) => (
                <Button disabled={disabled()} onClick={() => void browse(entry.path)}>
                  {entry.name}
                </Button>
              )}
            </For>
            <Show when={directory().nextOffset !== null}>
              <Button disabled={disabled()} onClick={() => void browse(directory().path, directory().nextOffset ?? 0)}>
                {t("agentSettings.directory.more")}
              </Button>
            </Show>
            <Text as="p">{directory().path}</Text>
            <Button disabled={disabled()} onClick={() => void save(directory().path)}>
              {t("agentSettings.directory.use")}
            </Button>
            <Button
              disabled={state.pending}
              onClick={() =>
                setState((draft) => {
                  Object.assign(draft, { directory: null });
                })
              }
            >
              {t("agentSettings.directory.cancel")}
            </Button>
          </div>
        )}
      </Show>
      <Show when={state.error}>
        <Text as="p" role="alert">
          {state.error}
        </Text>
      </Show>
    </div>
  );
}
