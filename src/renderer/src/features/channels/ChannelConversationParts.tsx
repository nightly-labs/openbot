import type { ChannelPage } from "@openbot/contracts/ipc";
import { Button, ErrorReference } from "@openbot/ui";
import { SettingsPanel, SettingsPanelContent, SettingsPanelHeader } from "@openbot/ui/components/SettingsPanel";
import { ChannelAvatar } from "@openbot/ui/features/channels/ChannelAvatar";
import {
  type ChannelFolderCalls,
  ChannelFoldersPage,
  createChannelFolders,
} from "@openbot/ui/features/channels/ChannelFolders";
import { ChannelStoppedTasks } from "@openbot/ui/features/channels/ChannelStoppedTasks";
import { type HostFolderPick, HostFolderPicker } from "@openbot/ui/features/conversation/HostFolderPicker";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, createStore, For, Show, untrack } from "solid-js";
import { createSidePanelWidth, readSidePanelWidth, saveSidePanelWidth } from "../../components/side-panel-width";
import { AgentMemoriesSettings } from "../conversation/AgentMemoriesSettings";
import { AgentRoutinesSettings } from "../conversation/AgentRoutinesSettings";
import type { ConversationChannelSettingsPaneProps } from "../conversation/conversation-types";
import { channelMemoriesPort } from "../conversation/memories-port";
import { desktopEventRoutinesApi } from "../conversation/routine-webhooks-api";
import { channelRoutinesPort, eventRoutinesPort } from "../conversation/routines-port";
import { ChannelEditor } from "./ChannelEditor";
import { stoppedChannelTasks } from "./channel-conversation-rows";
import { localChannelFolderCalls, remoteChannelFolderCalls } from "./channel-folders-port";
import { useChannels } from "./channels-context";

export interface ChannelRoutineHost {
  localHost: () => boolean;
  onceSchedule: () => boolean;
  eventsServerId: () => string | undefined;
  routineRecovery: () => boolean;
  webhookTests: () => boolean;
  webhookSenderSecret: () => boolean;
}

function useOpenChannel(channelId: string) {
  const channels = useChannels();
  return () => {
    const page = channels.state.page;
    return page?.channel.id === channelId ? page : null;
  };
}

export function ChannelErrorNotice() {
  const channels = useChannels();
  const { t, sourceText } = useText();
  return (
    <Show when={channels.state.error}>
      {(error) => (
        <p role="alert">
          {sourceText(error())}
          <ErrorReference reference={channels.state.errorReference} />
          <Button variant="ghost" onClick={() => void channels.retry()}>
            {t("common.retry")}
          </Button>
        </p>
      )}
    </Show>
  );
}

export function ChannelHeaderTitle(props: { channelId: string; onOpenSettings: () => void }) {
  const channels = useChannels();
  const { t } = useText();
  const page = useOpenChannel(props.channelId);
  return (
    <Show when={page()}>
      {(current) => (
        <Button
          variant="ghost"
          size="sm"
          class="conversation-title channel-title no-drag"
          aria-label={t("channel.settings.title")}
          onClick={props.onOpenSettings}
          disabled={current().channel.archived}
        >
          <ChannelAvatar
            members={current().channel.members}
            agents={channels.agents()}
            icon={current().channel.icon}
            imageUrl={current().channel.imageUrl}
          />
          <span class="channel-header-copy">
            <h1>{current().channel.name}</h1>
            <Show when={current().channel.title.trim()}>
              {(title) => <span class="channel-header-title">{title()}</span>}
            </Show>
          </span>
        </Button>
      )}
    </Show>
  );
}

export function ChannelEmptyState(props: { channelId: string }) {
  const channels = useChannels();
  const page = useOpenChannel(props.channelId);
  return (
    <Show when={page()}>
      {(current) => (
        <div class="channel-empty">
          <ChannelAvatar
            members={current().channel.members}
            agents={channels.agents()}
            icon={current().channel.icon}
            imageUrl={current().channel.imageUrl}
          />
          <h2>{current().channel.name}</h2>
          <Show when={current().channel.title}>
            <p class="channel-empty-title">{current().channel.title}</p>
          </Show>
          <Show when={current().channel.instructions}>
            <p>{current().channel.instructions}</p>
          </Show>
        </div>
      )}
    </Show>
  );
}

