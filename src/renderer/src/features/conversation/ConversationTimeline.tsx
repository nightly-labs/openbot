import { Button } from "@openbot/ui";
import type { AgentMessage, ChatActionMarkerModel } from "@openbot/ui/data";
import { AgentActivityIndicator } from "@openbot/ui/features/conversation/AgentActivity";
import { AttachmentCards } from "@openbot/ui/features/conversation/AttachmentCards";
import { ChatActionMarker } from "@openbot/ui/features/conversation/ChatActionMarker";
import { ChatMessageRow } from "@openbot/ui/features/conversation/ChatMessageRow";
import { ChatSearch } from "@openbot/ui/features/conversation/ChatSearch";
import { BrowserTakeoverCard } from "@openbot/ui/features/conversation/ConversationPrompts";
import { ScrollToLatestButton } from "@openbot/ui/features/conversation/MessageNavigation";
import { MessageActions } from "@openbot/ui/features/conversation/MessageRendering";
import { UnreadMessagesBanner, UnreadMessagesDivider } from "@openbot/ui/features/conversation/UnreadMessages";
import { useText } from "@openbot/ui/text";
import { createMemo, createSignal, For, Loading, lazy, Show, untrack } from "solid-js";
import { dayMarkerLabel } from "./chat-day-markers";
import { continuesSenderRun } from "./chat-grouping";
import { conversationRuntime } from "./conversation-runtime";
import { useConversationViewScope } from "./conversation-scope";
import type { ConversationProps } from "./conversation-types";
import { RoutineChatCard } from "./RoutineChatCard";

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

/**
 * Does this row draw a time of its own?
 *
 * A marker-only row carries the marker's own time, and a question prompt draws a card instead of a
 * message row. Neither shows the header a run continues under, so neither can hold a run open.
 */
