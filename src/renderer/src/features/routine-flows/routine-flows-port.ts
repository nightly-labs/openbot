import type {
  AgentEvent,
  ConversationPage,
  OpenBotDesktopApi,
  StopRoutineFlowRunInput,
  TeamRealtimeEvent,
  TestRoutineInput,
  UpdateRoutineInput,
} from "@openbot/contracts/ipc";
import { desktopEventRoutinesApi, type EventRoutinesApi } from "../conversation/routine-webhooks-api";

export interface RoutineFlowsHost {
  flows: Omit<OpenBotDesktopApi["routineFlows"], "stopRun">;
  readonly stopRun: ((input: StopRoutineFlowRunInput) => Promise<void>) | undefined;
  routines: {
    update(input: UpdateRoutineInput): Promise<unknown>;
    test(input: TestRoutineInput): Promise<unknown>;
  };
  readonly webhooks: Pick<EventRoutinesApi, "getStatus" | "saveRoutine" | "rotateSecret" | "testRoutine"> | undefined;
  conversation: {
    send(input: { agentId: string; text: string; clientMessageId: string }): Promise<string | null>;
    page(agentId: string, aroundMessageId?: string): Promise<ConversationPage>;
  };
  onEvent(listener: (event: AgentEvent | TeamRealtimeEvent) => void): () => void;
  openUrl(url: string): Promise<void>;
}

export function desktopRoutineFlowsHost(
  serverId: string,
  webhooks: () => boolean,
  stops: () => boolean,
): RoutineFlowsHost {
  const flows = () => window.openbot.routineFlows;
  const agent = () => window.openbot.agent;
  return {
    flows: {
      canvas: (agentId) => flows().canvas(agentId, serverId),
      savePosition: (input) => flows().savePosition(input, serverId),
      removePosition: (input) => flows().removePosition(input, serverId),
      connect: (input) => flows().connect(input, serverId),
      disconnect: (input) => flows().disconnect(input, serverId),
      updateLink: (input) => flows().updateLink(input, serverId),
    },
    get stopRun() {
      return stops() ? (input: StopRoutineFlowRunInput) => flows().stopRun(input, serverId) : undefined;
    },
    routines: {
      update: (input) => agent().updateRoutine(input, serverId),
      test: (input) => agent().testRoutine(input, serverId),
    },
    get webhooks() {
      return webhooks() ? desktopEventRoutinesApi(serverId) : undefined;
    },
    conversation: {
      send: async ({ agentId, text, clientMessageId }) => {
        const receipt = await agent().sendMessage({ agentId, text, clientMessageId }, serverId);
        return receipt.deliveries.find((delivery) => delivery.recipientAgentId === agentId)?.id ?? null;
      },
      page: (agentId, aroundMessageId) =>
        agent().readConversationPage(
          { agentId, ...(aroundMessageId ? { anchor: { type: "around", messageId: aroundMessageId } } : {}) },
          serverId,
        ),
    },
    onEvent: (listener) =>
      agent().onScopedEvent((scoped) => {
        if (scoped.serverId === serverId) listener(scoped.event);
      }),
    openUrl: (url) => window.openbot.openUrl(url),
  };
}
