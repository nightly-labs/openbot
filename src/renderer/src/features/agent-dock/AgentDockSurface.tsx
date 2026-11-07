import type { AgentDockAction, AgentDockPresentation } from "@openbot/contracts/ipc";
import type { AgentMessage } from "@openbot/ui/data";
import { AgentDock, type AgentDockChatModel, type AgentDockSeat } from "@openbot/ui/features/agent-dock/AgentDock";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, onSettled, Show } from "solid-js";
import { agentDockPort } from "./agent-dock-port";
import { createAgentDockVoice } from "./agent-dock-voice";

/** The time without use before the dock slides into the edge, when the user wants it hidden. */
const TUCK_DELAY_MS = 900;
/** The width of the strip at the screen edge where the pointer brings a hidden dock back. */
const EDGE_STRIP = 4;

/**
 * The agent dock in its own window at the left or right edge of the screen. The main renderer owns the
 * conversations: this window shows what it publishes and sends each action back. Main sends the
 * messages typed here.
 *
 * The window lets the pointer through, except over the dock shapes. It takes key input while a chat
 * or a menu is open, and a click in another app closes the chat. When the user wants it hidden, the dock
 * slides into the edge while nobody uses it, and comes back when the pointer touches the edge.
 */
export function AgentDockSurface() {
  const { t, errorMessage } = useText();
  const [presentation, setPresentation] = createSignal<AgentDockPresentation | null>(null);
  const [closeRequest, setCloseRequest] = createSignal(0);
  const [tucked, setTuckedSignal] = createSignal(false);
  /* A plain copy: a signal write shows in a read only after the next flush. */
  let isTucked = false;
  const setTucked = (value: boolean) => {
    isTucked = value;
    setTuckedSignal(value);
  };
  let received = false;
  let chatOpen = false;
  let pointerIn = false;
  let dragging = false;
  /** The finished-work shelf shows results. */
  let shelfShown = false;
  /** A plain copy of the hide setting: the tuck timer and the pointer handlers read it outside a tracking scope. */
  let autoHide = false;
  let tuckTimer: ReturnType<typeof setTimeout> | undefined;
  let sent = { interactive: false, keyboard: false };
  /** A retry of a failed draft keeps its id, so the agent gets the message once. */
  let failed: { agentId: string; text: string; clientMessageId: string } | null = null;

  const apply = (next: AgentDockPresentation | null) => {
    received = true;
    setPresentation(next);
  };

  const perform = (action: AgentDockAction) => agentDockPort().agentDock.performAction(action);

  const menuOpen = () => document.querySelector(".ui-action-menu") !== null;
  const inUse = () => pointerIn || chatOpen || dragging || shelfShown || menuOpen();
  const stopTuckTimer = () => {
    clearTimeout(tuckTimer);
    tuckTimer = undefined;
  };

  /** Slides the dock into the edge a moment after the use ends; a use in the meantime keeps it out. */
  const updateTuck = () => {
    if (!autoHide || inUse()) {
      stopTuckTimer();
      setTucked(false);
      return;
    }
    if (isTucked || tuckTimer !== undefined) return;
    tuckTimer = setTimeout(() => {
      tuckTimer = undefined;
      if (autoHide && !inUse()) setTucked(true);
    }, TUCK_DELAY_MS);
  };
  createEffect(
    () => presentation()?.autoHide ?? false,
    (value) => {
      autoHide = value;
      updateTuck();
    },
  );

  /** Tells main when the window takes the pointer and the keys. Only a change is sent. */
  const sync = () => {
    updateTuck();
    const next = { interactive: pointerIn, keyboard: chatOpen || menuOpen() };
    if (next.interactive === sent.interactive && next.keyboard === sent.keyboard) return;
    sent = next;
    void agentDockPort()
      .agentDock.setInteractive(next)
      .catch(() => undefined);
  };

  onSettled(() => {
    const unsubscribe = agentDockPort().agentDock.onPresentation(apply);
    // The dock on another display opened a chat. One chat is open at a time.
    const stopCloseChat = agentDockPort().agentDock.onCloseChat(() => setCloseRequest((value) => value + 1));
    void agentDockPort()
      .agentDock.getPresentation()
      .then((value) => {
        if (!received) apply(value);
      })
      .catch(() => undefined);

    // The dock shapes take the pointer; the empty page, the body and the root let it through.
    const onPointer = (event: MouseEvent) => {
      if (isTucked && atEdge(event)) {
        stopTuckTimer();
        setTucked(false);
      }
      const target = event.target;
      pointerIn =
        target instanceof Element &&
        target !== document.documentElement &&
        target !== document.body &&
        target.id !== "root";
      sync();
    };
    const onLeave = () => {
      pointerIn = false;
      sync();
    };
    const onBlur = () => setCloseRequest((value) => value + 1);
    // A menu opens and closes in a portal on the body.
    const menus = new MutationObserver(() => sync());
    menus.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["role"] });
    document.addEventListener("mouseover", onPointer);
    document.addEventListener("mousemove", onPointer);
    document.documentElement.addEventListener("mouseleave", onLeave);
    window.addEventListener("blur", onBlur);
    return () => {
      unsubscribe();
      stopCloseChat();
      menus.disconnect();
      document.removeEventListener("mouseover", onPointer);
      document.removeEventListener("mousemove", onPointer);
      document.documentElement.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("blur", onBlur);
      stopTuckTimer();
    };
  });

  /** The pointer is on the strip at the screen edge that holds the dock. */
  const atEdge = (event: MouseEvent) =>
    presentation()?.edge === "left" ? event.clientX < EDGE_STRIP : event.clientX >= window.innerWidth - EDGE_STRIP;

  const seats = createMemo((): AgentDockSeat[] =>
    (presentation()?.seats ?? []).map((seat) => ({
      agent: seat.agent,
      mood: seat.mood,
      state: seat.state ?? undefined,
    })),
  );
  const chats = createMemo(() => {
    const byAgent = new Map<string, AgentDockChatModel>();
    for (const chat of presentation()?.chats ?? []) {
      const messages = chat.messages.map(
        (message): AgentMessage => ({
          id: message.id,
          author: message.author,
          kind: message.kind,
          body: message.body,
          time: "",
          attachments: message.attachments,
        }),
      );
      byAgent.set(chat.agentId, { messages, working: chat.working, wait: chat.wait });
    }
    return byAgent;
  });
  const agents = createMemo(() => [...(presentation()?.agents ?? [])]);
  const results = createMemo(() => [...(presentation()?.results ?? [])]);
  const chat = (agentId: string): AgentDockChatModel =>
    chats().get(agentId) ?? { messages: [], working: false, wait: null };

  const serverId = createMemo(() => presentation()?.serverId ?? null);
  const voice = createAgentDockVoice(() => serverId() ?? "local");
  /* A dock of another server starts with no chat, shelf or drag: the old dock reports no end when it goes. */
  createEffect(serverId, () => {
    chatOpen = false;
    shelfShown = false;
    dragging = false;
    sync();
  });

  /* Each server has its own dock; a new presentation of the same server keeps the open chat. */
  return (
    <Show when={serverId()} keyed>
      {(server) => (
        <AgentDock
          seats={seats()}
          available={presentation()?.available ?? []}
          chat={chat}
          closeRequest={closeRequest()}
          voice={voice}
          side={presentation()?.edge ?? "right"}
          tucked={tucked()}
          onDrag={(phase) => {
            dragging = phase !== "end";
            updateTuck();
            void agentDockPort()
              .agentDock.drag(phase)
              .catch(() => undefined);
          }}
          onOpenChange={(agentId) => {
            chatOpen = agentId !== null;
            sync();
            void perform({ type: "open-chat", serverId: server, agentId }).catch(() => undefined);
          }}
          onAdd={(agentId) => void perform({ type: "add", serverId: server, agentId }).catch(() => undefined)}
          onRemove={(agentId) => void perform({ type: "remove", serverId: server, agentId }).catch(() => undefined)}
          onSend={async (agentId, text) => {
            const clientMessageId =
              failed && failed.agentId === agentId && failed.text === text
                ? failed.clientMessageId
                : crypto.randomUUID();
            try {
              await perform({ type: "send", serverId: server, agentId, text, clientMessageId });
              failed = null;
              return { messageId: clientMessageId };
            } catch (error) {
              failed = { agentId, text, clientMessageId };
              return { error: errorMessage(error, t("chat.errorStatus.send")) };
            }
          }}
          onOpenInMain={(agentId) =>
            void perform({ type: "open-agent", serverId: server, agentId }).catch(() => undefined)
          }
          onOpenWindow={(agentId) =>
            void perform({ type: "open-window", serverId: server, agentId }).catch(() => undefined)
          }
          agents={agents()}
          onSelectAgent={(agentId) =>
            void perform({ type: "open-agent", serverId: server, agentId }).catch(() => undefined)
          }
          onOpenLink={(url) => void perform({ type: "open-link", url }).catch(() => undefined)}
          onOpenSettings={() => void perform({ type: "open-settings" }).catch(() => undefined)}
          results={results()}
          onShelfChange={(shown) => {
            // A result that came shows the hidden dock until the shelf is empty.
            shelfShown = shown;
            sync();
          }}
        />
      )}
    </Show>
  );
}
