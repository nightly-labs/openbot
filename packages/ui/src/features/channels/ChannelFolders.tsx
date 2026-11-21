import {
  agentFolderName,
  CHANNEL_FOLDER_LIMIT,
  type ChannelFolderChange,
  type ChannelFolderList,
} from "@openbot/contracts/ipc";
import { Button, Plus, toast, UsersRound } from "@openbot/ui";
import { SettingsLinkGroup, SettingsLinkRow } from "@openbot/ui/components/SettingsPanel";
import { createStore, For, onSettled, Show } from "solid-js";
import { useText } from "../../text";
import { FolderRow } from "../conversation/AgentFolders";

export interface ChannelFolderCalls {
  list: (channelId: string) => Promise<ChannelFolderList>;
  choose: (channelId: string) => Promise<ChannelFolderChange>;
  add: (channelId: string, path: string) => Promise<ChannelFolderChange>;
  remove: (channelId: string, path: string) => Promise<ChannelFolderChange>;
}

export interface ChannelFolderSource {
  channelId: string;
  channelName: string;
  calls: ChannelFolderCalls;
}

export function createChannelFolders(source: () => ChannelFolderSource | undefined) {
  const { t, errorMessage } = useText();
  const [state, setState] = createStore<{ list: ChannelFolderList | null }>({ list: null });
  let request = 0;
  let shown: string | undefined;

  function setList(channelId: string, list: ChannelFolderList): void {
    if (shown !== channelId) return;
    setState((current) => {
      current.list = list;
    });
  }

  function failed(error: unknown): void {
    toast.error(errorMessage(error, t("agentSettings.folders.failed")));
  }

  async function run(change: () => Promise<ChannelFolderChange>, current: ChannelFolderSource): Promise<void> {
    try {
      report(await change(), current);
    } catch (error) {
      failed(error);
    }
  }

  function report(change: ChannelFolderChange, current: ChannelFolderSource): void {
    const { channelId, channelName: channel, calls } = current;
    setList(channelId, change.list);
    if (change.outcome === "cancelled") return;
    const folder = agentFolderName(change.path);
    switch (change.outcome) {
      case "added": {
        const { replaced } = change;
        const undo = async (): Promise<ChannelFolderChange> => {
          const removed = await calls.remove(channelId, change.path);
          let list = removed.list;
          for (const path of replaced) list = (await calls.add(channelId, path)).list;
          return { ...removed, list };
        };
        toast.success(t("channel.settings.folders.toastAdded", { channel, folder }), {
          action: { label: t("agentSettings.folders.undo"), onClick: () => void run(undo, current) },
        });
        return;
      }
      case "removed":
        toast(t("channel.settings.folders.toastRemoved", { channel, folder }), {
          action: {
            label: t("agentSettings.folders.undo"),
            onClick: () => void run(() => calls.add(channelId, change.path), current),
          },
        });
        return;
      case "covered":
        toast(
          change.folder === change.path
            ? t("agentSettings.folders.alreadyAdded", { folder })
            : t("agentSettings.folders.inFolder", { folder, parent: agentFolderName(change.folder) }),
        );
        return;
      case "refused":
        if (change.refusal === "limit") toast.error(t("agentSettings.folders.limit", { count: CHANNEL_FOLDER_LIMIT }));
        else if (change.refusal === "protected") toast.error(t("agentSettings.folders.protected", { folder }));
        else toast.error(t("agentSettings.folders.missing", { folder }));
        return;
    }
  }

  function act(change: (current: ChannelFolderSource) => Promise<ChannelFolderChange>): Promise<void> {
    const current = source();
    return current ? run(() => change(current), current) : Promise.resolve();
  }

  return {
    state,
    load(current: ChannelFolderSource | undefined): void {
      const id = ++request;
      if (shown !== current?.channelId) {
        shown = current?.channelId;
        setState((next) => {
          next.list = null;
        });
      }
      if (!current) return;
      current.calls
        .list(current.channelId)
        .then((list) => {
          if (id === request) setList(current.channelId, list);
        })
        .catch(failed);
    },
    choose: () => act(({ channelId, calls }) => calls.choose(channelId)),
    remove: (path: string) => act(({ channelId, calls }) => calls.remove(channelId, path)),
  };
}

export type ChannelFolders = ReturnType<typeof createChannelFolders>;

export function ChannelFoldersRow(props: { folders: ChannelFolders; onOpen: () => void }) {
  const { t } = useText();
  const folders = () => props.folders.state.list?.folders ?? [];
  const lost = () => folders().filter((folder) => !folder.found).length;
  const value = () => {
    if (lost() > 0) return t("agentSettings.folders.valueMissing", { count: lost() });
    return folders().length > 0
      ? t("agentSettings.folders.valueCount", { count: folders().length })
      : t("agentSettings.folders.valueNone");
  };
  return <SettingsLinkRow label={t("channel.settings.folders.title")} value={value()} onClick={props.onOpen} />;
}

export function ChannelFoldersPage(props: { folders: ChannelFolders; channelName: string }) {
  const { t } = useText();
  let opened = false;
  onSettled(() => {
    opened = true;
  });
  return (
    <div class="agent-folders-page">
      <SettingsLinkGroup inset>
        <div class="agent-folders-access">
          <span class="settings-link-icon">
            <UsersRound aria-hidden="true" />
          </span>
          <span class="agent-folders-access-text">
            {t("channel.settings.folders.description", { channel: props.channelName })}
          </span>
        </div>
      </SettingsLinkGroup>
      <Show when={props.folders.state.list}>
        {(list) => (
          <SettingsLinkGroup inset title={t("agentSettings.folders.added")}>
            <For each={list().folders} keyed={(folder) => folder.path}>
              {(folder) => {
                const fresh = opened;
                return (
                  <FolderRow
                    path={folder().path}
                    fresh={fresh}
                    missing={!folder().found}
                    onRemove={() => void props.folders.remove(folder().path)}
                  />
                );
              }}
            </For>
            <Button
              variant="ghost"
              type="button"
              class="settings-link agent-folders-add"
              onClick={() => void props.folders.choose()}
            >
              <span class="settings-link-label">
                <span class="settings-link-icon">
                  <Plus aria-hidden="true" />
                </span>
                {t("agentSettings.folders.add")}
              </span>
            </Button>
          </SettingsLinkGroup>
        )}
      </Show>
    </div>
  );
}
