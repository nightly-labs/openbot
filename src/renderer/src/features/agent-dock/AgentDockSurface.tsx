import type {
  AgentApproval,
  AgentDockAction,
  AgentDockApproval,
  AgentDockChannel,
  AgentDockPresentation,
  AgentDockSeatRef as AgentDockSeatContract,
  AgentRuntimeApproval,
} from "@openbot/contracts/ipc";
import type { AgentMessage } from "@openbot/ui/data";
import {
  AgentDock,
  type AgentDockChatAnswers,
  type AgentDockChatModel,
  type AgentDockSeat,
  type AgentDockSeatRef,
  type AgentDockShapeRect,
  type AgentDockChannel as AgentDockUiChannel,
  agentDockBody,
  agentDockSeatKey,
} from "@openbot/ui/features/agent-dock/AgentDock";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, onSettled, Show } from "solid-js";
import { currentDevicePlatform } from "../../send-shortcut-preference";
import { windowShape } from "../../window-shape";
import { AGENT_DOCK_STRIP_REST, AGENT_DOCK_STRIP_WIDTH, AgentDockEdgeStrip } from "./AgentDockEdgeStrip";
import { agentDockPort } from "./agent-dock-port";
import { createAgentDockVoice } from "./agent-dock-voice";

const TUCK_DELAY_MS = 900;
const EDGE_STRIP = 4;
const SHAPED_WINDOW = currentDevicePlatform() === "linux" || currentDevicePlatform() === "win32";
const POINTER_ZONE_WHILE_MOVING = currentDevicePlatform() === "win32";

