import { CHAT_VISUAL_ITEM_TYPE_PREFIX } from "@openbot/contracts/chat-visual";
import type {
  AgentEvent,
  AgentRuntimeWorkItem,
  DynamicIslandAction,
  DynamicIslandPresentation,
  QueueSnapshot,
  ScopedAgentEvent,
} from "@openbot/contracts/ipc";
import { cleanAgentMessageText } from "./agent-message-text";
import {
  countDynamicIslandAttention,
  createDynamicIslandPresentation,
  type DynamicIslandMessageSource,
  type DynamicIslandPresentationInput,
  type DynamicIslandText,
  selectDynamicIslandPresentation,
} from "./dynamic-island-presentation";

type ServerRuntime = DynamicIslandPresentationInput & {
  turnProgress: Record<string, { turnId: string; detail: string; running?: boolean; activity?: string } | undefined>;
  incomingMessageAnchors: Map<string, string>;
  completedAgents: Set<string>;
  lastRecordedMessageIds: Map<string, string>;
  turnReplies: Map<string, { turnId: string; count: number }>;
  receivedConversations: Set<string>;
  resolvedPrompts: Map<string, string>;
  dismissedFailures: Map<string, string>;
  rawMessageBodies: Map<string, string>;
  /** The agent ids that this member muted. The island does not show them, also when their notifications are on. */
  memberMutedAgentIds: Set<string>;
  receivedRuntimeSnapshot: boolean;
};

export class DynamicIslandCoordinator {
  readonly #servers = new Map<string, ServerRuntime>();
  readonly #text: () => DynamicIslandText;

  constructor(text: () => DynamicIslandText) {
    this.#text = text;
  }

  serverState(
    serverId: string,
  ):
    | (Pick<
        DynamicIslandPresentationInput,
        "activeTurns" | "queues" | "pendingPrompts" | "pendingApprovals" | "failedTurns"
      > & { turnProgress: ServerRuntime["turnProgress"] })
    | null {
    const runtime = this.#servers.get(serverId);
    if (!runtime) return null;
    return structuredClone({
      activeTurns: runtime.activeTurns,
      turnProgress: runtime.turnProgress,
      queues: runtime.queues,
      pendingPrompts: runtime.pendingPrompts,
      pendingApprovals: runtime.pendingApprovals,
      failedTurns: runtime.failedTurns,
    });
  }

