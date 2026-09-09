import { chatTagReferences } from "@openbot/contracts/chat-tag-references";
import { CHANNEL_ASSIGNMENT_LIMIT, type ChannelTask, type DraftAttachment } from "@openbot/contracts/ipc";
import { createEffect, createMemo, createStore, For, onCleanup, Show } from "solid-js";
import { QuestionPromptBubble } from "../../components/QuestionPromptBubble";
import {
  ArrowUp,
  Bubble,
  BubbleContent,
  Button,
  DropdownMenu,
  Ellipsis,
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageHeader,
  Plus,
  X,
} from "../../components/ui";
import { useTurns } from "../../turns";
import { useAuth } from "../account/account-context";
import { AgentAvatar } from "../agents/AgentAvatar";
import { useAgents } from "../agents/agents-context";
import { useBrowserTabs } from "../browser/browser-context";
import { AgentMemoriesModal } from "../conversation/AgentMemoriesModal";
import { AgentRoutinesSettings } from "../conversation/AgentRoutinesSettings";
import { ComposerEditor, expandComposerMentions } from "../conversation/ComposerEditor";
import { ReplyIcon } from "../conversation/ConversationIcons";
import { ApprovalCard, BrowserTakeoverCard } from "../conversation/ConversationPrompts";
import { conversationBubbleVariant, MessageBody } from "../conversation/MessageRendering";
import { channelMemoriesPort } from "../conversation/memories-port";
import { channelRoutinesPort } from "../conversation/routines-port";
import { usePresence } from "../team/team-context";
import { ChannelAvatar } from "./ChannelAvatar";
import { ChannelEditor } from "./ChannelEditor";
import { useChannels } from "./channels-context";