function rowDrawsTime(message: AgentMessage): boolean {
  return !markerOnlyMessage(message) && !message.questionPrompt;
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
    attachmentAction,
    downloadAttachments,
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
    openBrowserTakeoverTab,
    openRoutineSettings,
    openSkillSettings,
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
    setExpandedEmojiMessageId,
    setOpenMoreMessageId,
    setOpenReactionMessageId,
    setRequiredInteractionElement,
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
  const { t, format } = useText();
  const runtime = conversationRuntime(props);
  /**
   * An agent's record of a routine it created or changed is a card whose schedule the person can
   * change. Only a record from an agent turn has a `turnId`. A change the person made in the app
   * keeps the plain marker, so an edit on a card does not add a second card that replaces it. A
   * deleted routine also keeps the plain marker, because its schedule is not known.
   */
  const routineCardMarker = (message: AgentMessage | undefined, marker: ChatActionMarkerModel | undefined) =>
    message?.turnId && marker?.kind === "routine-lifecycle" ? marker : undefined;
  // "Show latest" moves focus to this card. The list mounts it only after the scroll.
  const [routineCardFocus, setRoutineCardFocus] = createSignal<string | null>(null);
  // The newest agent record of each routine is the one card that still edits it.
  const latestRoutineMessageIds = createMemo(() => {
    const latest = new Map<string, string>();
    for (const message of timelineMessages()) {
      const marker = routineCardMarker(message, message.actionMarker);
      if (marker) latest.set(marker.routineId, message.id);
    }
    return latest;
  });
  const routineCard = (message: AgentMessage | undefined, marker: ChatActionMarkerModel) => {
    const agentId = props.agent?.id;
    const cardMarker = routineCardMarker(message, marker);
    if (!cardMarker || cardMarker.action === "deleted" || !agentId) return undefined;
    const routine = props.routines?.find((candidate) => candidate.id === cardMarker.routineId);
    return routine && { action: cardMarker.action, routine, agentId };
  };
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
      <span class="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {keyedPrompt()
          ? t("prompt.inputRequiredAnnouncement", { question: keyedPrompt()?.prompt.questions[0]?.question ?? "" })
          : ""}
      </span>
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
          <Show when={props.loadingOlder || props.olderError}>
            <div class="conversation-history-status" role={props.olderError ? "alert" : "status"}>
              <Show when={props.olderError} fallback={t("chat.history.loadingOlder")}>
                <span>{props.olderError}</span>
                <Button type="button" variant="ghost" size="xs" onClick={() => props.onLoadOlder?.()}>
                  {t("common.retry")}
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
                const animateEntrance = untrack(
                  () => initialMessage.animate === true && markMessageSeen(initialMessage.id),
                );
                const initialActionMarker = untrack(() => initialMessage.actionMarker);
                /*
                 * The separator above the row. The first row always carries one, and a later row
                 * carries one when it opens a new day. A message with no stored timestamp can only
                 * open the transcript, so it falls back to the time it prints in its footer.
                 */
                const dayMarker = createMemo(() => {
                  const current = message();
                  if (!current) return null;
                  const previous = timelineMessages()[virtualRow.index - 1];
                  if (current.createdAt) return dayMarkerLabel(previous?.createdAt, current.createdAt, { t, format });
                  return previous === undefined ? (current.time ?? t("chat.day.now")) : null;
                });
                /*
                 * A row that continues a run by the same sender draws no time: the run carries one
                 * time at its top, and a header on every row leaves an empty line between them. A
                 * row that draws a marker of its own opens a run, because the marker stands between
                 * it and the message above it.
                 */
                const continuesRun = createMemo(() => {
                  const current = message();
                  if (!current) return false;
                  if (current.id === props.firstUnreadMessageId || current.actionMarker) return false;
                  const previous = timelineMessages()[virtualRow.index - 1];
                  return continuesSenderRun(previous, current, {
                    previousDrawsTime: previous !== undefined && rowDrawsTime(previous),
                    startsDay: dayMarker() !== null,
                  });
                });
                const markerOnly = untrack(() => markerOnlyMessage(initialMessage));
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
                            <Show
                              when={routineCard(message() ?? initialMessage, marker())}
                              fallback={
                                <ChatActionMarker
                                  onOpenSkill={props.server?.id === "local" ? openSkillSettings : undefined}
                                  marker={marker()}
                                  agents={props.agents}
                                  announce={animateEntrance}
                                  routineAvailable={routineMarkerAvailable(marker(), props.availableRoutineIds)}
                                  onSelectAgent={props.onSelectAgent}
                                  onOpenRoutine={openRoutineSettings}
                                  onOpenHostedSite={(url) => void openExternalMessageUrl(url)}
                                />
                              }
                            >
                              {(card) => {
                                const latestMessageId = () => latestRoutineMessageIds().get(card().routine.id);
                                const rowMessageId = () => message()?.id ?? initialMessage.id;
                                return (
                                  <RoutineChatCard
                                    action={card().action}
                                    routine={card().routine}
                                    agentId={card().agentId}
                                    latest={latestMessageId() === rowMessageId()}
                                    onOpenRoutine={openRoutineSettings}
                                    onShowLatest={
                                      props.onOpenSearchMessage
                                        ? () => {
                                            const messageId = latestMessageId();
                                            if (!messageId) return;
                                            setRoutineCardFocus(messageId);
                                            void props.onOpenSearchMessage?.(messageId);
                                          }
                                        : undefined
                                    }
                                    focusRequested={routineCardFocus() === rowMessageId()}
                                    onFocusHandled={() => setRoutineCardFocus(null)}
                                  />
                                );
                              }}
                            </Show>
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
                    data-grouped={groupedWithMarker() ? "marker" : continuesRun() ? "sender" : undefined}
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
                                onOpenSkill={props.server?.id === "local" ? openSkillSettings : undefined}
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
                              name:
                                message()?.author === "you"
                                  ? t("chat.message.you")
                                  : (props.agent?.name ?? t("chat.message.agentFallback")),
                            }}
                            showTime={!continuesRun()}
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
                            onDownloadAttachments={props.runtime ? undefined : downloadAttachments}
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
                  label={activity().label}
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
                  elementRef={setRequiredInteractionElement}
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
          <Show keyed when={props.approval}>
            {(approval) => (
              <Loading>
                <ApprovalCard
                  approval={approval}
                  agentName={props.agent?.name}
                  onApprove={() => props.onRespondToApproval("accept")}
                  onReject={() => props.onRespondToApproval("decline")}
                  onAlwaysAllow={props.onAlwaysAllowApproval}
                />
              </Loading>
            )}
          </Show>
          <Show when={props.browserTakeover}>
            <Loading>
              <BrowserTakeoverCard
                request={props.browserTakeover}
                agentName={props.agent?.name ?? "the agent"}
                tab={browserTakeoverTab()}
                preview={browserTakeoverPreview().preview}
                previewStatus={browserTakeoverPreview().status}
                onOpen={openBrowserTakeoverTab}
                onComplete={() => respondToBrowserTakeover("complete")}
                onCancel={() => respondToBrowserTakeover("cancel")}
                browserSecret={{
                  loadPreview: runtime.browser.capturePreview,
                  onRespond: runtime.agent.respondToBrowserSecret,
                }}
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

const ApprovalCard = lazy(() =>
  import("@openbot/ui/features/conversation/ConversationPrompts").then((module) => ({ default: module.ApprovalCard })),
);
const QuestionPromptBubble = lazy(() =>
  import("@openbot/ui/components/QuestionPromptBubble").then((module) => ({ default: module.QuestionPromptBubble })),
);