  replaceServer(input: DynamicIslandPresentationInput): void {
    const previous = this.#servers.get(input.serverId);
    const turnProgress = { ...previous?.turnProgress };
    for (const [agentId, progress] of Object.entries(turnProgress)) {
      if (!progress || input.activeTurns[agentId] !== progress.turnId) delete turnProgress[agentId];
    }
    const resolvedPrompts = previous?.resolvedPrompts ?? new Map();
    const pendingApprovals = { ...input.pendingApprovals };
    const pendingPrompts = { ...input.pendingPrompts };
    for (const [agentId, requestId] of resolvedPrompts) {
      const prompt = pendingPrompts[agentId];
      if (prompt?.type === "prompt" && String(prompt.requestId) === requestId) pendingPrompts[agentId] = undefined;
      else resolvedPrompts.delete(agentId);
    }
    const dismissedFailures = previous?.dismissedFailures ?? new Map();
    for (const [agentId, turnId] of dismissedFailures) {
      if (input.failedTurns[agentId] !== turnId) dismissedFailures.delete(agentId);
    }
    const agentIds = new Set(input.agents.map((agent) => agent.id));
    const memberMutedAgentIds = new Set(previous?.memberMutedAgentIds);
    for (const agentId of memberMutedAgentIds) if (!agentIds.has(agentId)) memberMutedAgentIds.delete(agentId);
    const incomingMessageAnchors = activeMessageAnchors(input.liveMessages, previous?.incomingMessageAnchors);
    const completedAgents = new Set(previous?.completedAgents);
    const lastRecordedMessageIds = new Map(previous?.lastRecordedMessageIds);
    const turnReplies = new Map(previous?.turnReplies);
    for (const agentId of turnReplies.keys()) if (!agentIds.has(agentId)) turnReplies.delete(agentId);
    for (const agentId of incomingMessageAnchors.keys())
      if (!agentIds.has(agentId)) incomingMessageAnchors.delete(agentId);
    for (const agentId of completedAgents) if (!agentIds.has(agentId)) completedAgents.delete(agentId);
    for (const agentId of lastRecordedMessageIds.keys())
      if (!agentIds.has(agentId)) lastRecordedMessageIds.delete(agentId);
    const receivedConversations = [...(previous?.receivedConversations ?? [])].filter((agentId) =>
      agentIds.has(agentId),
    );
    const liveMessages = compactLiveMessages(input.liveMessages);
    const rawMessageBodies = new Map(previous?.rawMessageBodies);
    const retainedMessageKeys = new Set<string>();
    for (const [agentId, messages] of Object.entries(liveMessages)) {
      for (const message of messages) {
        const key = dynamicIslandMessageKey(agentId, message.id);
        retainedMessageKeys.add(key);
        if (!rawMessageBodies.has(key)) rawMessageBodies.set(key, message.body);
      }
    }
    for (const key of rawMessageBodies.keys()) {
      if (!retainedMessageKeys.has(key)) rawMessageBodies.delete(key);
    }
    this.#servers.set(input.serverId, {
      ...input,
      activeTurns: { ...input.activeTurns },
      queues: { ...input.queues },
      unreadReplies: { ...input.unreadReplies },
      failedTurns: { ...input.failedTurns },
      ...(input.unreadMessageIds ? { unreadMessageIds: { ...input.unreadMessageIds } } : {}),
      turnProgress,
      pendingApprovals,
      pendingPrompts,
      liveMessages,
      incomingMessageAnchors,
      completedAgents,
      lastRecordedMessageIds,
      turnReplies,
      receivedConversations: new Set([...receivedConversations, ...Object.keys(input.liveMessages)]),
      resolvedPrompts,
      dismissedFailures,
      rawMessageBodies,
      memberMutedAgentIds,
      receivedRuntimeSnapshot: previous?.receivedRuntimeSnapshot ?? false,
    });
  }

  replaceUnreadReplies(serverId: string, unreadReplies: Record<string, number>): void {
    const runtime = this.#runtime(serverId);
    runtime.unreadReplies = { ...unreadReplies };
    runtime.unreadMessageIds = Object.fromEntries(
      Object.entries(runtime.unreadMessageIds ?? {}).filter(([agentId]) => (unreadReplies[agentId] ?? 0) > 0),
    );
  }

  setMemberMutedAgentIds(serverId: string, agentIds: Iterable<string>): void {
    this.#runtime(serverId).memberMutedAgentIds = new Set(agentIds);
  }

  mutedAgentIds(serverId: string): ReadonlySet<string> {
    const runtime = this.#servers.get(serverId);
    const agents = runtime?.agents ?? [];
    const set = new Set(agents.filter((agent) => !agent.notifications).map((agent) => agent.id));
    for (const agentId of runtime?.memberMutedAgentIds ?? []) set.add(agentId);
    return set;
  }

  retainServers(serverIds: readonly string[]): void {
    const retained = new Set(serverIds);
    for (const serverId of this.#servers.keys()) {
      if (!retained.has(serverId)) this.#servers.delete(serverId);
    }
  }

  applyEvent({ serverId, event, bufferedLive }: ScopedAgentEvent, activeServerId: string): void {
    const runtime = this.#runtime(serverId);
    switch (event.type) {
      case "agents-changed":
        runtime.agents = event.agents;
        this.#retainAgentMessages(runtime, new Set(event.agents.map((agent) => agent.id)));
        return;
      case "runtime-snapshot":
        this.#replaceRuntimeSnapshot(serverId, runtime, event.snapshot, serverId !== activeServerId);
        return;
      case "conversation": {
        runtime.activeTurns[event.snapshot.agentId] = event.snapshot.activeTurnId;
        const progress = runtime.turnProgress[event.snapshot.agentId];
        if (progress && progress.turnId !== event.snapshot.activeTurnId)
          delete runtime.turnProgress[event.snapshot.agentId];
        deleteDynamicIslandMessageBodies(runtime.rawMessageBodies, event.snapshot.agentId);
        for (const message of event.snapshot.messages) {
          const key = dynamicIslandMessageKey(event.snapshot.agentId, message.id);
          if (message.author !== "user" && message.status === "streaming") {
            runtime.rawMessageBodies.set(key, message.text);
          } else runtime.rawMessageBodies.delete(key);
        }
        const messages = event.snapshot.messages.flatMap(toDynamicIslandMessage);
        const anchorId = runtime.incomingMessageAnchors.get(event.snapshot.agentId);
        const receivedConversation = runtime.receivedConversations.has(event.snapshot.agentId);
        const latest = messages.at(-1);
        if (latest) runtime.liveMessages[event.snapshot.agentId] = [latest];
        else if (event.snapshot.messages.length === 0) runtime.liveMessages[event.snapshot.agentId] = [];
        if (serverId !== activeServerId) {
          if (anchorId) {
            const anchorIndex = messages.findIndex((message) => message.id === anchorId);
            if (anchorIndex >= 0) {
              const incoming = messages.slice(anchorIndex + 1);
              this.#recordIncoming(
                runtime,
                event.snapshot.agentId,
                incoming.length > 0 ? incoming : bufferedLive && latest ? [latest] : [],
              );
            }
          } else if (receivedConversation) this.#recordIncoming(runtime, event.snapshot.agentId, messages);
          else if (bufferedLive && latest) this.#recordIncoming(runtime, event.snapshot.agentId, [latest]);
        }
        if (latest) runtime.incomingMessageAnchors.set(event.snapshot.agentId, latest.id);
        else if (event.snapshot.messages.length === 0) runtime.incomingMessageAnchors.delete(event.snapshot.agentId);
        runtime.receivedConversations.add(event.snapshot.agentId);
        return;
      }
      case "conversation-delta": {
        const messages = runtime.liveMessages[event.agentId] ?? [];
        const existing = messages.find((message) => message.id === event.messageId);
        if (existing) {
          const key = dynamicIslandMessageKey(event.agentId, event.messageId);
          const rawBody = (runtime.rawMessageBodies.get(key) ?? existing.body) + event.delta;
          runtime.rawMessageBodies.set(key, rawBody);
          existing.body = cleanAgentMessageText(rawBody);
        }
        return;
      }
      case "queue-changed":
        runtime.queues[event.snapshot.agentId] = event.snapshot;
        return;
      case "turn-started":
        runtime.completedAgents.delete(event.agentId);
        runtime.activeTurns[event.agentId] = event.turnId;
        delete runtime.turnProgress[event.agentId];
        delete runtime.failedTurns[event.agentId];
        return;
      case "turn-progress":
        runtime.turnProgress[event.agentId] = {
          turnId: event.turnId,
          detail: cleanAgentMessageText(event.detail),
          ...(event.running ? { running: true } : {}),
          ...(event.activity ? { activity: event.activity } : {}),
        };
        return;
      case "turn-completed":
        if (
          serverId !== activeServerId &&
          event.status === "completed" &&
          !event.quiet &&
          runtime.activeTurns[event.agentId] === event.turnId
        ) {
          runtime.completedAgents.add(event.agentId);
        }
        if (event.quiet && serverId !== activeServerId) this.#takeBackTurnReplies(runtime, event.agentId, event.turnId);
        runtime.turnReplies.delete(event.agentId);
        runtime.activeTurns[event.agentId] = null;
        this.#endTurnDeliveries(runtime, event.agentId, event.turnId);
        if (runtime.turnProgress[event.agentId]?.turnId === event.turnId) delete runtime.turnProgress[event.agentId];
        runtime.pendingPrompts[event.agentId] = undefined;
        runtime.pendingApprovals[event.agentId] = undefined;
        if (event.status === "failed") runtime.failedTurns[event.agentId] = event.turnId;
        else delete runtime.failedTurns[event.agentId];
        return;
      case "prompt":
        runtime.resolvedPrompts.delete(event.agentId);
        runtime.pendingPrompts[event.agentId] = event;
        return;
      case "agent-input-resolved":
        if (event.kind === "prompt") {
          const prompt = runtime.pendingPrompts[event.agentId];
          if (prompt?.type === "prompt" && String(prompt.requestId) === String(event.requestId)) {
            runtime.pendingPrompts[event.agentId] = undefined;
            runtime.resolvedPrompts.set(event.agentId, String(event.requestId));
          }
        } else {
          const approval = runtime.pendingApprovals[event.agentId];
          if (approval && String(approval.requestId) === String(event.requestId)) {
            runtime.pendingApprovals[event.agentId] = undefined;
          }
        }
        return;
      case "approval":
        runtime.pendingApprovals[event.approval.agentId] = event.approval;
        return;
      case "browser-takeover-requested":
        runtime.pendingPrompts[event.request.agentId] = event;
        return;
      case "browser-takeover-resolved": {
        const pending = runtime.pendingPrompts[event.agentId];
        if (pending?.type === "browser-takeover-requested" && pending.request.requestId === event.requestId) {
          runtime.pendingPrompts[event.agentId] = undefined;
        }
        return;
      }
      default:
        return;
    }
  }

  resolveAction(action: DynamicIslandAction): void {
    if (action.type === "open-app") return;
    const runtime = this.#servers.get(action.serverId);
    if (!runtime) return;
    if (action.type === "answer-prompt") {
      const prompt = runtime.pendingPrompts[action.agentId];
      if (prompt?.type === "prompt" && String(prompt.requestId) === String(action.requestId)) {
        runtime.pendingPrompts[action.agentId] = undefined;
        runtime.resolvedPrompts.set(action.agentId, String(action.requestId));
      }
    }
    if (action.type === "respond-approval") {
      const approval = runtime.pendingApprovals[action.agentId];
      if (approval && String(approval.requestId) === String(action.requestId)) {
        runtime.pendingApprovals[action.agentId] = undefined;
      }
    }
    if (action.type === "open-failure" && runtime.failedTurns[action.agentId] === action.turnId) {
      delete runtime.failedTurns[action.agentId];
    }
    if (action.type === "dismiss-failure" && runtime.failedTurns[action.agentId] === action.turnId) {
      runtime.dismissedFailures.set(action.agentId, action.turnId);
    }
  }

  requestThreadId(presentation: DynamicIslandPresentation): string | null {
    if (presentation.mode !== "question" && presentation.mode !== "approval" && presentation.mode !== "takeover")
      return null;
    const runtime = this.#servers.get(presentation.serverId);
    if (!runtime) return null;
    const { agent, requestId } = presentation.item;
    const same = (other: string | number) => String(other) === String(requestId);
    if (presentation.mode === "approval") {
      const approval = runtime.pendingApprovals[agent.id];
      return approval && same(approval.requestId) ? approval.threadId : null;
    }
    const pending = runtime.pendingPrompts[agent.id];
    if (pending?.type === "prompt")
      return presentation.mode === "question" && same(pending.requestId) ? pending.threadId : null;
    if (pending?.type === "browser-takeover-requested")
      return presentation.mode === "takeover" && same(pending.request.requestId) ? pending.request.threadId : null;
    return null;
  }

  workingTurn(presentation: DynamicIslandPresentation): { agentId: string; turnId: string } | null {
    if (presentation.mode !== "working") return null;
    const agentId = presentation.working[0]?.agent.id;
    const runtime = this.#servers.get(presentation.serverId);
    if (!agentId || !runtime) return null;
    const running = runtime.queues[agentId]?.deliveries.find(
      (delivery) => delivery.status === "starting" || delivery.status === "running",
    );
    const turnId = running?.turnId ?? runtime.activeTurns[agentId] ?? null;
    return turnId ? { agentId, turnId } : null;
  }

  presentation(serverOrder: readonly string[]): DynamicIslandPresentation {
    const text = this.#text();
    let attentionCount = 0;
    const ordered = serverOrder.flatMap((serverId) => {
      const stored = this.#servers.get(serverId);
      if (!stored) return [];
      const muted = this.mutedAgentIds(serverId);
      const runtime = {
        ...stored,
        agents: stored.agents.filter((agent) => !muted.has(agent.id)),
        failedTurns: undismissedFailures(stored),
      };
      attentionCount += countDynamicIslandAttention(runtime, text);
      return [createDynamicIslandPresentation(runtime, text)];
    });
    return selectDynamicIslandPresentation(ordered, attentionCount);
  }

  #runtime(serverId: string): ServerRuntime {
    const existing = this.#servers.get(serverId);
    if (existing) return existing;
    const runtime: ServerRuntime = {
      serverId,
      agents: [],
      activeTurns: {},
      turnProgress: {},
      queues: {},
      unreadReplies: {},
      unreadMessageIds: {},
      liveMessages: {},
      pendingPrompts: {},
      pendingApprovals: {},
      failedTurns: {},
      incomingMessageAnchors: new Map(),
      completedAgents: new Set(),
      lastRecordedMessageIds: new Map(),
      turnReplies: new Map(),
      receivedConversations: new Set(),
      resolvedPrompts: new Map(),
      dismissedFailures: new Map(),
      memberMutedAgentIds: new Set(),
      rawMessageBodies: new Map(),
      receivedRuntimeSnapshot: false,
    };
    this.#servers.set(serverId, runtime);
    return runtime;
  }

  #recordIncoming(runtime: ServerRuntime, agentId: string, messages: DynamicIslandMessageSource[]): void {
    for (const message of messages) {
      if (message.author !== "agent") continue;
      if (runtime.lastRecordedMessageIds.get(agentId) === message.id) continue;
      runtime.unreadReplies[agentId] = (runtime.unreadReplies[agentId] ?? 0) + 1;
      runtime.unreadMessageIds ??= {};
      runtime.unreadMessageIds[agentId] ??= message.id;
      runtime.lastRecordedMessageIds.set(agentId, message.id);
      const turnId = runtime.activeTurns[agentId];
      if (!turnId) continue;
      const replies = runtime.turnReplies.get(agentId);
      runtime.turnReplies.set(agentId, { turnId, count: replies?.turnId === turnId ? replies.count + 1 : 1 });
    }
  }

  #takeBackTurnReplies(runtime: ServerRuntime, agentId: string, turnId: string): void {
    const replies = runtime.turnReplies.get(agentId);
    if (replies?.turnId !== turnId) return;
    const unread = (runtime.unreadReplies[agentId] ?? 0) - replies.count;
    if (unread > 0) {
      runtime.unreadReplies[agentId] = unread;
      return;
    }
    delete runtime.unreadReplies[agentId];
    if (runtime.unreadMessageIds) delete runtime.unreadMessageIds[agentId];
  }

  #endTurnDeliveries(runtime: ServerRuntime, agentId: string, turnId: string): void {
    const queue = runtime.queues[agentId];
    if (!queue) return;
    const ended = (delivery: QueueSnapshot["deliveries"][number]) =>
      (delivery.status === "starting" || delivery.status === "running") &&
      (delivery.turnId === null || delivery.turnId === turnId);
    if (!queue.deliveries.some(ended)) return;
    runtime.queues[agentId] = { ...queue, deliveries: queue.deliveries.filter((delivery) => !ended(delivery)) };
  }

  #retainAgentMessages(runtime: ServerRuntime, agentIds: ReadonlySet<string>): void {
    for (const agentId of runtime.incomingMessageAnchors.keys()) {
      if (!agentIds.has(agentId)) runtime.incomingMessageAnchors.delete(agentId);
    }
    for (const agentId of runtime.completedAgents) if (!agentIds.has(agentId)) runtime.completedAgents.delete(agentId);
    for (const agentId of runtime.lastRecordedMessageIds.keys()) {
      if (!agentIds.has(agentId)) runtime.lastRecordedMessageIds.delete(agentId);
    }
    for (const agentId of runtime.turnReplies.keys()) if (!agentIds.has(agentId)) runtime.turnReplies.delete(agentId);
    for (const agentId of runtime.receivedConversations) {
      if (!agentIds.has(agentId)) runtime.receivedConversations.delete(agentId);
    }
    for (const agentId of Object.keys(runtime.liveMessages)) {
      if (!agentIds.has(agentId)) delete runtime.liveMessages[agentId];
    }
    for (const key of runtime.rawMessageBodies.keys()) {
      if (!agentIds.has(key.slice(0, key.indexOf("\0")))) runtime.rawMessageBodies.delete(key);
    }
  }

  #replaceRuntimeSnapshot(
    serverId: string,
    runtime: ServerRuntime,
    snapshot: Extract<AgentEvent, { type: "runtime-snapshot" }>["snapshot"],
    trackIncoming: boolean,
  ): void {
    const liveMessages: Record<string, DynamicIslandMessageSource[]> = {};
    const incomingMessageAnchors = new Map(runtime.incomingMessageAnchors);
    for (const message of snapshot.latestMessages) {
      const body = cleanAgentMessageText(message.text);
      const current = runtime.liveMessages[message.agentId]?.find((candidate) => candidate.id === message.id);
      const converted =
        current && current.body.length > body.length
          ? current
          : { id: message.id, author: "agent", body, time: message.createdAt, createdAt: message.createdAt };
      if (converted !== current) {
        runtime.rawMessageBodies.set(dynamicIslandMessageKey(message.agentId, message.id), message.text);
      }
      liveMessages[message.agentId] = [converted];
      incomingMessageAnchors.set(message.agentId, message.id);
      if (!trackIncoming) continue;
      if (
        runtime.completedAgents.has(message.agentId) ||
        (runtime.receivedRuntimeSnapshot && runtime.incomingMessageAnchors.get(message.agentId) !== message.id)
      ) {
        this.#recordIncoming(runtime, message.agentId, [converted]);
      }
    }
    runtime.completedAgents.clear();
    const pendingPrompts: DynamicIslandPresentationInput["pendingPrompts"] = snapshot.attentionComplete
      ? {}
      : { ...runtime.pendingPrompts };
    for (const prompt of snapshot.pendingPrompts) pendingPrompts[prompt.agentId] = { type: "prompt", ...prompt };
    for (const request of snapshot.pendingBrowserTakeovers) {
      pendingPrompts[request.agentId] = { type: "browser-takeover-requested", request };
    }
    const knownColors = new Map(runtime.agents.map((agent) => [agent.id, agent.avatarColor] as const));
    this.replaceServer({
      serverId,
      agents: snapshot.agents.map((agent) => {
        const avatarColor = knownColors.get(agent.id);
        return avatarColor ? { ...agent, avatarColor } : agent;
      }),
      activeTurns: Object.fromEntries(snapshot.activeTurns.map((turn) => [turn.agentId, turn.turnId])),
      queues: queueSnapshotsFromRuntimeWork(snapshot.work),
      unreadReplies: { ...runtime.unreadReplies },
      unreadMessageIds: { ...runtime.unreadMessageIds },
      liveMessages,
      pendingPrompts,
      pendingApprovals: {
        ...(snapshot.attentionComplete ? {} : runtime.pendingApprovals),
        ...Object.fromEntries(snapshot.pendingApprovals.map((approval) => [approval.agentId, approval])),
      },
      failedTurns: Object.fromEntries(snapshot.failedTurns.map((turn) => [turn.agentId, turn.turnId])),
    });
    const nextRuntime = this.#runtime(serverId);
    nextRuntime.incomingMessageAnchors = incomingMessageAnchors;
    nextRuntime.receivedRuntimeSnapshot = true;
  }
}

