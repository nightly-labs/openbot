import {
  type AgentEvent,
  agentPermissionLevel,
  agentPermissionUpdate,
  type ConversationMessage,
  type ConversationSnapshot,
  type RespondToApprovalInput,
  type RespondToPromptInput,
} from "@openbot/contracts/ipc";
import type { AgentMessage } from "@openbot/ui/data";
import { createEffect, createMemo, createProjection, createSignal, mapArray } from "solid-js";
import { toAgentMessage, toAgentMessages } from "../../app-message-projection";
import type { createRemoteAgentAdmin } from "../agents/remote-agent-admin";
import { messagePromptRequestKey, promptRequestKey } from "../conversation/conversation-keys";
import type { PromptAnswerOptions } from "../conversation/conversation-types";
import type { WebWorkspace } from "./web-client-context";

type PromptEvent = Extract<AgentEvent, { type: "prompt" }>;

/** The host names attachment previews with the desktop `openbot-attachment:` scheme, which a browser cannot load. */
function withoutPreviewUrls(message: AgentMessage): AgentMessage {
  if (!message.attachments) return message;
  return { ...message, attachments: message.attachments.map((attachment) => ({ ...attachment, previewUrl: null })) };
}

/** The selected agent's messages, and the prompt and approval that wait for the user. */
export function createWebConversationView(options: {
  workspace: Pick<WebWorkspace, "state" | "selected" | "conversation" | "answer" | "approve">;
  remoteAgentAdmin: Pick<ReturnType<typeof createRemoteAgentAdmin>, "settings" | "update">;
  /** True when the agent form or a channel covers the conversation. */
  hidden: () => boolean;
  /** The open side thread's conversation, null when it has none, or undefined for the agent's own chat. */
  thread: () => ConversationSnapshot | null | undefined;
}) {
  const { workspace, remoteAgentAdmin } = options;
  const approval = createMemo(() =>
    workspace.state.approvals.find(
      (item) => item.agentId === workspace.state.selectedId && item.threadId === workspace.selected()?.threadId,
    ),
  );
  /**
   * "Always allow" moves an agent at Ask first to Full access, for an owner or admin whose host
   * answered. The change is written on the host. This card is answered first: the grant answers every
   * card that still waits, so an answer sent after it would find this one gone.
   */
  const alwaysAllowApproval = createMemo(() => {
    const agent = workspace.selected();
    const item = approval();
    const settings = remoteAgentAdmin.settings();
    if (!agent || !item || !settings || agentPermissionLevel(settings) !== "ask") return undefined;
    return async () => {
      await workspace.approve({ requestId: item.requestId, decision: "accept" });
      await remoteAgentAdmin.update(agentPermissionUpdate(agent.id, "full"));
      return true;
    };
  });
  /**
   * As on desktop: an answered prompt stays until its bubble has shown the answers. After that, a
   * snapshot or page that the host made before it had the answer does not open the prompt again.
   */
  const [answeredPrompt, setAnsweredPrompt] = createSignal<{ prompt: PromptEvent; presented: boolean }>();
  const isAnswered = (turnId: string, requestId: string | number) => {
    const answered = answeredPrompt()?.prompt;
    return answered?.turnId === turnId && String(answered.requestId) === String(requestId);
  };
  // The bubble unmounts with its conversation and then cannot report that it showed the answers.
  createEffect(
    () => ({ agentId: workspace.state.selectedId, hidden: options.hidden() }),
    () => setAnsweredPrompt(undefined),
  );
  /** The conversation whose question shows: the open side thread, or the agent's own chat. */
  const promptPage = () => {
    const thread = options.thread();
    return thread === undefined ? workspace.conversation()?.page : thread;
  };
  const prompt = createMemo<PromptEvent | undefined>(() => {
    if (workspace.state.status !== "online") return;
    const page = promptPage();
    if (!page?.threadId) return;
    const pending = workspace.state.prompts.find(
      (item) =>
        item.agentId === page.agentId && item.threadId === page.threadId && !isAnswered(item.turnId, item.requestId),
    );
    if (pending) return pending;
    const answered = answeredPrompt();
    if (
      answered &&
      !answered.presented &&
      answered.prompt.agentId === page.agentId &&
      answered.prompt.threadId === page.threadId
    )
      return answered.prompt;
    const activeTurnId = page.activeTurnId;
    const message = page.messages.findLast(
      (item) =>
        item.turnId === activeTurnId &&
        item.questionPrompt &&
        !item.questionPrompt.resolution &&
        !(activeTurnId && isAnswered(activeTurnId, item.questionPrompt.requestId)),
    );
    if (!message?.questionPrompt || !page.activeTurnId) return;
    return {
      type: "prompt",
      agentId: page.agentId,
      threadId: page.threadId,
      turnId: page.activeTurnId,
      requestId: message.questionPrompt.requestId,
      questions: message.questionPrompt.questions,
    };
  });
  const storedMessages = () => workspace.conversation()?.page?.messages ?? [];
  const row = (message: ConversationMessage) =>
    withoutPreviewUrls(toAgentMessage(message, workspace.state.selectedId ?? undefined));
  /**
   * One row per stored message, each in its own memo: a stream chunk changes the text of one message,
   * and only that message is converted again.
   */
  const rows = mapArray(storedMessages, (message) => createMemo(() => row(message())), {
    keyed: (message) => message.id,
  });
  /** The rows, with the thinking of a turn joined. The result is reconciled by id, so the other messages keep their rows. */
  const messages = createProjection<AgentMessage[]>(
    () => {
      const converted = rows();
      return toAgentMessages(
        storedMessages(),
        workspace.state.selectedId ?? undefined,
        (message, index) => converted[index]?.() ?? row(message),
      );
    },
    [],
    { key: "id" },
  );
  /** The interactive block of the waiting prompt's message, when the agent asked with one. */
  const promptUiBlock = createMemo(() => {
    const question = prompt();
    const page = promptPage();
    if (!question || !page) return undefined;
    const requestKey = promptRequestKey(question.turnId, question.requestId);
    return page.messages.findLast((message) => messagePromptRequestKey(message) === requestKey)?.uiBlock;
  });
  /** The replied-to messages that are not on the loaded pages. The host sends them with each page. */
  const messageReferences = createMemo(() => {
    const page = workspace.conversation()?.page;
    if (!page) return {};
    return Object.fromEntries(
      Object.entries(page.references).map(([id, reference]) => [
        id,
        withoutPreviewUrls(toAgentMessage(reference, page.agentId)),
      ]),
    );
  });
  const missingMessageReferences = () => workspace.conversation()?.missingReferences;
  async function answerPrompt(
    answers: RespondToPromptInput["answers"],
    options?: PromptAnswerOptions,
  ): Promise<boolean> {
    const question = prompt();
    if (!question) return false;
    setAnsweredPrompt({ prompt: question, presented: false });
    try {
      await workspace.answer({ requestId: question.requestId, answers });
    } catch (error) {
      setAnsweredPrompt(undefined);
      if (!options?.onError) throw error;
      options.onError(error);
      return false;
    }
    return true;
  }
  function presentPromptResolution(turnId: string, requestId: string | number): void {
    const answered = answeredPrompt();
    if (answered && isAnswered(turnId, requestId)) setAnsweredPrompt({ ...answered, presented: true });
  }
  async function respondToApproval(decision: RespondToApprovalInput["decision"]): Promise<boolean> {
    const item = approval();
    if (!item) return false;
    await workspace.approve({ requestId: item.requestId, decision });
    return true;
  }
  /** Forgets the answered prompt, for a host change. */
  function reset(): void {
    setAnsweredPrompt(undefined);
  }
  return {
    approval,
    alwaysAllowApproval,
    prompt,
    promptUiBlock,
    messages,
    messageReferences,
    missingMessageReferences,
    answerPrompt,
    presentPromptResolution,
    respondToApproval,
    reset,
  };
}