export function ChannelAboveComposer(props: { channelId: string }) {
  const channels = useChannels();
  const { t } = useText();
  const page = useOpenChannel(props.channelId);
  const name = (id: string | null) =>
    channels.agents().find((agent) => agent.id === id)?.name ?? t("sidebar.section.unassigned");
  const resumeTask = (taskId: string, recipientAgentId: string | null) =>
    channels.command({
      type: recipientAgentId ? "reassign" : "resume",
      operationId: crypto.randomUUID(),
      channelId: props.channelId,
      taskId,
      recipientAgentId,
    });
  const cancelTask = (taskId: string) =>
    channels.command({
      type: "cancel",
      operationId: crypto.randomUUID(),
      channelId: props.channelId,
      taskId,
      recipientAgentId: null,
    });
  const onCancel = () => (channels.taskCancelSupported() ? cancelTask : undefined);
  const waitNotes = (current: ChannelPage) => [
    ...new Set(
      (current.waits ?? []).flatMap((wait) => {
        const agent = channels.agents().find((item) => item.id === wait.agentId)?.name;
        if (!agent) return [];
        return wait.reason === "agent-busy"
          ? [t("queue.hold.named", { name: agent, channel: wait.channelName })]
          : [t("channel.conversation.waitFull", { name: agent })];
      }),
    ),
  ];
  return (
    <Show when={page()}>
      {(current) => (
        <>
          <For each={waitNotes(current())}>
            {(text) => (
              <p class="channel-wait-note" role="status">
                {text}
              </p>
            )}
          </For>
          <ChannelStoppedTasks
            tasks={stoppedChannelTasks(current())}
            members={current().channel.members}
            name={name}
            onResume={resumeTask}
            onCancel={onCancel()}
          />
          <Show when={!current().channel.archived && !current().channel.members.length}>
            <p>{t("channel.conversation.noMembers")}</p>
          </Show>
        </>
      )}
    </Show>
  );
}