function undismissedFailures(runtime: ServerRuntime): ServerRuntime["failedTurns"] {
  return Object.fromEntries(
    Object.entries(runtime.failedTurns).filter(
      ([agentId, turnId]) => runtime.dismissedFailures.get(agentId) !== turnId,
    ),
  );
}

function dynamicIslandMessageKey(agentId: string, messageId: string): string {
  return `${agentId}\0${messageId}`;
}

function deleteDynamicIslandMessageBodies(messages: Map<string, string>, agentId: string): void {
  const prefix = `${agentId}\0`;
  for (const key of messages.keys()) {
    if (key.startsWith(prefix)) messages.delete(key);
  }
}

function compactLiveMessages(
  messagesByAgent: Record<string, DynamicIslandMessageSource[]>,
): Record<string, DynamicIslandMessageSource[]> {
  return Object.fromEntries(
    Object.entries(messagesByAgent).map(([agentId, messages]) => {
      const latest = latestAgentMessage(messages);
      return [agentId, latest ? [latest] : []];
    }),
  );
}

function activeMessageAnchors(
  messagesByAgent: Record<string, DynamicIslandMessageSource[]>,
  previous = new Map<string, string>(),
): Map<string, string> {
  const anchors = new Map(previous);
  for (const [agentId, messages] of Object.entries(messagesByAgent)) {
    const latest = latestAgentMessage(messages);
    if (latest) anchors.set(agentId, latest.id);
    else anchors.delete(agentId);
  }
  return anchors;
}

