import type { ChannelPage } from "@openbot/contracts/ipc";
import { Button, ErrorReference } from "@openbot/ui";
import { SettingsPanel, SettingsPanelContent, SettingsPanelHeader } from "@openbot/ui/components/SettingsPanel";
import { ChannelAvatar } from "@openbot/ui/features/channels/ChannelAvatar";
import { ChannelStoppedTasks } from "@openbot/ui/features/channels/ChannelStoppedTasks";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createStore, For, Show } from "solid-js";
import { createSidePanelWidth, readSidePanelWidth, saveSidePanelWidth } from "../../components/side-panel-width";
import { AgentMemoriesSettings } from "../conversation/AgentMemoriesSettings";
import { AgentRoutinesSettings } from "../conversation/AgentRoutinesSettings";
import type { ConversationChannelSettingsPaneProps } from "../conversation/conversation-types";
import { channelMemoriesPort } from "../conversation/memories-port";
import { desktopEventRoutinesApi } from "../conversation/routine-webhooks-api";
import { channelRoutinesPort, eventRoutinesPort } from "../conversation/routines-port";
import { ChannelEditor } from "./ChannelEditor";
import { stoppedChannelTasks } from "./channel-conversation-rows";
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
  });
  const channelName = createMemo(() => page()?.channel.name ?? "");
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
      <Show when={!panel.routines.open && !panel.memories.open}>
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
          />
        </SettingsPanelContent>
      </Show>
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
