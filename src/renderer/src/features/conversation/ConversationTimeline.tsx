import { createMemo, For, Loading, lazy, Show, untrack } from "solid-js";
import { Button } from "../../components/ui";
import type { AgentMessage, ChatActionMarkerModel } from "../../data";
import { errorMessage } from "../../error-message";
import { AgentActivityIndicator } from "./AgentActivity";
import { AttachmentCards } from "./AttachmentCards";
import { ChatActionMarker } from "./ChatActionMarker";
import { ChatMessageRow } from "./ChatMessageRow";
import { ChatSearch } from "./ChatSearch";
import { BrowserTakeoverCard } from "./ConversationPrompts";
import { dayMarkerLabel } from "./chat-day-markers";
import { useConversationViewScope } from "./conversation-scope";
import type { ConversationProps } from "./conversation-types";
import { ScrollToLatestButton } from "./MessageNavigation";
import { MessageActions } from "./MessageRendering";
import { UnreadMessagesBanner, UnreadMessagesDivider } from "./UnreadMessages";

/** A message that renders only an action marker, with no bubble of its own. */
function markerOnlyMessage(message: AgentMessage): boolean {
  const marker = message.actionMarker;
  if (!marker) return false;
  return (
    Boolean(message.exchange) ||
    !message.routine ||
    marker.kind === "routine-lifecycle" ||
    marker.kind === "unavailable"
  );
}

/** Marker-only rows that render attachment cards below the marker do not end with one. */
function markerRowEndsWithMarker(message: AgentMessage): boolean {
  if (!markerOnlyMessage(message)) return false;
  return !(message.exchange?.direction === "incoming" && (message.attachments?.length ?? 0) > 0);
}

function routineMarkerAvailable(
  marker: ChatActionMarkerModel,
  availableRoutineIds: readonly string[] | undefined,
): boolean {
  if (!("routineId" in marker)) return true;
  if (marker.kind === "routine-lifecycle" && marker.action === "deleted") return false;
  return availableRoutineIds?.includes(marker.routineId) === true;
}