function latestAgentMessage(messages: readonly DynamicIslandMessageSource[]): DynamicIslandMessageSource | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.author === "agent") return message;
  }
  return undefined;
}

function queueSnapshotsFromRuntimeWork(work: readonly AgentRuntimeWorkItem[]): Record<string, QueueSnapshot> {
  const queues: Record<string, QueueSnapshot> = {};
  for (const item of work) {
    const queue = queues[item.agentId] ?? { agentId: item.agentId, deliveries: [] };
    queues[item.agentId] = queue;
    queue.deliveries.push({
      id: item.id,
      messageId: item.id,
      recipientAgentId: item.agentId,
      sender: { kind: "user" },
      text: item.text,
      attachments: [],
      replyToMessageId: null,
      status: item.status,
      position: null,
      turnId: item.turnId,
      error: item.error,
      createdAt: "",
    });
  }
  return queues;
}

export function reconcileQueuesWithRuntimeWork(
  current: Record<string, QueueSnapshot>,
  work: readonly AgentRuntimeWorkItem[],
  activeTurns: ReadonlyMap<string, string>,
): Record<string, QueueSnapshot> {
  const runtime = queueSnapshotsFromRuntimeWork(work);
  const queues: Record<string, QueueSnapshot> = {};
  for (const agentId of new Set([...Object.keys(current), ...Object.keys(runtime)])) {
    const existing = current[agentId] ?? runtime[agentId];
    if (!existing) continue;
    const active = runtime[agentId]?.deliveries ?? [];
    const activeIds = new Set(active.map((delivery) => delivery.id));
    const previous = new Map(existing.deliveries.map((delivery) => [delivery.id, delivery]));
    queues[agentId] = {
      ...existing,
      deliveries: [
        ...active.map((delivery) => {
          const prior = previous.get(delivery.id);
          if (!prior) return delivery;
          return { ...prior, status: delivery.status, turnId: delivery.turnId, error: delivery.error };
        }),
        ...existing.deliveries.filter(
          (delivery) =>
            ((delivery.status !== "starting" && delivery.status !== "running") ||
              (delivery.turnId === activeTurns.get(agentId) && !runtime[agentId])) &&
            !activeIds.has(delivery.id),
        ),
      ],
    };
  }
  return queues;
}

function toDynamicIslandMessage(
  message: Extract<AgentEvent, { type: "conversation" }>["snapshot"]["messages"][number],
) {
  if (
    (message.author !== "assistant" && message.author !== "agent") ||
    message.senderAgentId ||
    message.itemType === "commentary" ||
    message.itemType === "question_prompt" ||
    message.itemType === "agent_attachment" ||
    message.itemType?.startsWith(CHAT_VISUAL_ITEM_TYPE_PREFIX) ||
    message.itemType === "plan" ||
    message.itemType === "subagents"
  ) {
    return [];
  }
  return [
    {
      id: message.id,
      author: "agent",
      body: cleanAgentMessageText(message.text),
      time: message.createdAt,
      createdAt: message.createdAt,
    },
  ];
}