export function AgentDockSurface() {
  const { t, errorMessage } = useText();
  const [presentation, setPresentation] = createSignal<AgentDockPresentation | null>(null);
  const [closeRequest, setCloseRequest] = createSignal(0);
  const [blurRequest, setBlurRequest] = createSignal(0);
  const [tucked, setTuckedSignal] = createSignal(false);
  let isTucked = false;
  const setTucked = (value: boolean) => {
    if (isTucked === value) return;
    isTucked = value;
    setTuckedSignal(value);
    syncShape();
  };
  let received = false;
  let chatOpen = false;
  let pointerIn = false;
  let dragging = false;
  let shelfShown = false;
  let autoHide = false;
  let edgeStrip = false;
  let near = false;
  let tuckTimer: ReturnType<typeof setTimeout> | undefined;
  let sent: { interactive: boolean; keyboard: boolean } | null = null;
  let dockShape: readonly AgentDockShapeRect[] | null = null;
  let sentShape = "";
  let failed: { seatKey: string; text: string; clientMessageId: string } | null = null;

  const apply = (next: AgentDockPresentation | null) => {
    received = true;
    setPresentation(next);
  };

  const perform = (action: AgentDockAction) => agentDockPort().agentDock.performAction(action);

  const menuOpen = () => document.querySelector(".ui-action-menu") !== null;
  const inUse = () => pointerIn || near || chatOpen || dragging || shelfShown || menuOpen();
  const stopTuckTimer = () => {
    clearTimeout(tuckTimer);
    tuckTimer = undefined;
  };

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
  createEffect(
    () => presentation()?.edgeStrip ?? false,
    (value) => {
      edgeStrip = value;
      syncShape();
    },
  );
  const stripOn = () => (presentation()?.autoHide ?? false) && (presentation()?.edgeStrip ?? false);
  const asks = createMemo(() => (presentation()?.seats ?? []).some((seat) => seat.state?.kind === "waiting"));

  function syncShape() {
    if (!SHAPED_WINDOW) return;
    const whole = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
    const parts = dockShape === null || menuOpen() ? [whole] : [...dockShape];
    if (isTucked) {
      const body = edgeStrip ? agentDockBody()?.getBoundingClientRect() : undefined;
      const width = body ? AGENT_DOCK_STRIP_WIDTH : EDGE_STRIP;
      const x = presentation()?.edge === "left" ? 0 : window.innerWidth - width;
      parts.push(
        body
          ? {
              x,
              y: Math.round(body.top + (body.height * (1 - AGENT_DOCK_STRIP_REST)) / 2),
              width,
              height: Math.round(body.height * AGENT_DOCK_STRIP_REST),
            }
          : { x, y: 0, width, height: window.innerHeight },
      );
    }
    const shape = POINTER_ZONE_WHILE_MOVING && dockShape === null && !menuOpen() ? [] : windowShape(parts);
    const key = JSON.stringify(shape);
    if (key === sentShape) return;
    sentShape = key;
    void agentDockPort()
      .agentDock.setInputRegion(shape)
      .catch(() => undefined);
  }

  const sync = () => {
    updateTuck();
    const next = { interactive: pointerIn, keyboard: chatOpen || menuOpen() };
    if (next.interactive === sent?.interactive && next.keyboard === sent.keyboard) return;
    sent = next;
    void agentDockPort()
      .agentDock.setInteractive(next)
      .catch(() => undefined);
  };

  onSettled(() => {
    const unsubscribe = agentDockPort().agentDock.onPresentation(apply);
    const stopCloseChat = agentDockPort().agentDock.onCloseChat(() => setCloseRequest((value) => value + 1));
    void agentDockPort()
      .agentDock.getPresentation()
      .then((value) => {
        if (!received) apply(value);
      })
      .catch(() => undefined);

    const onPointer = (event: MouseEvent) => {
      if (isTucked && !edgeStrip && atEdge(event)) {
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
    const onBlur = () => setBlurRequest((value) => value + 1);
    const menus = new MutationObserver(() => {
      sync();
      syncShape();
    });
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

  const atEdge = (event: MouseEvent) =>
    presentation()?.edge === "left" ? event.clientX < EDGE_STRIP : event.clientX >= window.innerWidth - EDGE_STRIP;

  const seats = createMemo((): AgentDockSeat[] =>
    (presentation()?.seats ?? []).map(
      (seat): AgentDockSeat =>
        seat.kind === "agent"
          ? {
              kind: "agent",
              agent: seat.agent,
              mood: seat.mood,
              state: seat.state ?? undefined,
              temporary: seat.temporary,
            }
          : {
              kind: "channel",
              channel: uiChannel(seat.channel),
              state: seat.state ?? undefined,
              temporary: seat.temporary,
            },
    ),
  );
  const availableChannels = createMemo(() => (presentation()?.availableChannels ?? []).map(uiChannel));
  const chats = createMemo(() => {
    const bySeat = new Map<string, AgentDockChatModel>();
    for (const chat of presentation()?.chats ?? []) {
      const messages = chat.messages.map(
        (message): AgentMessage => ({
          id: message.id,
          author: message.author,
          ...(message.senderAgentId ? { senderAgentId: message.senderAgentId } : {}),
          ...(message.senderMember ? { senderMember: message.senderMember } : {}),
          kind: message.kind,
          body: message.body,
          time: "",
          attachments: message.attachments,
        }),
      );
      bySeat.set(agentDockSeatKey(chat.seat), {
        messages,
        working: chat.working,
        wait: chat.wait,
        approval: chat.approval ? { approval: shownApproval(chat.approval), attempt: chat.approval.attempt } : null,
        prompt: chat.prompt,
        takeover: chat.takeover,
        usageLimit: chat.usageLimit,
      });
    }
    return bySeat;
  });
  const agents = createMemo(() => [...(presentation()?.agents ?? [])]);
  const results = createMemo(() => [...(presentation()?.results ?? [])]);
  const chat = (seat: AgentDockSeatRef): AgentDockChatModel =>
    chats().get(agentDockSeatKey(seat)) ?? {
      messages: [],
      working: false,
      wait: null,
      approval: null,
      prompt: null,
      takeover: null,
      usageLimit: null,
    };
  const answersFor = (server: string): AgentDockChatAnswers => ({
    approval: async (approval, decision) => {
      await perform({
        type: "respond-approval",
        serverId: server,
        agentId: approval.agentId,
        requestId: approval.requestId,
        decision,
      });
      return true;
    },
    prompt: async (prompt, answers) => {
      await perform({
        type: "answer-prompt",
        serverId: server,
        agentId: prompt.agentId,
        threadId: prompt.threadId,
        requestId: prompt.requestId,
        answers,
      });
      return true;
    },
    takeover: async ({ request }, decision) => {
      await perform({
        type: "respond-takeover",
        serverId: server,
        agentId: request.agentId,
        threadId: request.threadId,
        requestId: request.requestId,
        decision,
      });
      return true;
    },
    secret: (_takeover, input) => agentDockPort().agent.respondToBrowserSecret(input, server),
    usageLimitSend: async (limit, option, remember) => {
      await perform({
        type: "usage-limit-send",
        serverId: server,
        agentId: limit.agentId,
        optionKey: option.key,
        remember,
      });
      await new Promise<never>(() => undefined);
    },
    usageLimitWait: (limit) =>
      void perform({ type: "usage-limit-wait", serverId: server, agentId: limit.agentId }).catch(() => undefined),
  });

  const serverId = createMemo(() => presentation()?.serverId ?? null);
  const voice = createAgentDockVoice(() => serverId() ?? "local");
  createEffect(serverId, () => {
    chatOpen = false;
    shelfShown = false;
    dragging = false;
    sync();
  });

  return (
    <Show when={serverId()} keyed>
      {(server) => (
        <>
          <AgentDock
            seats={seats()}
            available={presentation()?.available ?? []}
            availableChannels={availableChannels()}
            chat={chat}
            closeRequest={closeRequest()}
            blurRequest={blurRequest()}
            voice={voice}
            side={presentation()?.edge ?? "right"}
            tucked={tucked()}
            onShapeChange={
              SHAPED_WINDOW
                ? (parts) => {
                    dockShape = parts;
                    syncShape();
                  }
                : undefined
            }
            onDrag={(phase) => {
              dragging = phase !== "end";
              updateTuck();
              void agentDockPort()
                .agentDock.drag(phase)
                .catch(() => undefined);
            }}
            onOpenChange={(seat) => {
              chatOpen = seat !== null;
              sync();
              void perform({ type: "open-chat", serverId: server, seat: seat && contractSeat(seat) }).catch(
                () => undefined,
              );
            }}
            onAdd={(seat) =>
              void perform({ type: "add", serverId: server, seat: contractSeat(seat) }).catch(() => undefined)
            }
            onRemove={(seat) =>
              void perform({ type: "remove", serverId: server, seat: contractSeat(seat) }).catch(() => undefined)
            }
            onMove={async (seat, before) => {
              await perform({
                type: "move",
                serverId: server,
                seat: contractSeat(seat),
                before: before ? contractSeat(before) : null,
              });
            }}
            onSend={async (seat, text) => {
              const seatKey = agentDockSeatKey(seat);
              const clientMessageId =
                failed && failed.seatKey === seatKey && failed.text === text
                  ? failed.clientMessageId
                  : crypto.randomUUID();
              try {
                await perform({ type: "send", serverId: server, seat: contractSeat(seat), text, clientMessageId });
                failed = null;
                return { messageId: clientMessageId };
              } catch (error) {
                failed = { seatKey, text, clientMessageId };
                return { error: errorMessage(error, t("chat.errorStatus.send")) };
              }
            }}
            onOpenInMain={(seat) =>
              void perform(
                seat.kind === "channel"
                  ? { type: "open-channel", serverId: server, channelId: seat.id }
                  : { type: "open-agent", serverId: server, agentId: seat.id },
              ).catch(() => undefined)
            }
            onOpenWindow={(agentId) =>
              void perform({ type: "open-window", serverId: server, agentId }).catch(() => undefined)
            }
            answers={answersFor(server)}
            agents={agents()}
            onSelectAgent={(agentId) =>
              void perform({ type: "open-agent", serverId: server, agentId }).catch(() => undefined)
            }
            onOpenLink={(url) => void perform({ type: "open-link", url }).catch(() => undefined)}
            onOpenSettings={() => void perform({ type: "open-settings" }).catch(() => undefined)}
            onHide={() => void perform({ type: "hide" }).catch(() => undefined)}
            results={results()}
            onShelfChange={(shown) => {
              shelfShown = shown;
              sync();
            }}
          />
          <Show when={stripOn()}>
            <AgentDockEdgeStrip
              side={presentation()?.edge ?? "right"}
              shown={tucked()}
              asks={asks()}
              onNearChange={(value) => {
                near = value;
                sync();
              }}
              onShow={() => {
                stopTuckTimer();
                setTucked(false);
              }}
            />
          </Show>
        </>
      )}
    </Show>
  );
}

function uiChannel(channel: AgentDockChannel): AgentDockUiChannel {
  return { ...channel, members: channel.members.map((agentId) => ({ agentId })) };
}

function contractSeat(seat: AgentDockSeatRef): AgentDockSeatContract {
  return seat.kind === "channel" ? { kind: "channel", id: seat.id } : { kind: "agent", id: seat.id };
}

function shownApproval(current: AgentDockApproval): AgentApproval {
  if (!current.cut) return current.approval;
  const cut: AgentRuntimeApproval = { ...current.approval, truncated: true };
  return cut;
}