/** @internal Stable HMR boundary for conversation timeline. */
export function ConversationTimeline() {
  const {
    activeChatSearchIndex,
    agentActivitySpaceReserved,
    agentReady,
    attachmentAction,
    browserTakeoverPreview,
    browserTakeoverResolution,
    browserTakeoverTab,
    chatSearchMatches,
    chatSearchOpen,
    chatSearchQuery,
    chatSearchTotal,
    clearNewMessages,
    closeChatSearch,
    copiedMessageId,
    copyMessage,
    expandedEmojiMessageId,
    installedSkills,
    scrollFades,
    jumpToLatestMessage,
    jumpToUnreadMessages,
    markMessageSeen,
    markUnreadMessages,
    markingRead,
    messageVirtualizer,
    newMessageCount,
    timelineMessages,
    moveChatSearch,
    openExternalMessageUrl,
    openMoreMessageId,
    openReactionMessageId,
    openRoutineSettings,
    openSharedFile,
    openWorkspaceFile,
    previewAttachment,
    props,
    reactToMessage,
    renderedAgentActivity,
    respondToBrowserTakeover,
    replyToMessage,
    scheduleUnreadDividerVisibilityUpdate,
    setChatSearchQuery,
    setComposerError,
    setExpandedEmojiMessageId,
    setOpenMoreMessageId,
    setOpenReactionMessageId,
    showScrollToLatest,
    unreadDividerVisible,
    updateScrollFade,
    updateUnreadDividerVisibility,
    setAgentActivitySlotElement,
    setChatSearchInputElement,
    setScrollElement,
    setStickToLatest,
    setUnreadMessagesDividerElement,
    setVirtualRootElement,
  } = useConversationViewScope();
  const virtualMessageRows = createMemo(() => messageVirtualizer.getVirtualItems());
  let cachedPrompt: { key: string; prompt: NonNullable<ConversationProps["prompt"]> } | null = null;
  const keyedPrompt = createMemo(() => {
    const prompt = props.prompt;
    if (!prompt) {
      cachedPrompt = null;
      return null;
    }
    const key = JSON.stringify([prompt.turnId, String(prompt.requestId)]);
    if (cachedPrompt?.key === key) return cachedPrompt;
    cachedPrompt = { key, prompt };
    return cachedPrompt;
  });
  return (
    <>
      <Show when={chatSearchOpen()}>
        <ChatSearch
          query={chatSearchQuery()}
          current={activeChatSearchIndex()}
          total={props.onSearchMessages ? chatSearchTotal() : chatSearchMatches().length}
          inputRef={setChatSearchInputElement}
          onQueryChange={setChatSearchQuery}
          onPrevious={() => moveChatSearch(-1)}
          onNext={() => moveChatSearch(1)}
          onClose={closeChatSearch}
        />
      </Show>

      <Show when={props.unreadCount > 0 && !unreadDividerVisible()}>
        <UnreadMessagesBanner
          count={props.unreadCount}
          busy={markingRead()}
          onJumpToUnread={jumpToUnreadMessages}
          onMarkRead={() => void markUnreadMessages()}
        />
      </Show>

      <div
        class={["conversation-scroll", scrollFades.classes()]}
        ref={setScrollElement}
        onScroll={(event) => {
          const element = event.currentTarget;
          setStickToLatest(element.scrollHeight - element.scrollTop - element.clientHeight <= 80);
          updateScrollFade(element);
          updateUnreadDividerVisibility();
        }}
      >
        <Show when={showScrollToLatest() || props.discontinuous}>
          <ScrollToLatestButton
            onClick={() => void jumpToLatestMessage()}
            newMessageCount={newMessageCount()}
            onDismiss={clearNewMessages}
          />
        </Show>
        <Show when={props.loaded}>
          <Show when={!agentReady()}>
            <section class="agent-setup-card" role="status">
              <div>
                <strong>
                  {props.agentStatus.phase === "starting" || props.agentStatus.phase === "restarting"
                    ? "Connecting to agent CLIs…"
                    : "Agent CLI setup required"}
                </strong>
                <p>
                  {errorMessage(
                    props.agentStatus.message,
                    "Install and sign in to Codex CLI, Claude CLI, or Grok CLI, then restart OpenBot.",
                  )}
                </p>
              </div>
              <Show when={props.agentStatus.phase !== "starting" && props.agentStatus.phase !== "restarting"}>
                <Button
                  variant="outline"
                  type="button"
                  onClick={() =>
                    void props
                      .onOpenAgentSetup()
                      .catch((error) =>
                        setComposerError(errorMessage(error, "Could not open the setup guide. Try again.")),
                      )
                  }
                >
                  Setup guide
                </Button>
              </Show>
            </section>
          </Show>
          <Show when={props.loadingOlder || props.olderError}>
            <div class="conversation-history-status" role={props.olderError ? "alert" : "status"}>
              <Show when={props.olderError} fallback="Loading older messages…">
                <span>{props.olderError}</span>
                <Button type="button" variant="ghost" size="xs" onClick={() => props.onLoadOlder?.()}>
                  Retry
                </Button>
              </Show>
            </div>
          </Show>
          <div
            ref={setVirtualRootElement}
            class={["virtual-chat-list", { "virtual-chat-list-static": !messageVirtualizer.isVirtualized() }]}
            style={{ height: messageVirtualizer.isVirtualized() ? `${messageVirtualizer.getTotalSize()}px` : "auto" }}
          >
            <For each={virtualMessageRows()}>
              {(virtualRow) => {
                const message = createMemo(() => timelineMessages()[virtualRow.index]);
                const initialMessage = untrack(message);
                if (!initialMessage) return null;
                const animateEntrance = initialMessage.animate === true && markMessageSeen(initialMessage.id);
                const initialActionMarker = initialMessage.actionMarker;
                /*
                 * The separator above the row. The first row always carries one, and a later row
                 * carries one when it opens a new day. A message with no stored timestamp can only
                 * open the transcript, so it falls back to the time it prints in its footer.
                 */
                const dayMarker = createMemo(() => {
                  const current = message();
                  if (!current) return null;
                  const previous = timelineMessages()[virtualRow.index - 1];
                  if (current.createdAt) return dayMarkerLabel(previous?.createdAt, current.createdAt);
                  return previous === undefined ? (current.time ?? "now") : null;
                });
                const markerOnly = markerOnlyMessage(initialMessage);
                // Consecutive markers keep the tighter marker gap so they read as one group.
                const groupedWithMarker = createMemo(() => {
                  const current = message();
                  if (!current?.actionMarker) return false;
                  if (current.id === props.firstUnreadMessageId) return false;
                  const previous = timelineMessages()[virtualRow.index - 1];
                  return previous !== undefined && markerRowEndsWithMarker(previous);
                });
                if (markerOnly) {
                  return (
                    <div
                      data-index={virtualRow.index}
                      data-grouped={groupedWithMarker() ? "marker" : undefined}
                      ref={messageVirtualizer.measureElement}
                      class="virtual-chat-row"
                      style={{
                        transform: messageVirtualizer.isVirtualized()
                          ? `translateY(${virtualRow.start - messageVirtualizer.scrollMargin()}px)`
                          : "none",
                      }}
                    >
                      <Show when={dayMarker()}>
                        {(label) => (
                          <div class="time-marker">
                            <span>{label()}</span>
                          </div>
                        )}
                      </Show>
                      <Show when={message()?.id === props.firstUnreadMessageId}>
                        <UnreadMessagesDivider
                          elementRef={(element) => {
                            setUnreadMessagesDividerElement(element);
                            scheduleUnreadDividerVisibilityUpdate();
                          }}
                        />
                      </Show>
                      <article
                        data-chat-search-message={message()?.id}
                        class={{ "chat-action-entry-animated": animateEntrance }}
                      >
                        <Show when={message()?.actionMarker ?? initialActionMarker}>
                          {(marker) => (
                            <ChatActionMarker
                              marker={marker()}
                              agents={props.agents}
                              announce={animateEntrance}
                              routineAvailable={routineMarkerAvailable(marker(), props.availableRoutineIds)}
                              onSelectAgent={props.onSelectAgent}
                              onOpenRoutine={openRoutineSettings}
                              onOpenHostedSite={(url) => void openExternalMessageUrl(url)}
                            />
                          )}
                        </Show>
                        <Show
                          when={
                            initialMessage.exchange?.direction === "incoming" &&
                            (message()?.attachments?.length ?? 0) > 0
                          }
                        >
                          <div class="chat-action-attachments">
                            <AttachmentCards
                              attachments={message()?.attachments ?? []}
                              onPreview={(attachment) => void previewAttachment(attachment)}
                              onAction={attachmentAction}
                            />
                          </div>
                        </Show>
                      </article>
                    </div>
                  );
                }
                const displayedReactions = createMemo(() => {
                  const currentMessage = message();
                  if (currentMessage?.reactions?.length) return currentMessage.reactions;
                  if (currentMessage?.reaction) {
                    return [{ emoji: currentMessage.reaction, actor: { kind: "user" as const } }];
                  }
                  return (currentMessage?.reactionSummary?.emojis ?? []).map((emoji) => ({
                    emoji,
                    actor: { kind: "user" as const },
                  }));
                });
                return (
                  <div
                    data-index={virtualRow.index}
                    data-grouped={groupedWithMarker() ? "marker" : undefined}
                    ref={messageVirtualizer.measureElement}
                    class="virtual-chat-row"
                    style={{
                      transform: messageVirtualizer.isVirtualized()
                        ? `translateY(${virtualRow.start - messageVirtualizer.scrollMargin()}px)`
                        : "none",
                    }}
                  >
                    <Show when={dayMarker()}>
                      {(label) => (
                        <div class="time-marker">
                          <span>{label()}</span>
                        </div>
                      )}
                    </Show>
                    <Show when={message()?.id === props.firstUnreadMessageId}>
                      <UnreadMessagesDivider
                        elementRef={(element) => {
                          setUnreadMessagesDividerElement(element);
                          scheduleUnreadDividerVisibilityUpdate();
                        }}
                      />
                    </Show>
                    <Show
                      when={message()?.questionPrompt}
                      keyed
                      fallback={
                        <>
                          <Show when={message()?.routine && message()?.actionMarker}>
                            {(marker) => (
                              <ChatActionMarker
                                marker={marker()}
                                agents={props.agents}
                                announce={animateEntrance}
                                routineAvailable={routineMarkerAvailable(marker(), props.availableRoutineIds)}
                                onSelectAgent={props.onSelectAgent}
                                onOpenRoutine={openRoutineSettings}
                                onOpenHostedSite={(url) => void openExternalMessageUrl(url)}
                              />
                            )}
                          </Show>
                          <ChatMessageRow
                            message={message() ?? initialMessage}
                            author={{
                              kind: message()?.author === "you" ? "you" : "agent",
                              name: message()?.author === "you" ? "You" : (props.agent?.name ?? "Agent"),
                            }}
                            animate={animateEntrance}
                            agents={props.agents}
                            skills={installedSkills()}
                            referencedMessage={
                              timelineMessages().find((candidate) => candidate.id === message()?.replyToMessageId) ??
                              (message()?.replyToMessageId
                                ? props.messageReferences?.[message()?.replyToMessageId ?? ""]
                                : undefined)
                            }
                            reactions={displayedReactions()}
                            reactionOverflowCount={message()?.reactionSummary?.overflowCount}
                            onRemoveReaction={() => {
                              const currentMessage = message();
                              if (currentMessage) void reactToMessage(currentMessage, null);
                            }}
                            data-chat-search-message={message()?.id}
                            onSelectAgent={props.onSelectAgent}
                            onOpenLink={(url) => void openExternalMessageUrl(url)}
                            onPreview={(attachment) => void previewAttachment(attachment)}
                            onAttachmentAction={attachmentAction}
                            onOpenSharedFile={openSharedFile}
                            onOpenWorkspaceFile={openWorkspaceFile}
                            onDownload={(attachment) => attachmentAction(attachment, "download")}
                            actions={
                              <MessageActions
                                message={message() ?? initialMessage}
                                pickerOpen={openReactionMessageId() === message()?.id}
                                moreOpen={openMoreMessageId() === message()?.id}
                                expandedEmoji={expandedEmojiMessageId() === message()?.id}
                                copied={copiedMessageId() === message()?.id}
                                onTogglePicker={() => {
                                  const messageId = message()?.id;
                                  if (!messageId) return;
                                  setOpenReactionMessageId((current) => (current === messageId ? null : messageId));
                                  setOpenMoreMessageId(null);
                                  setExpandedEmojiMessageId(null);
                                }}
                                onToggleMore={() => {
                                  const messageId = message()?.id;
                                  if (!messageId) return;
                                  setOpenMoreMessageId((current) => (current === messageId ? null : messageId));
                                  setOpenReactionMessageId(null);
                                  setExpandedEmojiMessageId(null);
                                }}
                                onExpandEmoji={() => {
                                  const messageId = message()?.id;
                                  if (!messageId) return;
                                  setExpandedEmojiMessageId((current) => (current === messageId ? null : messageId));
                                }}
                                onReact={(emoji) => {
                                  const currentMessage = message();
                                  if (currentMessage) void reactToMessage(currentMessage, emoji);
                                }}
                                onReply={() => {
                                  const currentMessage = message();
                                  if (currentMessage) replyToMessage(currentMessage);
                                }}
                                onCopy={() => {
                                  const currentMessage = message();
                                  if (currentMessage) void copyMessage(currentMessage);
                                }}
                              />
                            }
                          />
                        </>
                      }
                    >
                      {(questionPrompt) => (
                        <Show when={questionPrompt.resolution} keyed>
                          {(resolution) => (
                            <article data-chat-search-message={message()?.id} class="question-prompt-history-entry">
                              <QuestionPromptBubble
                                questions={questionPrompt.questions}
                                resolution={resolution}
                                onSubmit={async () => false}
                              />
                            </article>
                          )}
                        </Show>
                      )}
                    </Show>
                  </div>
                );
              }}
            </For>
          </div>
          <div
            class="agent-activity-slot"
            data-reserved={agentActivitySpaceReserved() ? "true" : "false"}
            ref={setAgentActivitySlotElement}
          >
            <Show when={renderedAgentActivity()}>
              {(activity) => (
                <AgentActivityIndicator
                  agent={activity().agent}
                  detail={activity().detail}
                  presentation={activity().presentation}
                  phase={activity().phase}
                />
              )}
            </Show>
          </div>
          <Show when={keyedPrompt()} keyed>
            {(entry) => (
              <Loading>
                <QuestionPromptBubble
                  questions={entry.prompt.questions}
                  onSubmit={props.onAnswerPrompt}
                  onResolutionPresented={() =>
                    props.onPromptResolutionPresented?.(
                      entry.prompt.agentId,
                      entry.prompt.turnId,
                      entry.prompt.requestId,
                    )
                  }
                />
              </Loading>
            )}
          </Show>
          <Show when={props.approval}>
            {(approval) => (
              <Loading>
                <ApprovalCard
                  approval={approval()}
                  onApprove={() => props.onRespondToApproval("accept")}
                  onReject={() => props.onRespondToApproval("decline")}
                />
              </Loading>
            )}
          </Show>
          <Show when={props.browserTakeover}>
            <Loading>
              <BrowserTakeoverCard
                agentName={props.agent?.name ?? "the agent"}
                tab={browserTakeoverTab()}
                preview={browserTakeoverPreview().preview}
                previewStatus={browserTakeoverPreview().status}
                onComplete={() => respondToBrowserTakeover("complete")}
                onCancel={() => respondToBrowserTakeover("cancel")}
              />
            </Loading>
          </Show>
          <Show when={!props.browserTakeover && browserTakeoverResolution()}>
            {(resolution) => (
              <BrowserTakeoverCard
                agentName={props.agent?.name ?? "the agent"}
                tab={resolution().tab}
                preview={resolution().preview}
                previewStatus={resolution().previewStatus}
                decision={resolution().decision}
                onComplete={async () => false}
                onCancel={async () => false}
              />
            )}
          </Show>
        </Show>
      </div>
    </>
  );
}

const ApprovalCard = lazy(() => import("./ConversationPrompts").then((module) => ({ default: module.ApprovalCard })));
const QuestionPromptBubble = lazy(() =>
  import("../../components/QuestionPromptBubble").then((module) => ({ default: module.QuestionPromptBubble })),
);
