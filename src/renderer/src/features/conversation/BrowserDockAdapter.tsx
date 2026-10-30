import { providerSteersTurns } from "@openbot/contracts/agent-providers";
import {
  BROWSER_DOCK_LIMITS,
  type BrowserDockAction,
  type BrowserDockAgent,
  type BrowserDockIsland,
  type BrowserDockMcpServer,
  type BrowserDockPresentation,
  type BrowserDockSkill,
  type BrowserTab,
  isBrowserDockIsland,
} from "@openbot/contracts/ipc";
import { BROWSER_USER_CONTROL_CAPABILITY } from "@openbot/contracts/team-protocol/browser-user-control-v1";
import type { ComposerAgent, ComposerMcpServer, ComposerSkill } from "@openbot/ui/data";
import { BrowserDock, type BrowserIslandContent } from "@openbot/ui/features/browser/BrowserDock";
import { browserActionLabel } from "@openbot/ui/features/browser/browser-action-labels";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, Show, snapshot, untrack } from "solid-js";
import { deviceSendShortcut } from "../../send-shortcut-preference";
import { serverSupportsCapability } from "../servers/server-capabilities";
import { browserSecretVault } from "./browser-secret-vault";
import { conversationPort } from "./conversation-port";
import { conversationRuntime } from "./conversation-runtime";
import { useConversationViewScope } from "./conversation-scope";

/**
 * The dock over the page of `tab`: the island, the queue and the composer of the agent that owns the tab.
 * It uses the draft, the queue and the turn of the conversation, so a message typed here is the same message
 * as in the chat.
 *
 * With `overlay`, the page is a native view above this window, so the dock here is under it. The adapter
 * then publishes the dock to the overlay view above the page and does the actions that it sends back.
 * This dock shows again when main hides the overlay.
 */
