import type { ChannelMessage, ChannelSummary } from "@openbot/contracts/ipc";
import { ArrowLeft } from "@openbot/ui";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { toAgentProfile } from "@openbot/ui/features/agents/agent-profile";
import { ChannelActivityIndicator, type ChannelWorker } from "@openbot/ui/features/channels/ChannelActivityIndicator";
import { ChannelAvatar } from "@openbot/ui/features/channels/ChannelAvatar";
import { AttachmentCards } from "@openbot/ui/features/conversation/AttachmentCards";
import { MarkdownMessageText } from "@openbot/ui/features/conversation/MarkdownMessageText";
import { safeBrowserUrl } from "@openbot/ui/features/conversation/RichMessageText";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, For, onSettled, Show } from "solid-js";
import { avatarAgent, bubbleColors, composerAgents } from "./agent-look";
import { ChatComposer } from "./ChatComposer";
import { stickToBottom } from "./stick-to-bottom";
import { isChatMessage, type OpenChannel, type Workspace } from "./workspace";

export function ChannelScreen(props: {
  workspace: Workspace;
  onBack: () => void;
  onOpenAgent: (agentId: string) => void;
}) {
  const open = () => props.workspace.state.channel;
  const summary = createMemo(() => props.workspace.state.channels.find((entry) => entry.id === open()?.channelId));
  return (
    <Show when={open()}>
      {(current) => (
        <Show when={summary()}>{(found) => <ChannelView {...props} open={current()} channel={found()} />}</Show>
      )}
    </Show>
  );
}

function ChannelView(props: {
  workspace: Workspace;
  open: OpenChannel;
  channel: ChannelSummary;
  onBack: () => void;
  onOpenAgent: (agentId: string) => void;
}) {
  const { t } = useText();
  let list: HTMLDivElement | undefined;
  const state = () => props.workspace.state;
  const agents = createMemo(() => composerAgents(state().agents, state().colors));
  const colors = createMemo(() => {
    const lead =
      state().agents.find((agent) => agent.id === props.channel.leadAgentId) ??
      state().agents.find((agent) => props.channel.members.some((member) => member.agentId === agent.id));
    return lead ? bubbleColors(lead, state().colors[lead.id]) : undefined;
  });
  const entries = createMemo(() =>
    props.open.messages.filter((entry) => !entry.superseded && isChatMessage(entry.message)),
  );
  const mine = (entry: ChannelMessage) => entry.author.kind === "member" && entry.author.id === state().memberId;
  const showsAuthor = (index: number) => {
    const entry = entries()[index];
    const before = entries()[index - 1];
    return Boolean(
      entry && !mine(entry) && (before?.author.id !== entry.author.id || before.author.kind !== entry.author.kind),
    );
  };
  const workers = createMemo((): ChannelWorker[] => {
    const owners = new Set(
      props.open.tasks.flatMap((task) => (task.state === "running" && task.ownerAgentId ? [task.ownerAgentId] : [])),
    );
    if (!owners.size && (props.open.sending || props.channel.activeTasks > 0) && props.channel.leadAgentId)
      owners.add(props.channel.leadAgentId);
    return [...owners].flatMap((id) => {
      const agent = state().agents.find((entry) => entry.id === id);
      return agent
        ? [{ id, name: agent.name, agent: toAgentProfile({ ...agent, avatarColor: state().colors[id] ?? null }) }]
        : [];
    });
  });
  function openLink(url: string) {
    const safe = safeBrowserUrl(url);
    if (safe) window.open(safe, "_blank", "noopener");
  }

  createEffect(
    () => [entries().length, entries().at(-1)?.message.text.length, workers().length] as const,
    () => {
      if (list) list.scrollTop = list.scrollHeight;
    },
  );
  onSettled(() => (list ? stickToBottom(list) : undefined));

  return (
    <div class="ch-chat" style={colors()}>
      <header class="ch-topbar">
        <button type="button" class="ch-back" aria-label={t("common.back")} onClick={() => props.onBack()}>
          <ArrowLeft size={16} aria-hidden="true" />
        </button>
        <div class="ch-title ch-channel-title">
          <ChannelAvatar
            members={props.channel.members}
            agents={agents()}
            icon={props.channel.icon ?? null}
            layout="cluster"
          />
          <span class="ch-title-name" dir="auto">
            {props.channel.name}
          </span>
          <span class="ch-title-sub">{t("extension.channel.members", { count: props.channel.members.length })}</span>
        </div>
      </header>
      <div class="ch-list" ref={list} aria-live="polite">
        <Show
          when={entries().length > 0 || props.open.status !== "ready"}
          fallback={
            <div class="ch-empty">
              <strong>{props.channel.name}</strong>
              <span>{t("extension.channel.empty")}</span>
            </div>
          }
        >
          <For each={entries()} keyed={(entry) => entry.id}>
            {(entry, index) => {
              const agent = () =>
                entry().author.kind === "agent"
                  ? state().agents.find((candidate) => candidate.id === entry().author.id)
                  : undefined;
              return (
                <>
                  <Show when={showsAuthor(index())}>
                    <button
                      type="button"
                      class="ch-author"
                      disabled={!agent()}
                      onClick={() => {
                        const found = agent();
                        if (found) props.onOpenAgent(found.id);
                      }}
                    >
                      <Show when={agent()}>
                        {(found) => (
                          <AgentAvatar
                            agent={avatarAgent(found(), state().colors[found().id])}
                            motion="idle"
                            class="ch-author-mark"
                          />
                        )}
                      </Show>
                      <span>{agent()?.name ?? entry().author.name}</span>
                    </button>
                  </Show>
                  <Show when={entry().message.attachments?.length ? entry().message.attachments : undefined}>
                    {(files) => (
                      <div class={mine(entry()) ? "ch-files ch-files-user" : "ch-files"}>
                        <AttachmentCards
                          attachments={files()}
                          mediaSource={props.workspace.media}
                          onPreview={(attachment) => {
                            const url = props.workspace.media.url(attachment.id);
                            if (url) window.open(url, "_blank", "noopener");
                            else void props.workspace.media.save(attachment).catch(() => undefined);
                          }}
                          onAction={(attachment) => void props.workspace.media.save(attachment).catch(() => undefined)}
                        />
                      </div>
                    )}
                  </Show>
                  <Show when={entry().message.text.trim()}>
                    <Show when={!mine(entry())} fallback={<div class="ch-bubble ch-user">{entry().message.text}</div>}>
                      <div class="ch-bubble ch-agent message-markdown">
                        <MarkdownMessageText
                          body={entry().message.text}
                          streaming={entry().message.status === "streaming"}
                          agents={agents()}
                          attachments={entry().message.attachments}
                          onSelectAgent={(agentId) => props.onOpenAgent(agentId)}
                          onOpenLink={openLink}
                        />
                      </div>
                    </Show>
                  </Show>
                </>
              );
            }}
          </For>
        </Show>
        <Show when={workers().length ? workers() : undefined}>
          {(list) => <ChannelActivityIndicator workers={list()} />}
        </Show>
      </div>
      <ChatComposer
        placeholder={t("extension.channel.ask", { name: props.channel.name })}
        error={props.open.error}
        conversationKey={`channel:${props.channel.id}`}
        onDismissError={() => props.workspace.clearChannelError()}
        sending={props.open.sending}
        transcribe={props.workspace.transcribe}
        images={{ accepts: true, upload: props.workspace.uploadImage, discard: props.workspace.discardImage }}
        onSend={(text, attachments) => props.workspace.sendToChannel(text, attachments)}
      />
    </div>
  );
}
