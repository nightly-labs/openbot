import { expandAttachmentReferences } from "@openbot/contracts/attachment-references";
import { chatTagReferences, expandChatTagReferences } from "@openbot/contracts/chat-tag-references";
import type { DraftAttachment } from "@openbot/contracts/ipc";
import { createEffect, createMemo, createSignal, createStore, For, onCleanup, Show, untrack } from "solid-js";
import { QuestionPromptBubble } from "../../components/QuestionPromptBubble";
import {
  createSettingsPanelWidth,
  SettingsPanel,
  SettingsPanelContent,
  SettingsPanelHeader,
  settingsPanelMaxWidth,
} from "../../components/SettingsPanel";
import { ArrowUp, Button, buttonVariants, DropdownMenu, Plus, X } from "../../components/ui";
import type { AgentMessage } from "../../data";
import { useNavigation } from "../../navigation";
import { useTurns } from "../../turns";
import { useAuth } from "../account/account-context";
import { useAgents } from "../agents/agents-context";
import { useBrowserTabs } from "../browser/browser-context";
import { AgentMemoriesModal } from "../conversation/AgentMemoriesModal";
import { AgentRoutinesSettings } from "../conversation/AgentRoutinesSettings";
import { ChatMessageRow } from "../conversation/ChatMessageRow";
import { ComposerEditor, expandComposerMentions } from "../conversation/ComposerEditor";
import { ApprovalCard, BrowserTakeoverCard } from "../conversation/ConversationPrompts";
import { calculateChatScrollMargin, createChatVirtualizer } from "../conversation/createChatVirtualizer";
import { ScrollToLatestButton, scrollToLatestMessage } from "../conversation/MessageNavigation";
import { MessageActions } from "../conversation/MessageRendering";
import { channelMemoriesPort } from "../conversation/memories-port";
import {
  anchorNewMessages,
  countableTimelineMessage,
  type NewMessageTally,
  tallyNewMessages,
} from "../conversation/new-message-tally";
import { channelRoutinesPort } from "../conversation/routines-port";
import {
  scrollToUnreadBoundary,
  UnreadMessagesBanner,
  UnreadMessagesDivider,
  unreadMessagesDividerIsVisible,
} from "../conversation/UnreadMessages";
import { useServers } from "../servers/servers-context";
import { usePresence } from "../team/team-context";
import { ChannelActivityIndicator, type ChannelWorker } from "./ChannelActivityIndicator";
import { ChannelAvatar } from "./ChannelAvatar";
import { ChannelEditor } from "./ChannelEditor";
import { channelTimelineEntries, firstUnreadChannelMessageId, isOwnChannelAuthor } from "./channel-timeline";
import { useChannels } from "./channels-context";