export function BrowserDockAdapter(adapterProps: { tab: BrowserTab | undefined; overlay: boolean }) {
  const {
    props,
    currentDraft,
    currentTarget,
    clearSubmittedDraft,
    updateCurrentDraft,
    submitComposer,
    composerFocusRequest,
    installedSkills,
    mcpServers,
    presentedQueueDeliveries,
    editingDeliveryId,
    editQueuedMessage,
    cancelQueuedMessageEdit,
    reorderPresentedQueue,
    browserControlForTab,
    respondToBrowserTakeover,
    takeBrowserControl,
    releaseBrowserControl,
    openExternalMessageUrl,
    setActiveRightPanel,
  } = useConversationViewScope();
  const { t } = useText();
  const control = () => (adapterProps.tab ? browserControlForTab(adapterProps.tab) : undefined);
  const working = () => Boolean(props.activeTurnId) || control()?.phase === "acting";
  const [handoffPending, setHandoffPending] = createSignal(false);
  const [dismissedReplies, setDismissedReplies] = createSignal<ReadonlySet<string>>(new Set());
  /**
   * Only an answer that arrives while the page is open shows on it. For each agent, this is the last message
   * when its chat had loaded in this view; the reply of an agent whose chat is still loading does not show.
   */
  const [openedAfter, setOpenedAfter] = createSignal<ReadonlyMap<string, string | null>>(new Map());
  createEffect(
    () => ({ agentId: props.agent?.id, loaded: props.loaded }),
    ({ agentId, loaded }) => {
      if (!agentId || !loaded || untrack(openedAfter).has(agentId)) return;
      const last = untrack(() => props.messages.at(-1)?.id) ?? null;
      setOpenedAfter((markers) => new Map(markers).set(agentId, last));
    },
  );

  const takeover = () => {
    const request = props.browserTakeover;
    return request && request.tabId === adapterProps.tab?.id ? request : undefined;
  };
  /**
   * The cards that the user answered. A card goes from the dock at once, and the dock shows the agent's work.
   * When the answer fails, the card shows again as a new `attempt`.
   */
  const [answered, setAnswered] = createSignal<ReadonlySet<string>>(new Set());
  const [attempt, setAttempt] = createSignal(0);
  /**
   * One open question with no choices is answered from the field. Other questions show as a card over the
   * page. A secret answer, a card of the agent's own design, and a card that main would refuse need the chat.
   */
  const question = createMemo(() => {
    const prompt = props.prompt;
    if (!prompt || prompt.agentId !== props.agent?.id || prompt.questions.length === 0) return undefined;
    if (answered().has(promptCardKey(prompt))) return undefined;
    const [first] = prompt.questions;
    const fromField = prompt.questions.length === 1 && first && first.options === null && !first.isSecret;
    const card: BrowserIslandContent = {
      kind: "prompt",
      requestId: prompt.requestId,
      questions: prompt.questions,
      attempt: attempt(),
    };
    const inDock =
      !fromField &&
      !props.promptUiBlock &&
      prompt.questions.every((entry) => !entry.isSecret) &&
      isBrowserDockIsland(card);
    return { prompt, first: fromField ? first : undefined, card: inDock ? card : undefined };
  });
  const approval = createMemo(() => {
    const current = props.approval;
    if (!current || current.agentId !== props.agent?.id) return undefined;
    if (answered().has(approvalCardKey(current))) return undefined;
    const card: BrowserIslandContent = { kind: "approval", approval: current, attempt: attempt() };
    return isBrowserDockIsland(card) ? card : undefined;
  });
  const reply = createMemo(() => {
    const agentId = props.agent?.id;
    const marker = agentId ? openedAfter().get(agentId) : undefined;
    if (marker === undefined) return undefined;
    const messages = props.messages;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (!message || message.id === marker) return undefined;
      if (message.author !== "agent") return undefined;
      if (message.streaming || message.itemType === "commentary") continue;
      if ((message.kind ?? "text") !== "text" || !message.body.trim()) continue;
      return dismissedReplies().has(message.id) ? undefined : message;
    }
    return undefined;
  });

  const island = createMemo((): BrowserIslandContent | null => {
    const request = takeover();
    if (request?.secret) return { kind: "secret", request };
    if (request) return { kind: "activity", control: "request" };
    if (adapterProps.tab?.userControl) return { kind: "activity", control: "user" };
    const approvalCard = approval();
    if (approvalCard) return approvalCard;
    const asked = question();
    if (asked?.card) return asked.card;
    if (asked) {
      const id = `prompt:${asked.prompt.requestId}`;
      const body = asked.prompt.questions.map((entry) => entry.question).join("\n\n");
      return dismissedReplies().has(id)
        ? null
        : { kind: "reply", id, body, question: true, answerInChat: asked.first === undefined };
    }
    const session = control();
    if (session?.phase === "acting") {
      return { kind: "activity", control: "agent", label: t(browserActionLabel(session)) };
    }
    if (working()) {
      return { kind: "activity", control: "agent", label: props.activityDetail || t("chat.activity.workingOnIt") };
    }
    const answer = reply();
    return answer ? { kind: "reply", id: answer.id, body: answer.body } : null;
  });

  /** The user takes the page from the agent, or gives it back. A request of the agent ends when the user is done. */
  const handoffAction = (): (() => Promise<void>) | undefined => {
    const tab = adapterProps.tab;
    const content = island();
    if (!tab || content?.kind !== "activity") return undefined;
    if (content.control === "request") return async () => void (await respondToBrowserTakeover("complete"));
    if (content.control === "user") return () => releaseBrowserControl(tab.id);
    if (!serverSupportsCapability(props.server, BROWSER_USER_CONTROL_CAPABILITY)) return undefined;
    return () => takeBrowserControl(tab.id);
  };

  const deliveries = presentedQueueDeliveries;
  const hold = () => {
    const current = props.queue?.hold;
    return current && current.agentId !== props.agent?.id ? current : null;
  };
  const dismissReply = (id: string) => setDismissedReplies((ids) => new Set(ids).add(id));

  async function handoff(action: () => Promise<void>) {
    if (handoffPending()) return;
    setHandoffPending(true);
    try {
      await action();
    } finally {
      setHandoffPending(false);
    }
  }

  const onHandoff = createMemo(() => {
    const action = handoffAction();
    return action ? () => void handoff(action) : undefined;
  });

  function send(text: string) {
    const asked = question();
    if (asked?.first && !editingDeliveryId()) {
      const answer = text.trim();
      if (!answer) return;
      // The user can select the tab of another agent before the answer arrives: clear the draft of this one.
      const target = currentTarget();
      const draft = currentDraft();
      const prompt = asked.prompt;
      void props.onAnswerPrompt({ [asked.first.id]: [answer] }).then((done) => {
        if (!done) return;
        presentResolution(prompt);
        if (target) clearSubmittedDraft(target, { ...draft, attachments: [] });
      });
      return;
    }
    void submitComposer();
  }

  /** Answers the card on the page. An answer for a card that has gone does nothing. */
  async function answerPrompt(requestId: string | number, answers: Record<string, string[]>): Promise<boolean> {
    const asked = question();
    if (asked?.card?.kind !== "prompt" || String(asked.prompt.requestId) !== String(requestId)) return false;
    const prompt = asked.prompt;
    const done = await sendAnswer(promptCardKey(prompt), () => props.onAnswerPrompt(answers));
    if (done) presentResolution(prompt);
    return done;
  }

  async function respondApproval(requestId: string | number, decision: "accept" | "decline"): Promise<boolean> {
    const current = approval();
    if (current?.kind !== "approval" || String(current.approval.requestId) !== String(requestId)) return false;
    const key = approvalCardKey(current.approval);
    const done = await sendAnswer(key, () => props.onRespondToApproval(decision));
    // The approval has gone from the turns, and the agent can use its request id again.
    if (done) forgetAnswered(key);
    return done;
  }

  /**
   * The chat shows the answer of its own card, then marks the prompt as done. The dock card has gone, so it
   * marks it at once: the chat must not show the card again.
   */
  function presentResolution(prompt: NonNullable<typeof props.prompt>) {
    props.onPromptResolutionPresented?.(prompt.agentId, prompt.turnId, prompt.requestId);
  }

  function forgetAnswered(key: string) {
    setAnswered((keys) => {
      const next = new Set(keys);
      next.delete(key);
      return next;
    });
  }

  /** Removes the card while its answer goes to the agent, and shows it again when the answer fails. */
  async function sendAnswer(key: string, respond: () => Promise<boolean>): Promise<boolean> {
    setAnswered((keys) => new Set(keys).add(key));
    let done = false;
    try {
      done = await respond();
      return done;
    } finally {
      if (!done) {
        forgetAnswered(key);
        setAttempt((value) => value + 1);
      }
    }
  }

  /** The overlay's field: a revision changes only for a draft that did not come from the overlay. */
  let overlayText: string | undefined;
  let draftText = untrack(() => currentDraft().text);
  let draftRevision = 0;
  const presentation = createMemo((): BrowserDockPresentation | null => {
    const agent = props.agent;
    if (!adapterProps.overlay || !adapterProps.tab || !agent) return null;
    const text = currentDraft().text;
    if (text !== draftText) {
      draftText = text;
      if (text !== overlayText) draftRevision += 1;
      overlayText = undefined;
    }
    // The stores hold proxies, which IPC cannot copy.
    return snapshot({
      agent: dockAgent(agent),
      agents: props.agents.map(dockAgent),
      skills: installedSkills().slice(0, BROWSER_DOCK_LIMITS.skills).map(dockSkill),
      mcpServers: mcpServers().map(dockMcpServer),
      draft: { text, revision: draftRevision },
      focusRequest: composerFocusRequest(),
      sendShortcut: deviceSendShortcut(props.platform),
      working: working(),
      deliveries: deliveries().slice(0, BROWSER_DOCK_LIMITS.deliveries),
      hold: hold(),
      editingDeliveryId: editingDeliveryId() ?? null,
      canSteer: Boolean(props.activeTurnId),
      steerSupported: providerSteersTurns(agent.provider),
      canRunAsTask: Boolean(props.threads?.onRunQueuedMessage),
      island: dockIsland(island()),
      handoffPending: handoffPending(),
      canHandoff: Boolean(onHandoff()),
    });
  });
  /** Main shows the overlay above the page. */
  const [overlayShown, setOverlayShown] = createSignal(false);

  // A failed publish keeps the overlay as it was; main hides it when the page goes.
  const publish = (value: BrowserDockPresentation | null) =>
    void conversationPort()
      .browserDock.publishPresentation(value)
      .catch(() => undefined);
  createEffect(
    () => ({ overlay: adapterProps.overlay, value: presentation() }),
    ({ overlay, value }) => {
      if (overlay) publish(value);
    },
  );

  function act(action: BrowserDockAction) {
    switch (action.type) {
      case "value-change":
        overlayText = action.text;
        updateCurrentDraft({ text: action.text });
        return;
      case "send":
        send(action.text);
        return;
      case "stop":
        props.onStop();
        return;
      case "steer":
        props.onSteerQueuedMessage(action.deliveryId);
        return;
      case "run-as-task":
        props.threads?.onRunQueuedMessage?.(action.deliveryId);
        return;
      case "cancel":
        props.onCancelQueuedMessage(action.deliveryId);
        return;
      case "edit": {
        const delivery = deliveries().find((entry) => entry.id === action.deliveryId);
        if (delivery) void editQueuedMessage(delivery);
        return;
      }
      case "cancel-edit":
        void cancelQueuedMessageEdit();
        return;
      case "reorder":
        reorderPresentedQueue(action.deliveryIds);
        return;
      case "handoff":
        onHandoff()?.();
        return;
      case "dismiss-reply":
        dismissReply(action.id);
        return;
      case "answer-prompt":
        void answerPrompt(action.requestId, action.answers);
        return;
      case "respond-approval":
        void respondApproval(action.requestId, action.decision);
        return;
      case "open-chat":
        setActiveRightPanel("browser");
        return;
      case "select-agent":
        props.onSelectAgent(action.agentId);
        return;
      case "open-link":
        void openExternalMessageUrl(action.url);
        return;
    }
  }

  // Only the desktop app has the overlay; the web client has no `window.openbot`.
  createEffect(
    () => adapterProps.overlay,
    (overlay) => {
      if (!overlay) return;
      const stopAction = conversationPort().browserDock.onAction(act);
      const stopShown = conversationPort().browserDock.onShown(setOverlayShown);
      return () => {
        stopAction();
        stopShown();
        setOverlayShown(false);
        publish(null);
      };
    },
  );

  return (
    <Show when={!overlayShown() && props.agent}>
      {(agent) => {
        // Main hides the overlay while a menu covers the page, and this dock shows in its place. A
        // focus request from before it showed is not for it: it would take the focus from the menu.
        const shownAt = untrack(composerFocusRequest);
        return (
          <BrowserDock
            agent={agent()}
            agents={props.agents}
            skills={installedSkills()}
            mcpServers={mcpServers()}
            value={currentDraft().text}
            focusRequest={composerFocusRequest() > shownAt ? composerFocusRequest() : undefined}
            sendShortcut={deviceSendShortcut(props.platform)}
            working={working()}
            deliveries={deliveries()}
            hold={hold()}
            editingDeliveryId={editingDeliveryId()}
            canSteer={Boolean(props.activeTurnId)}
            island={island()}
            handoffPending={handoffPending()}
            onValueChange={(text) => updateCurrentDraft({ text })}
            onSend={send}
            onStop={props.onStop}
            onSteer={providerSteersTurns(agent().provider) ? props.onSteerQueuedMessage : undefined}
            onRunAsTask={props.threads?.onRunQueuedMessage}
            onCancel={props.onCancelQueuedMessage}
            onEdit={(delivery) => void editQueuedMessage(delivery)}
            onCancelEdit={() => void cancelQueuedMessageEdit()}
            onReorder={reorderPresentedQueue}
            onHandoff={onHandoff()}
            vault={browserSecretVault(props.server)}
            onRespondSecret={(input) => conversationRuntime(props).agent.respondToBrowserSecret(input)}
            onAnswerPrompt={answerPrompt}
            onRespondApproval={respondApproval}
            onDismissReply={dismissReply}
            onOpenChat={() => setActiveRightPanel("browser")}
            onSelectAgent={props.onSelectAgent}
            onOpenLink={(url) => void openExternalMessageUrl(url)}
          />
        );
      }}
    </Show>
  );
}