export function ChannelSettingsPane(
  props: ConversationChannelSettingsPaneProps & { channelId: string; routines: ChannelRoutineHost },
) {
  const channels = useChannels();
  const { t } = useText();
  const runtime = () => channels.port();
  const [panelWidth, setPanelWidth] = createSidePanelWidth();
  createEffect(panelWidth, (width) => {
    props.onWidthChange(width);
  });
  const page = useOpenChannel(props.channelId);
  createEffect(
    () => page()?.channel.archived === true,
    (archived) => {
      if (archived) props.onClose();
    },
  );
  const [panel, setPanel] = createStore({
    memories: { open: false, count: 0 },
    routines: { open: false, count: 0 },
    folders: { open: false },
  });
  const channelName = createMemo(() => page()?.channel.name ?? "");
  const [folderPick, setFolderPick] = createSignal<(HostFolderPick & { done: (path: string | null) => void }) | null>(
    null,
  );
  const finishFolderPick = (path: string | null) => {
    const pick = folderPick();
    setFolderPick(null);
    pick?.done(path);
  };
  const folderCalls = createMemo((): ChannelFolderCalls | undefined => {
    const mode = channels.foldersMode();
    const api = runtime().agent;
    const { listChannelFolders, addChannelFolder, removeChannelFolder, browseChannelFolders, chooseChannelFolder } =
      api;
    if (!mode || !listChannelFolders || !addChannelFolder || !removeChannelFolder || !browseChannelFolders)
      return undefined;
    const folders = { listChannelFolders, addChannelFolder, removeChannelFolder, browseChannelFolders };
    if (mode === "local")
      return chooseChannelFolder ? localChannelFolderCalls({ ...folders, chooseChannelFolder }) : undefined;
    return remoteChannelFolderCalls(
      folders,
      () =>
        new Promise((done) => {
          folderPick()?.done(null);
          const name = channelName();
          setFolderPick({
            mode: "add",
            agentName: name,
            title: t("dialog.chooseChannelFolder", { channel: name }),
            start: null,
            done,
          });
        }),
    );
  });
  const browsePickFolders = (path: string | null) => {
    const browse = runtime().agent.browseChannelFolders;
    if (!browse) return Promise.reject(new Error(t("agentSettings.folders.browse.failed")));
    return browse({ channelId: props.channelId, path });
  };
  const channelFolders = createChannelFolders(() => {
    const calls = folderCalls();
    return calls ? { channelId: props.channelId, channelName: channelName(), calls } : undefined;
  });
  createEffect(
    () => {
      const calls = folderCalls();
      const opened = panel.folders.open;
      return calls && { source: { channelId: props.channelId, channelName: untrack(channelName), calls }, opened };
    },
    (current) => channelFolders.load(current ? current.source : undefined),
  );
  const memoriesPort = createMemo(() => channelMemoriesPort(props.channelId, channelName(), runtime().agent));
  const routinesPort = createMemo(() => {
    const legacy = channelRoutinesPort(
      props.channelId,
      runtime().agent,
      props.routines.localHost(),
      props.routines.onceSchedule(),
    );
    const serverId = props.routines.eventsServerId();
    const eventApi =
      runtime().eventRoutines ??
      (serverId
        ? desktopEventRoutinesApi(
            serverId,
            props.routines.routineRecovery(),
            props.routines.webhookTests(),
            props.routines.webhookSenderSecret(),
          )
        : undefined);
    return eventApi ? eventRoutinesPort({ kind: "channel", id: props.channelId }, eventApi, legacy) : legacy;
  });
  createEffect(memoriesPort, (port) => {
    const load = () => {
      void port.list().then((entries) => {
        setPanel((state) => {
          state.memories.count = entries.length;
        });
      });
    };
    load();
    return port.subscribe(load);
  });
  createEffect(routinesPort, (port) => {
    const load = () => {
      void port.list().then((entries) => {
        setPanel((state) => {
          state.routines.count = entries.length;
        });
      });
    };
    load();
    return port.subscribe(load);
  });
  return (
    <SettingsPanel
      onResizeEnd={saveSidePanelWidth}
      preferredWidth={readSidePanelWidth}
      id="channel-side-panel"
      label={t("channel.panel.label")}
      width={panelWidth()}
      maxWidth={props.maxWidth}
      onResize={setPanelWidth}
    >
      <Show when={!panel.routines.open && !panel.memories.open && !panel.folders.open}>
        <SettingsPanelHeader
          title={t("channel.settings.title")}
          onClose={props.onClose}
          closeLabel={t("channel.panel.close")}
        />
        <SettingsPanelContent>
          <ChannelEditor
            memoryCount={panel.memories.count}
            routineCount={panel.routines.count}
            onOpenMemories={() =>
              setPanel((state) => {
                state.memories.open = true;
              })
            }
            onOpenRoutines={() =>
              setPanel((state) => {
                state.routines.open = true;
              })
            }
            folders={folderCalls() ? channelFolders : undefined}
            onOpenFolders={() =>
              setPanel((state) => {
                state.folders.open = true;
              })
            }
          />
        </SettingsPanelContent>
      </Show>
      <Show when={panel.folders.open && folderCalls()}>
        <SettingsPanelHeader
          title={t("channel.settings.folders.title")}
          onBack={() =>
            setPanel((state) => {
              state.folders.open = false;
            })
          }
          onClose={props.onClose}
          closeLabel={t("channel.panel.close")}
        />
        <SettingsPanelContent>
          <ChannelFoldersPage folders={channelFolders} channelName={channelName()} />
        </SettingsPanelContent>
      </Show>
      <HostFolderPicker request={folderPick()} browse={browsePickFolders} onDone={finishFolderPick} />
      <AgentMemoriesSettings
        port={memoriesPort()}
        open={panel.memories.open}
        onBack={() =>
          setPanel((state) => {
            state.memories.open = false;
          })
        }
        onClose={props.onClose}
        onCountChange={(count) =>
          setPanel((state) => {
            state.memories.count = count;
          })
        }
      />
      <Show when={panel.routines.open}>
        <AgentRoutinesSettings
          port={routinesPort()}
          onCountChange={(count) =>
            setPanel((state) => {
              state.routines.count = count;
            })
          }
          onBack={() =>
            setPanel((state) => {
              state.routines.open = false;
            })
          }
          onClose={props.onClose}
        />
      </Show>
    </SettingsPanel>
  );
}
