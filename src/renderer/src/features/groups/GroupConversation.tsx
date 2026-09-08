import { chatTagReferences } from "@openbot/contracts/chat-tag-references";
import { type DraftAttachment, GROUP_ASSIGNMENT_LIMIT, type GroupTask } from "@openbot/contracts/ipc";
import { createEffect, createStore, For, onCleanup, Show } from "solid-js";
import { QuestionPromptBubble } from "../../components/QuestionPromptBubble";
import {
  ArrowUp,
  Bubble,
  BubbleContent,
  Button,
  CircleCheck,
  DropdownMenu,
  Ellipsis,
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageHeader,
  Monitor,
  Plus,
  X,
} from "../../components/ui";
import { useNavigation } from "../../navigation";
import { useTurns } from "../../turns";
import { useAuth } from "../account/account-context";
import { AgentAvatar } from "../agents/AgentAvatar";
import { useAgents } from "../agents/agents-context";
import { useBrowserTabs } from "../browser/browser-context";
import { ComposerEditor, expandComposerMentions } from "../conversation/ComposerEditor";
import { ReplyIcon } from "../conversation/ConversationIcons";
import { ApprovalCard, BrowserTakeoverCard } from "../conversation/ConversationPrompts";
import { conversationBubbleVariant, MessageBody } from "../conversation/MessageRendering";
import { usePresence } from "../team/team-context";
import { GroupAvatar } from "./GroupAvatar";
import { GroupEditor } from "./GroupEditor";
import { useGroups } from "./groups-context";