/** The request ids count per agent process, so the key also has the agent and the turn. */
function promptCardKey(prompt: { agentId: string; turnId: string; requestId: string | number }): string {
  return JSON.stringify(["prompt", prompt.agentId, prompt.turnId, String(prompt.requestId)]);
}

function approvalCardKey(approval: { agentId: string; requestId: string | number }): string {
  return JSON.stringify(["approval", approval.agentId, String(approval.requestId)]);
}

/** Main refuses a whole presentation with a field over its limit, so a long step or reply is cut here. */
function dockIsland(island: BrowserDockIsland | null): BrowserDockIsland | null {
  if (island?.kind === "activity" && island.control === "agent")
    return { ...island, label: island.label.slice(0, BROWSER_DOCK_LIMITS.label) };
  if (island?.kind === "reply") return { ...island, body: island.body.slice(0, BROWSER_DOCK_LIMITS.replyBody) };
  return island;
}

function dockAgent(agent: ComposerAgent): BrowserDockAgent {
  return {
    id: agent.id,
    name: agent.name,
    title: agent.title,
    description: agent.description,
    avatarSeed: agent.avatarSeed,
    avatarHue: agent.avatarHue,
    avatarUrl: agent.avatarUrl,
  };
}

function dockSkill(skill: ComposerSkill): BrowserDockSkill {
  return {
    skillId: skill.skillId,
    slug: skill.slug,
    name: skill.name,
    state: skill.state,
    ...(skill.enabled === undefined ? {} : { enabled: skill.enabled }),
    ...(skill.origin === undefined ? {} : { origin: skill.origin }),
    ...(skill.description === undefined ? {} : { description: skill.description }),
  };
}

/** Never the environment or the headers: they can hold secrets. */
function dockMcpServer(server: ComposerMcpServer): BrowserDockMcpServer {
  return {
    id: server.id,
    name: server.name,
    enabled: server.enabled,
    transport: server.transport,
    command: server.command,
    args: [...server.args],
    url: server.url,
  };
}