export function ChannelConversation() {
  const channels = useChannels();
  const { centralAuth } = useAuth();
  const { currentTeamMember } = usePresence();
  const isOwnMessage = (authorId: string) => {
    const auth = centralAuth();
    return (
      authorId === currentTeamMember()?.id ||
      authorId === (auth.status === "signed_in" ? `local-user:${auth.user.id}` : "local")
    );
  };
  /**
   * Memories and routines live here rather than in `ChannelEditor`, because the routines view
   * covers the whole panel - its own header replaces the panel header, the way the agent settings
   * panel does it.
   */
  const [panel, setPanel] = createStore<{
    tasks: boolean;
    memories: { open: boolean; count: number };
    routines: { open: boolean; count: number };
  }>({ tasks: false, memories: { open: false, count: 0 }, routines: { open: false, count: 0 } });
  const resetPanel = () => {
    setPanel((state) => {
      state.tasks = false;
      state.memories.open = false;
      state.routines.open = false;
    });
  };
  const openTasks = () => {
    channels.closeEditor();
    resetPanel();
    setPanel((state) => {
      state.tasks = true;
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
  const { pendingApprovals, pendingPrompts } = useTurns();
  const { browserTabs } = useBrowserTabs();
  const { agentList } = useAgents();
  const [composer, setComposer] = createStore<{
    text: string;
    recipient: string | null;
    reply: string | null;
    attachments: DraftAttachment[];
    archiveConfirm: boolean;
  }>({ text: "", recipient: null, reply: null, attachments: [], archiveConfirm: false });
  createEffect(
    () => channels.state.selectedId,
    () => {
      resetPanel();
      setPanel((state) => {
        state.memories.count = 0;
        state.routines.count = 0;
      });
      setComposer((state) => {
        Object.assign(state, { text: "", recipient: null, reply: null, attachments: [], archiveConfirm: false });
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
  let stickToLatest = true;
  let scrollFrame: number | undefined;
  let scrolledChannel: string | undefined;
  createEffect(
    () => ({ id: channels.state.page?.channel.id, revision: channels.state.page?.channel.revision }),
    ({ id }) => {
      if (id !== scrolledChannel) {
        scrolledChannel = id;
        stickToLatest = true;
      }
      if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame);
      scrollFrame = requestAnimationFrame(() => {
        if (messageList && stickToLatest) messageList.scrollTop = messageList.scrollHeight;
      });
    },
  );
  onCleanup(() => {
    if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame);
  });
  const messageElements = new Map<string, HTMLElement>();
  const name = (id: string | null) => agentList().find((agent) => agent.id === id)?.name ?? "Unassigned";
  const control = (task: ChannelTask, type: "stop" | "resume") =>
    channels.command({
      type,
      channelId: task.channelId,
      taskId: task.id,
      recipientAgentId: null,
      operationId: crypto.randomUUID(),
    });
  const submit = () => {
    const text = composer.text;
    if (channels.state.pending || (!text.trim() && !composer.attachments.length) || !channels.state.selectedId) return;
    const expanded = expandComposerMentions(text);
    const mention = chatTagReferences(expanded).find(
      (reference) => reference.kind === "agent" && !expanded.slice(0, reference.start).trim(),
    );
    void channels
      .command({
        type: "send",
        operationId: crypto.randomUUID(),
        channelId: channels.state.selectedId,
        text: expanded,
        recipientAgentId: composer.recipient ?? mention?.id ?? null,
        replyToMessageId: composer.reply,
        attachmentDraftIds: composer.attachments.map((attachment) => attachment.id),
      })
      .then((sent) => {
        if (sent) clearSent(text);
      });
  };
  return (
    <main class="conversation-panel" aria-label="Channel conversation">
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
              <div class="conversation-header-actions no-drag">
                <DropdownMenu.Root placement="bottom-end" modal={false}>
                  <DropdownMenu.Trigger class="sidebar-icon-button" aria-label="Channel options">
                    <Ellipsis />
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content>
                      <DropdownMenu.Item onSelect={openSettings}>Channel settings</DropdownMenu.Item>
                      <DropdownMenu.Item onSelect={openTasks}>Channel tasks</DropdownMenu.Item>
                      <DropdownMenu.Item onSelect={channels.close}>Close channel</DropdownMenu.Item>
                      <Show when={!page().channel.archived}>
                        <DropdownMenu.Item
                          onSelect={() =>
                            setComposer((state) => {
                              state.archiveConfirm = true;
                            })
                          }
                        >
                          Archive
                        </DropdownMenu.Item>
                      </Show>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
                <Show when={page().channel.archived}>
                  <Button
                    disabled={channels.state.pending}
                    onClick={() =>
                      void channels.command({
                        type: "restore",
                        channelId: page().channel.id,
                        operationId: crypto.randomUUID(),
                      })
                    }
                  >
                    Restore channel
                  </Button>
                </Show>
              </div>
            </header>
            <Show when={composer.archiveConfirm}>
              <div class="channel-confirm">
                <p>Archive this channel and stop its work? Its history will remain available.</p>
                <Button
                  variant="destructive"
                  onClick={() => {
                    setComposer((state) => {
                      state.archiveConfirm = false;
                    });
                    void channels.command({
                      type: "archive",
                      channelId: page().channel.id,
                      operationId: crypto.randomUUID(),
                    });
                  }}
                >
                  Archive channel
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    setComposer((state) => {
                      state.archiveConfirm = false;
                    })
                  }
                >
                  Cancel
                </Button>
              </div>
            </Show>
            <section
              class="conversation-scroll"
              aria-label="Shared messages"
              aria-live="polite"
              ref={messageList}
              onScroll={(event) => {
                const element = event.currentTarget;
                stickToLatest = element.scrollHeight - element.scrollTop - element.clientHeight <= 80;
              }}
            >
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
              <div class="virtual-chat-list virtual-chat-list-static">
                <For
                  each={page().messages.filter(
                    (entry) =>
                      entry.message.text.trim() || entry.message.attachments?.length || entry.message.questionPrompt,
                  )}
                >
                  {(entry) => (
                    <article
                      class="virtual-chat-row"
                      ref={(element) => {
                        messageElements.set(entry.id, element);
                      }}
                      aria-label={`Message from ${entry.author.name}`}
                    >
                      <Message
                        class={[
                          "message-entry",
                          entry.author.kind === "member" && isOwnMessage(entry.author.id)
                            ? "message-entry-user"
                            : "message-entry-agent",
                        ]}
                        data-author={
                          entry.author.kind === "member" && isOwnMessage(entry.author.id) ? "user" : "assistant"
                        }
                        align={entry.author.kind === "member" && isOwnMessage(entry.author.id) ? "end" : "start"}
                      >
                        <Show when={entry.author.kind === "agent"}>
                          <MessageAvatar>
                            <AgentAvatar agent={agentList().find((agent) => agent.id === entry.author.id)} />
                          </MessageAvatar>
                        </Show>
                        <MessageContent>
                          <Show when={!(entry.author.kind === "member" && isOwnMessage(entry.author.id))}>
                            <MessageHeader>{entry.author.name}</MessageHeader>
                          </Show>
                          <div class="message-shell">
                            <Bubble
                              align={entry.author.kind === "member" && isOwnMessage(entry.author.id) ? "end" : "start"}
                              variant={conversationBubbleVariant({
                                id: entry.id,
                                author:
                                  entry.author.kind === "member" && isOwnMessage(entry.author.id) ? "you" : "agent",
                                body: entry.message.text,
                                time: entry.message.createdAt,
                                attachments: entry.message.attachments,
                              })}
                            >
                              <BubbleContent>
                                <Show when={entry.superseded}>
                                  <span> · Superseded</span>
                                </Show>
                                <Show when={entry.message.replyToMessageId}>
                                  <Button
                                    size="xs"
                                    variant="ghost"
                                    onClick={() => {
                                      const target =
                                        entry.message.replyToMessageId &&
                                        messageElements.get(entry.message.replyToMessageId);
                                      if (target) target.scrollIntoView({ block: "center" });
                                      else void channels.loadOlder();
                                    }}
                                  >
                                    Reply to{" "}
                                    {page().messages.find((message) => message.id === entry.message.replyToMessageId)
                                      ?.author.name ?? "earlier message"}
                                  </Button>
                                </Show>
                                <MessageBody
                                  message={{
                                    id: entry.id,
                                    author:
                                      entry.author.kind === "member" && isOwnMessage(entry.author.id) ? "you" : "agent",
                                    body: entry.message.text,
                                    time: new Date(entry.message.createdAt).toLocaleTimeString(),
                                    attachments: entry.message.attachments,
                                    replyToMessageId: entry.message.replyToMessageId,
                                    status: undefined,
                                    streaming: entry.message.status === "streaming",
                                  }}
                                  agents={agentList()}
                                  onSelectAgent={(id) =>
                                    setComposer((state) => {
                                      state.recipient = id;
                                    })
                                  }
                                  onOpenLink={(url) => {
                                    void window.openbot.openUrl(url);
                                  }}
                                  onPreview={(attachment) => {
                                    void channels.perform(() =>
                                      window.openbot.agent.openAttachment({
                                        attachmentId: attachment.id,
                                        action: "open",
                                      }),
                                    );
                                  }}
                                  onAttachmentAction={(attachment, action) => {
                                    void channels.perform(() =>
                                      window.openbot.agent.openAttachment({ attachmentId: attachment.id, action }),
                                    );
                                  }}
                                />
                                <Show when={entry.message.questionPrompt}>
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
                              </BubbleContent>
                            </Bubble>
                            <div class="message-actions">
                              {" "}
                              <Button
                                class="message-action-button"
                                aria-label="Reply"
                                variant="ghost"
                                onClick={() =>
                                  setComposer((state) => {
                                    state.reply = entry.id;
                                  })
                                }
                              >
                                <ReplyIcon />
                              </Button>
                            </div>
                          </div>
                          <MessageFooter>
                            <time datetime={entry.message.createdAt}>
                              {new Date(entry.message.createdAt).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </time>
                            <Show when={entry.message.status === "streaming"}>
                              <span>Writing…</span>
                            </Show>
                            <Show when={entry.message.status === "failed" || entry.message.status === "interrupted"}>
                              <span>Partial result · {entry.message.status}</span>
                            </Show>
                          </MessageFooter>
                        </MessageContent>
                      </Message>
                    </article>
                  )}
                </For>
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
                      {" "}
                      <DropdownMenu.Root placement="top-start">
                        <DropdownMenu.Trigger
                          class="composer-button"
                          aria-label={
                            composer.recipient ? `Choose recipient: ${name(composer.recipient)}` : "Choose recipient"
                          }
                        >
                          <span aria-hidden="true">@</span>
                        </DropdownMenu.Trigger>
                        <DropdownMenu.Portal>
                          <DropdownMenu.Content>
                            <DropdownMenu.Item
                              onSelect={() =>
                                setComposer((state) => {
                                  state.recipient = null;
                                })
                              }
                            >
                              Let the channel choose
                            </DropdownMenu.Item>
                            <For each={page().channel.members}>
                              {(member) => (
                                <DropdownMenu.Item
                                  onSelect={() =>
                                    setComposer((state) => {
                                      state.recipient = member.agentId;
                                    })
                                  }
                                >
                                  @{name(member.agentId)}
                                </DropdownMenu.Item>
                              )}
                            </For>
                          </DropdownMenu.Content>
                        </DropdownMenu.Portal>
                      </DropdownMenu.Root>
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
            <Show when={channels.state.editing === "settings" || panel.tasks}>
              <aside class="channel-panel" aria-label="Channel panel">
                {/* Routines bring their own header with a back arrow, so they replace the panel
                    header rather than sit under it - the same trade the agent panel makes. */}
                <Show
                  when={panel.routines.open && routinesPort()}
                  fallback={
                    <>
                      <header class="channel-panel-header">
                        <h2>{channels.state.editing === "settings" ? "Channel settings" : "Tasks"}</h2>
                        <Button variant="ghost" size="icon-sm" aria-label="Close channel panel" onClick={closePanel}>
                          <X />
                        </Button>
                      </header>
                      <Show
                        when={channels.state.editing !== "settings"}
                        fallback={
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
                        }
                      >
                        <section class="channel-tasks" aria-label="Channel tasks">
                          <Show when={!page().tasks.length}>
                            <p class="channel-empty-copy">Tasks appear when you send a request.</p>
                          </Show>
                          <For each={page().tasks}>
                            {(task) => (
                              <article class="channel-task" aria-label={`Task: ${task.instruction}`}>
                                <strong>
                                  {name(task.ownerAgentId)} · {task.state}
                                </strong>
                                <p>{task.instruction}</p>
                                <Show when={task.error}>
                                  <p role="status">{task.error}</p>
                                </Show>
                                <For each={task.dependencies}>
                                  {(id) => {
                                    const dependency = () => page().tasks.find((item) => item.id === id);
                                    return (
                                      <p>
                                        Depends on {name(dependency()?.ownerAgentId ?? null)} ·{" "}
                                        {dependency()?.state ?? "unavailable"}
                                      </p>
                                    );
                                  }}
                                </For>
                                <Show when={task.state !== "completed" && task.state !== "cancelled"}>
                                  <div class="channel-task-actions">
                                    <Show when={task.state !== "paused" && task.state !== "failed"}>
                                      <Button size="sm" variant="ghost" onClick={() => void control(task, "stop")}>
                                        Stop
                                      </Button>
                                    </Show>
                                    <Show when={task.state === "paused" || task.state === "failed"}>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        disabled={channels.state.pending}
                                        onClick={() => void control(task, "resume")}
                                      >
                                        {task.assignmentCount >= CHANNEL_ASSIGNMENT_LIMIT ? "Continue" : "Resume"}
                                      </Button>
                                    </Show>
                                  </div>
                                </Show>
                              </article>
                            )}
                          </For>
                        </section>
                      </Show>
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
              </aside>
            </Show>
          </>
        )}
      </Show>
    </main>
  );
}
