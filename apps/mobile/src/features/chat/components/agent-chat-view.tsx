import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useAgentActivity } from "@/features/workspace/components/use-agent-activity";
import { type MobileAgent, useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { latestReadableMessage, projectChatMessages } from "../model/chat-messages";
import { uploadChatAttachments } from "../model/upload-chat-attachments";
import { ChatView } from "./chat-view";
import { useQuestionPrompt } from "./use-question-prompt";

export function MobileChatView({
  agent,
  animateAvatarOnExit = false,
}: {
  agent: MobileAgent;
  animateAvatarOnExit?: boolean;
}) {
  const {
    agents,
    conversationStore,
    servers,
    loadConversation,
    loadOlderMessages,
    markAgentRead,
    respondToPrompt,
    sendMessage,
    uploadAttachment,
    discardAttachment,
  } = useMobileWorkspace();
  const subscribe = useCallback(
    (notify: () => void) => conversationStore.subscribe(agent.id, notify),
    [agent.id, conversationStore],
  );
  const snapshot = useCallback(() => conversationStore.get(agent.id), [agent.id, conversationStore]);
  const conversation = useSyncExternalStore(subscribe, snapshot);
  const serverAgents = useMemo(
    () => agents.filter((item) => item.serverId === agent.serverId),
    [agents, agent.serverId],
  );
  const mentionAgents = useMemo(() => serverAgents.filter((item) => item.id !== agent.id), [serverAgents, agent.id]);
  const messages = useMemo(() => projectChatMessages(conversation?.messages ?? []), [conversation?.messages]);
  const references = useMemo(
    () => projectChatMessages(Object.values(conversation?.references ?? {})),
    [conversation?.references],
  );
  const activity = useAgentActivity(agent.id);
  const online = servers.find((item) => item.id === agent.serverId)?.state === "online";
  const [historyLoadFailed, setHistoryLoadFailed] = useState(false);
  const request = useRef(0);
  const fetchHistory = useCallback(() => {
    if (!online) return;
    const id = ++request.current;
    setHistoryLoadFailed(false);
    void loadConversation(agent.id).catch(() => {
      if (request.current === id) setHistoryLoadFailed(true);
    });
  }, [agent.id, online, loadConversation]);
  useEffect(() => {
    fetchHistory();
    return () => {
      request.current += 1;
    };
  }, [fetchHistory]);
  const latest = latestReadableMessage(conversation?.messages ?? []);
  const latestId = latest?.id;
  const markRead = useCallback(() => {
    if (latestId) markAgentRead(agent.id, latestId);
  }, [agent.id, latestId, markAgentRead]);
  const activePrompt = messages.findLast(
    (message) =>
      message.kind === "question" &&
      !message.prompt.resolution &&
      Boolean(conversation?.activeTurnId) &&
      message.turnId === conversation?.activeTurnId,
  );
  const questionForm = useQuestionPrompt(
    agent.id,
    activePrompt?.kind === "question" ? activePrompt : undefined,
    online,
    respondToPrompt,
  );
  return (
    <ChatView
      target={{ ...agent, kind: "agent" }}
      animateAvatarOnExit={animateAvatarOnExit}
      agents={serverAgents}
      mentionAgents={mentionAgents}
      projectedMessages={messages}
      referenceMessages={references}
      ready={Boolean(conversation)}
      historyLoadFailed={historyLoadFailed}
      canSend={online}
      activity={activity}
      activeTurnId={conversation?.activeTurnId ?? null}
      questionForm={questionForm}
      readBoundary={latest ? `${latest.id}:${latest.status}` : null}
      markRead={markRead}
      fetchHistory={fetchHistory}
      hasOlder={conversation?.pageInfo.hasOlder ?? false}
      olderLoading={conversation?.olderLoading ?? false}
      olderError={conversation?.olderError ?? false}
      loadOlder={() => {
        void loadOlderMessages(agent.id);
      }}
      send={(body, files, replyToMessageId) =>
        uploadChatAttachments(files, {
          upload: (file) => uploadAttachment(agent.id, file),
          discard: (id) => discardAttachment(agent.id, id),
          send: (ids) => sendMessage(agent.id, body, ids, replyToMessageId),
        })
      }
    />
  );
}