export function GroupConversation() {
  const groups = useGroups();
  const { centralAuth } = useAuth();
  const { currentTeamMember } = usePresence();
  const isOwnMessage = (authorId: string) => {
    const auth = centralAuth();
    return (
      authorId === currentTeamMember()?.id ||
      authorId === (auth.status === "signed_in" ? `local-user:${auth.user.id}` : "local")
    );
  };
  const { selectAgent } = useNavigation();
  const [panel, setPanel] = createStore<{ tab: "members" | "tasks" | null }>({ tab: null });
  const openAgent = (id: string) => {
    groups.close();
    selectAgent(id);
  };
  const closePanel = () => {
    groups.closeEditor();
    setPanel((state) => {
      state.tab = null;
    });
  };
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
    () => groups.state.selectedId,
    () => {
      setPanel((state) => {
        state.tab = null;
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
  let scrolledGroup: string | undefined;
  createEffect(
    () => ({ id: groups.state.page?.group.id, revision: groups.state.page?.group.revision }),
    ({ id }) => {
      if (id !== scrolledGroup) {
        scrolledGroup = id;
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
  const control = (task: GroupTask, type: "stop" | "resume" | "reassign", recipientAgentId: string | null = null) =>
    groups.command({
      type,
      groupId: task.groupId,
      taskId: task.id,
      recipientAgentId,
      operationId: crypto.randomUUID(),
    });
  const submit = () => {
    const text = composer.text;
    if (groups.state.pending || (!text.trim() && !composer.attachments.length) || !groups.state.selectedId) return;
    const expanded = expandComposerMentions(text);
    const mention = chatTagReferences(expanded).find(
      (reference) => reference.kind === "agent" && !expanded.slice(0, reference.start).trim(),
    );
    void groups
      .command({
        type: "send",
        operationId: crypto.randomUUID(),
        groupId: groups.state.selectedId,
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
    <main class="group-workspace" aria-label="Group conversation">
      <Show when={groups.state.error}>
        <p role="alert">
          {groups.state.error}
          <Button
            variant="ghost"
            onClick={() =>
              void groups.retry().then((sent) => {
                if (sent?.type === "send") clearSent(sent.text);
              })
            }
          >
            Retry
          </Button>
        </p>
      </Show>

      <Show when={groups.state.page} fallback={<p>Loading group…</p>}>
        {(page) => (
          <>
            <header class="group-header">
              <Button
                variant="ghost"
                class="group-title"
                aria-label="Group details"
                onClick={() => {
                  groups.closeEditor();
                  setPanel((state) => {
                    state.tab = state.tab === "members" ? null : "members";
                  });
                }}
              >
                <GroupAvatar members={page().group.members} />
                <span>
                  <h1>{page().group.name}</h1>
                </span>
              </Button>
              <div class="group-actions">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Group tasks"
                  aria-pressed={panel.tab === "tasks" ? "true" : "false"}
                  onClick={() => {
                    groups.closeEditor();
                    setPanel((state) => {
                      state.tab = state.tab === "tasks" ? null : "tasks";
                    });
                  }}
                >
                  <CircleCheck />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Open browser"
                  onClick={() =>
                    void groups.perform(async () => {
                      await window.openbot.browser.openPictureInPicture();
                    })
                  }
                >
                  <Monitor />
                </Button>
                <DropdownMenu.Root placement="bottom-end" modal={false}>
                  <DropdownMenu.Trigger class="sidebar-icon-button" aria-label="Group options">
                    <Ellipsis />
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content>
                      <DropdownMenu.Item onSelect={groups.edit}>Group settings</DropdownMenu.Item>
                      <DropdownMenu.Item onSelect={groups.close}>Close group</DropdownMenu.Item>
                      <Show when={!page().group.archived}>
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
                <Show when={page().group.archived}>
                  <Button
                    disabled={groups.state.pending}
                    onClick={() =>
                      void groups.command({
                        type: "restore",
                        groupId: page().group.id,
                        operationId: crypto.randomUUID(),
                      })
                    }
                  >
                    Restore group
                  </Button>
                </Show>
              </div>
            </header>
            <Show when={composer.archiveConfirm}>
              <div class="group-actions">
                <p>Archive this group and stop its work? Its history will remain available.</p>
                <Button
                  variant="destructive"
                  onClick={() => {
                    setComposer((state) => {
                      state.archiveConfirm = false;
                    });
                    void groups.command({
                      type: "archive",
                      groupId: page().group.id,
                      operationId: crypto.randomUUID(),
                    });
                  }}
                >
                  Archive group
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
            <div class="group-body">
              <div class="group-chat">
                <section
                  class="group-messages"
                  aria-label="Shared messages"
                  aria-live="polite"
                  ref={messageList}
                  onScroll={(event) => {
                    const element = event.currentTarget;
                    stickToLatest = element.scrollHeight - element.scrollTop - element.clientHeight <= 80;
                  }}
                >
                  <Show when={page().olderCursor}>
                    <Button variant="ghost" onClick={() => void groups.loadOlder()}>
                      Load earlier messages
                    </Button>
                  </Show>
                  <Show when={!page().messages.length}>
                    <div class="group-empty">
                      <GroupAvatar members={page().group.members} />
                      <h2>{page().group.name}</h2>
                      <Show when={page().group.purpose}>
                        <p>{page().group.purpose}</p>
                      </Show>
                    </div>
                  </Show>
                  <For
                    each={page().messages.filter(
                      (entry) =>
                        entry.message.text.trim() || entry.message.attachments?.length || entry.message.questionPrompt,
                    )}
                  >
                    {(entry) => (
                      <article
                        class="group-message"
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
                                align={
                                  entry.author.kind === "member" && isOwnMessage(entry.author.id) ? "end" : "start"
                                }
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
                                        else void groups.loadOlder();
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
                                        entry.author.kind === "member" && isOwnMessage(entry.author.id)
                                          ? "you"
                                          : "agent",
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
                                      void groups.perform(() =>
                                        window.openbot.agent.openAttachment({
                                          attachmentId: attachment.id,
                                          action: "open",
                                        }),
                                      );
                                    }}
                                    onAttachmentAction={(attachment, action) => {
                                      void groups.perform(() =>
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
                                          groups.perform(() =>
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
                </section>
                <For each={page().group.members}>
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
                            groups.perform(() =>
                              window.openbot.agent.respondToApproval({
                                requestId: approval().requestId,
                                decision: "accept",
                              }),
                            )
                          }
                          onReject={() =>
                            groups.perform(() =>
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
                <For each={page().group.members}>
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
                              groups.perform(() =>
                                window.openbot.agent.respondToBrowserTakeover({
                                  requestId: request().requestId,
                                  decision: "complete",
                                }),
                              )
                            }
                            onCancel={() =>
                              groups.perform(() =>
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
                <Show when={!page().group.members.length}>
                  <p>Add agents in group settings to start work.</p>
                </Show>
                <Show when={!page().group.archived}>
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
                      <For each={composer.attachments}>
                        {(attachment) => (
                          <div class="group-actions">
                            <span>{attachment.name}</span>
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
                              Remove
                            </Button>
                          </div>
                        )}
                      </For>
                      <div class="composer-input-label">
                        <ComposerEditor
                          agentId={undefined}
                          agents={agentList().filter((agent) =>
                            page().group.members.some((member) => member.agentId === agent.id),
                          )}
                          attachments={composer.attachments}
                          ariaLabel="Message to group"
                          placeholder={`Message ${page().group.name}`}
                          value={composer.text}
                          disabled={groups.state.pending}
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
                            void groups.perform(async () => {
                              const selectedId = groups.state.selectedId;
                              const attachments = await window.openbot.agent.chooseAttachments({ filter: "all" });
                              if (selectedId === groups.state.selectedId)
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
                                composer.recipient
                                  ? `Choose recipient: ${name(composer.recipient)}`
                                  : "Choose recipient"
                              }
                            >
                              @
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
                                  Let the group choose
                                </DropdownMenu.Item>
                                <For each={page().group.members}>
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
                            disabled={groups.state.pending || (!composer.text.trim() && !composer.attachments.length)}
                          >
                            <ArrowUp aria-hidden="true" />
                          </Button>
                        </div>
                      </div>
                    </form>
                  </div>
                </Show>
              </div>
              <Show when={groups.state.editing === "settings" || panel.tab}>
                <aside class="group-details" aria-label="Group details panel">
                  <header class="group-panel-header">
                    <h2>
                      {groups.state.editing === "settings"
                        ? "Group settings"
                        : panel.tab === "tasks"
                          ? "Tasks"
                          : "Group details"}
                    </h2>
                    <Button variant="ghost" size="icon-sm" aria-label="Close group details" onClick={closePanel}>
                      <X />
                    </Button>
                  </header>
                  <Show when={groups.state.editing !== "settings"} fallback={<GroupEditor />}>
                    <Show
                      when={panel.tab === "tasks"}
                      fallback={
                        <>
                          <p class="group-details-purpose">
                            {page().group.purpose || "Add a purpose in group settings."}
                          </p>
                          <h3>Members</h3>
                          <For each={page().group.members}>
                            {(member) => (
                              <div class="group-detail-member">
                                <AgentAvatar agent={agentList().find((agent) => agent.id === member.agentId)} />
                                <div class="group-member-copy">
                                  <strong>
                                    {name(member.agentId)}
                                    <Show when={page().group.leadAgentId === member.agentId}>
                                      <span class="group-lead-label">Lead</span>
                                    </Show>
                                  </strong>
                                  <span>{member.responsibility}</span>
                                  <Show when={agentList().some((agent) => agent.id === member.agentId)}>
                                    <Button variant="ghost" size="xs" onClick={() => openAgent(member.agentId)}>
                                      Open conversation
                                    </Button>
                                  </Show>
                                </div>
                              </div>
                            )}
                          </For>
                          <Show when={!page().group.members.length}>
                            <p class="group-empty-copy">No agents have joined this group.</p>
                          </Show>
                          <Button variant="outline" onClick={groups.edit}>
                            Edit members
                          </Button>
                        </>
                      }
                    >
                      <section class="group-tasks" aria-label="Group tasks">
                        <Show when={!page().tasks.length}>
                          <p class="group-empty-copy">Tasks appear when you send a request.</p>
                        </Show>
                        <For each={page().tasks}>
                          {(task) => (
                            <article class="group-task" aria-label={`Task: ${task.instruction}`}>
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
                                <div class="group-actions">
                                  <Show when={task.state !== "paused" && task.state !== "failed"}>
                                    <Button size="sm" variant="ghost" onClick={() => void control(task, "stop")}>
                                      Stop
                                    </Button>
                                  </Show>
                                  <Show when={task.state === "paused" || task.state === "failed"}>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      disabled={groups.state.pending}
                                      onClick={() => void control(task, "resume")}
                                    >
                                      {task.assignmentCount >= GROUP_ASSIGNMENT_LIMIT ? "Continue" : "Resume"}
                                    </Button>
                                  </Show>
                                  <For
                                    each={page().group.members.filter((member) => member.agentId !== task.ownerAgentId)}
                                  >
                                    {(member) => (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        disabled={groups.state.pending}
                                        onClick={() => void control(task, "reassign", member.agentId)}
                                      >
                                        Assign to {name(member.agentId)}
                                      </Button>
                                    )}
                                  </For>
                                </div>
                              </Show>
                            </article>
                          )}
                        </For>
                      </section>
                    </Show>
                  </Show>
                </aside>
              </Show>
            </div>
          </>
        )}
      </Show>
    </main>
  );
}