export function ChannelConversation() {
  const channels = useChannels();
  const { selectAgent } = useNavigation();
  const { centralAuth } = useAuth();
  const { currentTeamMember } = usePresence();
  const { activeServer } = useServers();
  const isOwnMessage = (authorId: string) => {
    const auth = centralAuth();
    return isOwnChannelAuthor(authorId, {
      memberId: currentTeamMember()?.id ?? null,
      accountUserId: auth.status === "signed_in" ? auth.user.id : null,
      onOwnComputer: activeServer()?.kind === "local",
    });
  };
  /**
   * Memories and routines live here rather than in `ChannelEditor`, because the routines view
   * covers the whole panel - its own header replaces the panel header, the way the agent settings
   * panel does it.
   */
  const [panel, setPanel] = createStore<{
    memories: { open: boolean; count: number };
    routines: { open: boolean; count: number };
  }>({ memories: { open: false, count: 0 }, routines: { open: false, count: 0 } });
  const resetPanel = () => {
    setPanel((state) => {
      state.memories.open = false;
      state.routines.open = false;
    });
  };
  const openSettings = () => {
    resetPanel();
    channels.edit();
  };
  const closePanel = () => {
    channels.closeEditor();
    resetPanel();
  };
  const channelId = createMemo(() => channels.state.page?.channel.id ?? null);
  const channelName = createMemo(() => channels.state.page?.channel.name ?? "");
  // Memoised on the id and the name alone: a port rebuilt on every revision would drop and remake
  // its event subscription each time a message arrives.
  const memoriesPort = createMemo(() => {
    const id = channelId();
    return id ? channelMemoriesPort(id, channelName()) : null;
  });
  const routinesPort = createMemo(() => {
    const id = channelId();
    return id ? channelRoutinesPort(id) : null;
  });
  // The settings row reads both counts before either view opens, so it cannot take them from the
  // view that renders the list. It loads them here and follows the events those views follow.
  createEffect(
    () => memoriesPort(),
    (port) => {
      if (!port) return;
      const load = () => {
        void port.list().then((entries) => {
          setPanel((state) => {
            state.memories.count = entries.length;
          });
        });
      };
      load();
      onCleanup(port.subscribe(load));
    },
  );
  createEffect(
    () => routinesPort(),
    (port) => {
      if (!port) return;
      const load = () => {
        void port.list().then((entries) => {
          setPanel((state) => {
            state.routines.count = entries.length;
          });
        });
      };
      load();
      onCleanup(port.subscribe(load));
    },
  );
  const { pendingApprovals, pendingPrompts } = useTurns();
  const { browserTabs } = useBrowserTabs();
  const { agentList } = useAgents();
  const [composer, setComposer] = createStore<{
    text: string;
    reply: string | null;
    attachments: DraftAttachment[];
  }>({ text: "", reply: null, attachments: [] });
  createEffect(
    () => channels.state.selectedId,
    () => {
      resetPanel();
      setPanel((state) => {
        state.memories.count = 0;
        state.routines.count = 0;
      });
      setComposer((state) => {
        Object.assign(state, { text: "", reply: null, attachments: [] });
      });
    },
  );
  const clearSent = (text: string) => {
    if (composer.text !== text) return;
    setComposer((state) => {
      Object.assign(state, { text: "", reply: null, attachments: [] });
    });
  };
  let messageList: HTMLElement | undefined;
  let virtualRoot: HTMLElement | undefined;
  let unreadMessagesDivider: HTMLElement | undefined;
  /* The panel is the same slot the agent chat opens, so it reads and writes the same width. The
     variable has to sit on this element, because the rules that give the chat back the width the
     panel covers are written against the conversation panel, not against the panel itself. */
  let conversationPanel: HTMLElement | undefined;
  const [panelWidth, setPanelWidth] = createSettingsPanelWidth();
  const [showScrollToLatest, setShowScrollToLatest] = createSignal(false);
  const [unreadDividerVisible, setUnreadDividerVisible] = createSignal(false);
  const [virtualScrollMargin, setVirtualScrollMargin] = createSignal(0);
  const [openMoreMessageId, setOpenMoreMessageId] = createSignal<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = createSignal<string | null>(null);
  const [newMessageCount, setNewMessageCount] = createSignal(0);
  let stickToLatest = true;
  let newMessages: NewMessageTally = { count: 0, anchorId: undefined };
  let scrollFrame: number | undefined;
  let unreadVisibilityFrame: number | undefined;
  let scrolledChannel: string | undefined;
  const timeline = createMemo(() => {
    const page = channels.state.page;
    return page ? channelTimelineEntries(page, agentList(), isOwnMessage) : [];
  });
  const unreadCount = createMemo(
    () => channels.state.channels.find((channel) => channel.id === channels.state.selectedId)?.unreadCount ?? 0,
  );
  const firstUnreadId = createMemo(() => firstUnreadChannelMessageId(timeline(), unreadCount()));
  /* Every row anchors the count, but only another author's message adds to it. */
  const timelineRows = createMemo(() =>
    timeline().map((entry) => ({ id: entry.id, countable: countableTimelineMessage(entry.message) })),
  );
  const clearNewMessages = () => {
    newMessages = anchorNewMessages(untrack(timelineRows));
    setNewMessageCount(0);
  };
  /**
   * Everyone the channel waits on: the owner of a running task, the author of a message that is
   * still arriving, and the lead while it chooses an owner. They read as one row under the
   * transcript, because a channel runs several agents at once and a row for each would push the
   * messages off the screen.
   *
   * The lead is the coordinator, and its routing turn moves no task out of `queued` and writes no
   * message of its own. Without it the transcript stands still for as long as the coordinator
   * thinks, which reads as a channel that dropped the request. A lead that also owns running work
   * lands in the same set once, so it keeps one face.
   */
  const workers = createMemo<ChannelWorker[]>(() => {
    const page = channels.state.page;
    if (!page) return [];
    const ids = new Set<string>();
    for (const task of page.tasks) if (task.state === "running" && task.ownerAgentId) ids.add(task.ownerAgentId);
    for (const entry of page.messages)
      if (entry.message.status === "streaming" && entry.author.kind !== "member") ids.add(entry.author.id);
    const lead = page.channel.leadAgentId;
    // Only `queued` and `waiting`: routing that ends without an owner leaves the task `paused` with
    // the coordinator's reason under the transcript, and that notice is the indicator from then on.
    if (lead && page.tasks.some((task) => !task.ownerAgentId && (task.state === "queued" || task.state === "waiting")))
      ids.add(lead);
    return [...ids].map((id) => {
      const agent = agentList().find((candidate) => candidate.id === id);
      const authored = page.messages.find((entry) => entry.author.id === id);
      return { id, name: agent?.name ?? authored?.author.name ?? "Agent", agent };
    });
  });
  const messageVirtualizer = createChatVirtualizer<HTMLElement, HTMLElement>({
    count: () => timeline().length,
    getScrollElement: () => messageList ?? null,
    // A channel row is taller than an agent row: most rows carry a face and a name above the bubble.
    estimateSize: () => 84,
    getItemKey: (index) => timeline()[index]?.id ?? index,
    keyVersion: () => `${timeline()[0]?.id ?? ""}:${timeline().at(-1)?.id ?? ""}`,
    scrollMargin: virtualScrollMargin,
  });
  const virtualMessageRows = createMemo(() => messageVirtualizer.getVirtualItems());
  /*
   * A message animates in once, and only after the channel has drawn its first page: everything
   * that was already there when the reader opened the channel arrives at the same moment, and ten
   * bubbles sliding in together reads as a fault.
   */
  const seenMessages = new Map<string, Set<string>>();
  const markMessageSeen = (channelId: string, messageId: string): boolean => {
    const known = seenMessages.get(channelId);
    if (!known) {
      seenMessages.set(channelId, new Set(untrack(timeline).map((entry) => entry.id)));
      return false;
    }
    if (known.has(messageId)) return false;
    known.add(messageId);
    return true;
  };
  const updateScrollState = (element: HTMLElement) => {
    const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
    setShowScrollToLatest(remaining > 80);
    if (remaining <= 80) clearNewMessages();
  };
  const updateVirtualScrollMargin = () => {
    setVirtualScrollMargin(calculateChatScrollMargin(messageList, virtualRoot));
  };
  const updateUnreadDividerVisibility = () => {
    setUnreadDividerVisible(
      Boolean(
        unreadCount() > 0 &&
          messageList &&
          unreadMessagesDivider &&
          unreadMessagesDividerIsVisible(messageList, unreadMessagesDivider),
      ),
    );
  };
  const scheduleUnreadDividerVisibilityUpdate = () => {
    if (unreadVisibilityFrame !== undefined) cancelAnimationFrame(unreadVisibilityFrame);
    unreadVisibilityFrame = requestAnimationFrame(() => {
      unreadVisibilityFrame = undefined;
      updateUnreadDividerVisibility();
    });
  };
  /** The channel is read as far as its newest message: that is what the page counts through. */
  const markChannelRead = async () => {
    const page = channels.state.page;
    if (!page) return;
    await channels.command({
      type: "read",
      channelId: page.channel.id,
      throughSequence: page.throughSequence,
      operationId: crypto.randomUUID(),
    });
  };
  const jumpToUnreadMessages = () => {
    if (!messageList || !unreadMessagesDivider) return;
    const boundary =
      unreadMessagesDivider.nextElementSibling instanceof HTMLElement
        ? unreadMessagesDivider.nextElementSibling
        : unreadMessagesDivider;
    scrollToUnreadBoundary(messageList, boundary);
  };
  const jumpToLatestMessage = () => {
    if (!messageList) return;
    stickToLatest = true;
    clearNewMessages();
    scrollToLatestMessage(messageList);
  };
  /**
   * The clipboard gets the message the reader sees, not its stored form: a mention is a name and an
   * attachment is a file name. A channel has no skills of its own, so only the agent names expand.
   */
  const copyChannelMessage = async (message: AgentMessage) => {
    const attachmentNames = new Map((message.attachments ?? []).map((attachment) => [attachment.id, attachment.name]));
    const agentNames = new Map(agentList().map((agent) => [agent.id, agent.name]));
    const text = expandAttachmentReferences(
      expandChatTagReferences(message.body, (reference) =>
        reference.kind === "agent" ? agentNames.get(reference.id) : undefined,
      ),
      (reference) => attachmentNames.get(reference.attachmentId),
    );
    if (!text) return;
    setOpenMoreMessageId(null);
    await navigator.clipboard.writeText(text);
    setCopiedMessageId(message.id);
    window.setTimeout(() => {
      if (copiedMessageId() === message.id) setCopiedMessageId(null);
    }, 1_400);
  };
  createEffect(
    () => {
      const rows = timelineRows();
      return {
        id: channels.state.page?.channel.id,
        revision: channels.state.page?.channel.revision,
        length: rows.length,
        latestId: rows.at(-1)?.id,
      };
    },
    ({ id }) => {
      const rows = untrack(timelineRows);
      if (id !== scrolledChannel) {
        scrolledChannel = id;
        stickToLatest = true;
        newMessages = anchorNewMessages(rows);
        setNewMessageCount(0);
      } else {
        // The sticky flag has to be read here: the frame below has already moved the view.
        newMessages = tallyNewMessages(newMessages, rows, stickToLatest);
        setNewMessageCount(newMessages.count);
      }
      if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame);
      scrollFrame = requestAnimationFrame(() => {
        if (!messageList) return;
        updateVirtualScrollMargin();
        if (stickToLatest) messageList.scrollTop = messageList.scrollHeight;
        updateScrollState(messageList);
        updateUnreadDividerVisibility();
      });
    },
  );
  onCleanup(() => {
    if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame);
    if (unreadVisibilityFrame !== undefined) cancelAnimationFrame(unreadVisibilityFrame);
  });
  const messageElements = new Map<string, HTMLElement>();
  const name = (id: string | null) => agentList().find((agent) => agent.id === id)?.name ?? "Unassigned";
  /**
   * The work that waits for the reader: one entry for each stopped run, not for each stopped task.
   *
   * A task the service stopped carries the reason it stopped, and an archived channel stops every
   * task without one, so the reason is what tells the two apart. A failed task belongs here too: it
   * carries its own reason, its parent waits for it, and nothing but the reader starts it again.
   * The assignment limit stops a whole tree at once, and `resume` starts a task with everything
   * under it, so the entry has to be the root: a reader who continues a child would leave the root
   * stopped, and a card for each task would repeat one reason several times.
   */
  const pausedTasks = createMemo(() => {
    const page = channels.state.page;
    if (!page || page.channel.archived) return [];
    const stopped = page.tasks.filter((task) => (task.state === "paused" || task.state === "failed") && task.error);
    const roots = new Map<string, (typeof stopped)[number]>();
    for (const task of stopped) {
      const known = roots.get(task.rootTaskId);
      if (!known || task.id === task.rootTaskId) roots.set(task.rootTaskId, task);
    }
    return [...roots.values()];
  });
  const resumeTask = (taskId: string, recipientAgentId: string | null) =>
    channels.command({
      type: recipientAgentId ? "reassign" : "resume",
      operationId: crypto.randomUUID(),
      channelId: channels.state.page?.channel.id ?? "",
      taskId,
      recipientAgentId,
    });
  const submit = () => {
    const text = composer.text;
    if (channels.state.pending || (!text.trim() && !composer.attachments.length) || !channels.state.selectedId) return;
    const expanded = expandComposerMentions(text);
    // A request that opens with a member is addressed to that member, the way a reader writes it.
    // A mention later in the text is what it reads as: a reference the owner of the work can see.
    const mention = chatTagReferences(expanded).find(
      (reference) => reference.kind === "agent" && !expanded.slice(0, reference.start).trim(),
    );
    void channels
      .command({
        type: "send",
        operationId: crypto.randomUUID(),
        channelId: channels.state.selectedId,
        text: expanded,
        recipientAgentId: mention?.id ?? null,
        replyToMessageId: composer.reply,
        attachmentDraftIds: composer.attachments.map((attachment) => attachment.id),
      })
      .then((sent) => {
        if (sent) clearSent(text);
      });
  };
  return (
    <main
      ref={(element) => (conversationPanel = element)}
      class="conversation-panel"
      aria-label="Channel conversation"
      style={`--settings-panel-width: ${panelWidth()}px`}
    >
      <Show when={channels.state.error}>
        <p role="alert">
          {channels.state.error}
          <Button
            variant="ghost"
            onClick={() =>
              void channels.retry().then((sent) => {
                if (sent?.type === "send") clearSent(sent.text);
              })
            }
          >
            Retry
          </Button>
        </p>
      </Show>

      <Show when={channels.state.page} fallback={<p>Loading channel…</p>}>
        {(page) => (
          <>
            <header class="window-drag conversation-header">
              <div class="conversation-heading-group">
                <Button
                  variant="ghost"
                  size="sm"
                  class="conversation-title channel-title no-drag"
                  aria-label="Channel settings"
                  onClick={openSettings}
                >
                  <ChannelAvatar members={page().channel.members} agents={agentList()} />
                  <h1>{page().channel.name}</h1>
                </Button>
              </div>
            </header>
            <section
              class="conversation-scroll"
              aria-label="Shared messages"
              aria-live="polite"
              ref={(element) => {
                messageList = element;
                updateVirtualScrollMargin();
              }}
              onScroll={(event) => {
                const element = event.currentTarget;
                stickToLatest = element.scrollHeight - element.scrollTop - element.clientHeight <= 80;
                updateScrollState(element);
                updateUnreadDividerVisibility();
              }}
            >
              <Show when={unreadCount() > 0 && !unreadDividerVisible()}>
                <UnreadMessagesBanner
                  count={unreadCount()}
                  busy={channels.state.pending}
                  onJumpToUnread={jumpToUnreadMessages}
                  onMarkRead={() => void markChannelRead()}
                />
              </Show>
              <Show when={showScrollToLatest()}>
                <ScrollToLatestButton
                  onClick={jumpToLatestMessage}
                  newMessageCount={newMessageCount()}
                  onDismiss={clearNewMessages}
                />
              </Show>
              <Show when={page().olderCursor}>
                <Button variant="ghost" onClick={() => void channels.loadOlder()}>
                  Load earlier messages
                </Button>
              </Show>
              <Show when={!page().messages.length}>
                <div class="channel-empty">
                  <ChannelAvatar members={page().channel.members} agents={agentList()} />
                  <h2>{page().channel.name}</h2>
                  <Show when={page().channel.title}>
                    <p class="channel-empty-title">{page().channel.title}</p>
                  </Show>
                  <Show when={page().channel.instructions}>
                    <p>{page().channel.instructions}</p>
                  </Show>
                </div>
              </Show>
              <div
                ref={(element) => {
                  virtualRoot = element;
                  updateVirtualScrollMargin();
                }}
                class={["virtual-chat-list", { "virtual-chat-list-static": !messageVirtualizer.isVirtualized() }]}
                style={{
                  height: messageVirtualizer.isVirtualized() ? `${messageVirtualizer.getTotalSize()}px` : "auto",
                }}
              >
                <For each={virtualMessageRows()}>
                  {(virtualRow) => {
                    const entry = createMemo(() => timeline()[virtualRow.index]);
                    const initialEntry = untrack(entry);
                    if (!initialEntry) return null;
                    const animate = markMessageSeen(page().channel.id, initialEntry.id);
                    const referenced = createMemo(() =>
                      timeline().find((candidate) => candidate.id === entry()?.message.replyToMessageId),
                    );
                    return (
                      <div
                        data-index={virtualRow.index}
                        data-grouped={entry()?.showAuthor === false ? "sender" : undefined}
                        ref={(element) => {
                          messageElements.set(initialEntry.id, element);
                          messageVirtualizer.measureElement(element);
                        }}
                        class="virtual-chat-row"
                        style={{
                          transform: messageVirtualizer.isVirtualized()
                            ? `translateY(${virtualRow.start - messageVirtualizer.scrollMargin()}px)`
                            : "none",
                        }}
                      >
                        <Show when={entry()?.dayMarker}>
                          {(label) => (
                            <div class="time-marker">
                              <span>{label()}</span>
                            </div>
                          )}
                        </Show>
                        <Show when={entry()?.id === firstUnreadId()}>
                          <UnreadMessagesDivider
                            elementRef={(element) => {
                              unreadMessagesDivider = element;
                              scheduleUnreadDividerVisibilityUpdate();
                            }}
                          />
                        </Show>
                        <ChatMessageRow
                          message={entry()?.message ?? initialEntry.message}
                          author={entry()?.author ?? initialEntry.author}
                          showAuthor={entry()?.showAuthor ?? initialEntry.showAuthor}
                          showTime
                          animate={animate}
                          agents={agentList()}
                          referencedMessage={referenced()?.message}
                          referencedAuthorName={referenced()?.author.name}
                          onSelectAgent={(id) => {
                            channels.close();
                            selectAgent(id);
                          }}
                          onOpenLink={(url) => {
                            void window.openbot.openUrl(url);
                          }}
                          onPreview={(attachment) => {
                            void channels.perform(() =>
                              window.openbot.agent.openAttachment({ attachmentId: attachment.id, action: "open" }),
                            );
                          }}
                          onAttachmentAction={(attachment, action) => {
                            void channels.perform(() =>
                              window.openbot.agent.openAttachment({ attachmentId: attachment.id, action }),
                            );
                          }}
                          actions={
                            <MessageActions
                              message={entry()?.message ?? initialEntry.message}
                              authorName={entry()?.author.name ?? initialEntry.author.name}
                              reactions={false}
                              pickerOpen={false}
                              moreOpen={openMoreMessageId() === initialEntry.id}
                              expandedEmoji={false}
                              copied={copiedMessageId() === initialEntry.id}
                              onTogglePicker={() => {}}
                              onToggleMore={() =>
                                setOpenMoreMessageId((current) =>
                                  current === initialEntry.id ? null : initialEntry.id,
                                )
                              }
                              onExpandEmoji={() => {}}
                              onReact={() => {}}
                              onReply={() =>
                                setComposer((state) => {
                                  state.reply = initialEntry.id;
                                })
                              }
                              onCopy={() => void copyChannelMessage(entry()?.message ?? initialEntry.message)}
                            />
                          }
                        >
                          <Show when={entry()?.message.questionPrompt}>
                            {(prompt) => (
                              <QuestionPromptBubble
                                questions={prompt().questions}
                                resolution={prompt().resolution}
                                onSubmit={(answers) =>
                                  channels.perform(() =>
                                    window.openbot.agent.respondToPrompt({
                                      requestId: prompt().requestId,
                                      answers,
                                    }),
                                  )
                                }
                              />
                            )}
                          </Show>
                        </ChatMessageRow>
                      </div>
                    );
                  }}
                </For>
              </div>
              <div class="agent-activity-slot" data-reserved={workers().length > 0 ? "true" : "false"}>
                <Show when={workers().length > 0}>
                  <ChannelActivityIndicator workers={workers()} />
                </Show>
              </div>
              <For each={page().channel.members}>
                {(member) => (
                  <Show
                    when={
                      page().tasks.some((task) => task.ownerAgentId === member.agentId && task.state === "running") &&
                      pendingApprovals()[member.agentId]
                    }
                  >
                    {(approval) => (
                      <ApprovalCard
                        approval={approval()}
                        onApprove={() =>
                          channels.perform(() =>
                            window.openbot.agent.respondToApproval({
                              requestId: approval().requestId,
                              decision: "accept",
                            }),
                          )
                        }
                        onReject={() =>
                          channels.perform(() =>
                            window.openbot.agent.respondToApproval({
                              requestId: approval().requestId,
                              decision: "decline",
                            }),
                          )
                        }
                      />
                    )}
                  </Show>
                )}
              </For>
              <For each={page().channel.members}>
                {(member) => {
                  const takeover = () => {
                    const event = pendingPrompts()[member.agentId];
                    return event?.type === "browser-takeover-requested" &&
                      page().tasks.some((task) => task.ownerAgentId === member.agentId && task.state === "running")
                      ? event.request
                      : undefined;
                  };
                  return (
                    <Show when={takeover()}>
                      {(request) => (
                        <BrowserTakeoverCard
                          agentName={name(member.agentId)}
                          tab={browserTabs().find((tab) => tab.id === request().tabId)}
                          preview={null}
                          previewStatus="idle"
                          onComplete={() =>
                            channels.perform(() =>
                              window.openbot.agent.respondToBrowserTakeover({
                                requestId: request().requestId,
                                decision: "complete",
                              }),
                            )
                          }
                          onCancel={() =>
                            channels.perform(() =>
                              window.openbot.agent.respondToBrowserTakeover({
                                requestId: request().requestId,
                                decision: "cancel",
                              }),
                            )
                          }
                        />
                      )}
                    </Show>
                  );
                }}
              </For>
              {/*
               * A task the service stopped and left a reason on. The automatic assignment limit is
               * the case that needs both actions: the run halts mid-way, and the reason it writes
               * asks the reader to continue it or to give it to somebody else. Without the two
               * controls the task stays stopped, because no other screen reaches it.
               */}
              <For each={pausedTasks()}>
                {(task) => (
                  <section class="channel-paused-task" aria-label={`Stopped task for ${name(task.ownerAgentId)}`}>
                    <p class="channel-paused-task-reason">{task.error}</p>
                    <div class="channel-paused-task-actions">
                      <Button size="xs" onClick={() => void resumeTask(task.id, null)}>
                        Continue
                      </Button>
                      <DropdownMenu.Root placement="top-start">
                        <DropdownMenu.Trigger
                          class={buttonVariants({ variant: "ghost", size: "xs" })}
                          aria-label={`Reassign the stopped task of ${name(task.ownerAgentId)}`}
                        >
                          Reassign
                        </DropdownMenu.Trigger>
                        <DropdownMenu.Portal>
                          <DropdownMenu.Content>
                            <For each={page().channel.members.filter((member) => member.agentId !== task.ownerAgentId)}>
                              {(member) => (
                                <DropdownMenu.Item onSelect={() => void resumeTask(task.id, member.agentId)}>
                                  {name(member.agentId)}
                                </DropdownMenu.Item>
                              )}
                            </For>
                          </DropdownMenu.Content>
                        </DropdownMenu.Portal>
                      </DropdownMenu.Root>
                    </div>
                  </section>
                )}
              </For>
              <Show when={!page().channel.members.length}>
                <p>Add agents in channel settings to start work.</p>
              </Show>
            </section>
            <Show when={!page().channel.archived}>
              <div class="composer-wrap">
                <form
                  class="composer"
                  data-compact={
                    !composer.reply &&
                    !composer.attachments.length &&
                    !composer.text.includes("\n") &&
                    composer.text.length < 120
                      ? "true"
                      : undefined
                  }
                  onSubmit={(event) => {
                    event.preventDefault();
                    submit();
                  }}
                >
                  <Show when={composer.reply}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() =>
                        setComposer((state) => {
                          state.reply = null;
                        })
                      }
                    >
                      Cancel reply
                    </Button>
                  </Show>
                  <Show when={composer.attachments.length}>
                    <div class="composer-attachments">
                      <For each={composer.attachments}>
                        {(attachment) => (
                          <div class="composer-attachment" data-kind="file">
                            <span class="composer-attachment-copy">
                              <strong>{attachment.name}</strong>
                            </span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              aria-label={`Remove ${attachment.name}`}
                              onClick={() =>
                                setComposer((state) => {
                                  state.attachments = state.attachments.filter((item) => item.id !== attachment.id);
                                })
                              }
                            >
                              <X aria-hidden="true" />
                            </Button>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                  <div class="composer-input-label">
                    <ComposerEditor
                      agentId={undefined}
                      agents={agentList().filter((agent) =>
                        page().channel.members.some((member) => member.agentId === agent.id),
                      )}
                      attachments={composer.attachments}
                      ariaLabel="Message to channel"
                      placeholder={`Message ${page().channel.name}`}
                      value={composer.text}
                      disabled={channels.state.pending}
                      onSubmit={submit}
                      onValueChange={(text) =>
                        setComposer((state) => {
                          state.text = text;
                        })
                      }
                    />
                  </div>
                  <div class="composer-toolbar">
                    <Button
                      type="button"
                      variant="ghost"
                      class="composer-button"
                      aria-label="Attach files"
                      onClick={() =>
                        void channels.perform(async () => {
                          const selectedId = channels.state.selectedId;
                          const attachments = await window.openbot.agent.chooseAttachments({ filter: "all" });
                          if (selectedId === channels.state.selectedId)
                            setComposer((state) => {
                              state.attachments = [...state.attachments, ...attachments];
                            });
                        })
                      }
                    >
                      <Plus aria-hidden="true" />
                    </Button>
                    <div class="composer-primary-actions">
                      <Button
                        type="submit"
                        variant="ghost"
                        class="voice-button"
                        aria-label="Send message"
                        disabled={channels.state.pending || (!composer.text.trim() && !composer.attachments.length)}
                      >
                        <ArrowUp aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                </form>
              </div>
            </Show>
            <Show when={channels.state.editing === "settings"}>
              <SettingsPanel
                id="channel-side-panel"
                label="Channel panel"
                width={panelWidth()}
                maxWidth={() => settingsPanelMaxWidth(conversationPanel)}
                onResize={setPanelWidth}
              >
                {/* Routines bring their own header with a back arrow, so they replace the panel
                    header rather than sit under it - the same trade the agent panel makes. */}
                <Show
                  when={panel.routines.open && routinesPort()}
                  fallback={
                    <>
                      <SettingsPanelHeader
                        title="Channel settings"
                        onClose={closePanel}
                        closeLabel="Close channel panel"
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
                      <Show when={memoriesPort()}>
                        {(port) => (
                          <AgentMemoriesModal
                            port={port()}
                            open={panel.memories.open}
                            onOpenChange={(open) =>
                              setPanel((state) => {
                                state.memories.open = open;
                              })
                            }
                            onCountChange={(count) =>
                              setPanel((state) => {
                                state.memories.count = count;
                              })
                            }
                          />
                        )}
                      </Show>
                    </>
                  }
                >
                  {(port) => (
                    <AgentRoutinesSettings
                      port={port()}
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
                      onClose={closePanel}
                    />
                  )}
                </Show>
              </SettingsPanel>
            </Show>
          </>
        )}
      </Show>
    </main>
  );
}
