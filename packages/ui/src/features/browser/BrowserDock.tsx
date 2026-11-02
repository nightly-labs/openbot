import type { LocalBrowserSecretResponse, QueueDelivery, QueueHold } from "@openbot/contracts/ipc";
import { ArrowUp, Button } from "@openbot/ui";
import type { ComposerAgent, ComposerMcpServer, ComposerSkill } from "@openbot/ui/data";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import type { BrowserSecretVault } from "@openbot/ui/features/conversation/BrowserSecretCard";
import { ComposerEditor } from "@openbot/ui/features/conversation/ComposerEditor";
import { StopIcon } from "@openbot/ui/features/conversation/ConversationIcons";
import { QueuePanel } from "@openbot/ui/features/conversation/QueuePanel";
import type { SendShortcut } from "@openbot/ui/features/conversation/send-shortcut";
import { useText } from "@openbot/ui/text";
import { prefersReducedMotion } from "@openbot/ui/utils";
import { createEffect, createSignal, flush, onSettled, Show, untrack } from "solid-js";
import { type BrowserIslandContent, BrowserIslandFace, browserIslandKey } from "./BrowserIsland";
import {
  ISLAND_DURATION_MS,
  ISLAND_EASING,
  type MorphSource,
  morphDuration,
  morphInto,
  morphIntoRow,
  morphSource,
  playIsland,
  press,
  type QueueLayout,
  queueLayout,
  snapshotIsland,
  textRect,
} from "./dock-motion";

export type { BrowserIslandContent } from "./BrowserIsland";

/** An answer closes by itself after this time, while the pointer and the focus are not on it. */
const REPLY_CLOSE_MS = 6000;

/** A sent message moves into the island or the queue only when the host shows it in this time. */
const SEND_MORPH_WINDOW_MS = 1500;

export interface BrowserDockProps {
  /** The agent that owns the tab. */
  agent: ComposerAgent;
  agents: ComposerAgent[];
  skills?: ComposerSkill[] | undefined;
  mcpServers?: ComposerMcpServer[] | undefined;
  value: string;
  focusRequest?: number | undefined;
  sendShortcut?: SendShortcut | undefined;
  /** The agent has a turn. With an empty field, Send is Stop. */
  working: boolean;
  deliveries: QueueDelivery[];
  hold?: QueueHold | null | undefined;
  editingDeliveryId?: string | null | undefined;
  canSteer: boolean;
  island: BrowserIslandContent | null;
  handoffPending?: boolean | undefined;
  onValueChange: (value: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  /** Absent where the agent's provider cannot steer a running turn. */
  onSteer?: ((deliveryId: string) => void) | undefined;
  onRunAsTask?: ((deliveryId: string) => void) | undefined;
  onCancel: (deliveryId: string) => void;
  onEdit: (delivery: QueueDelivery) => void;
  onCancelEdit: () => void;
  onReorder: (deliveryIds: string[]) => void;
  /** Gives the page to the user, or back. Absent when the host cannot. */
  onHandoff?: (() => void) | undefined;
  /** Offer "Save to Vault" on a password card. */
  vault?: BrowserSecretVault | undefined;
  onRespondSecret: (input: LocalBrowserSecretResponse) => Promise<void>;
  /** Resolves true when the host has the answers. An empty record cancels the questions. */
  onAnswerPrompt: (requestId: string | number, answers: Record<string, string[]>) => Promise<boolean>;
  onRespondApproval: (requestId: string | number, decision: "accept" | "decline") => Promise<boolean>;
  onDismissReply: (id: string) => void;
  onOpenChat?: (() => void) | undefined;
  onSelectAgent: (agentId: string) => void;
  onOpenLink: (url: string) => void;
}

/** A message on its way from the field, or from a queue row, until the host shows where it went. */
interface PendingSend {
  text: string;
  source: MorphSource;
  before: QueueLayout | undefined;
  at: number;
  row?: HTMLElement;
}

/**
 * The composer of the tab's agent over the bottom of the page. A message sent while the agent works waits
 * in the queue above the field. The island, above the queue, is one glass capsule for what the agent does,
 * the code it asks for and what it says. It opens out of the composer, changes size and content with a
 * spring, and closes back into it. A sent message moves from the field into the island or its queue row.
 */
export function BrowserDock(props: BrowserDockProps) {
  const { t } = useText();
  /** What the island shows. It follows `props.island` one step later, so that the old island can be measured. */
  const [shown, setShown] = createSignal<BrowserIslandContent | null>(untrack(() => props.island));
  let dock: HTMLDivElement | undefined;
  let form: HTMLFormElement | undefined;
  let status: HTMLSpanElement | undefined;
  let island: HTMLDivElement | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let settleIsland: (() => void) | undefined;
  let pending: PendingSend | undefined;
  let mounted = true;

  const reply = () => {
    const current = shown();
    return current?.kind === "reply" ? current : undefined;
  };
  const editing = () => Boolean(props.editingDeliveryId);
  const queueOpen = () => props.deliveries.length > 0;
  const fieldText = () => form?.querySelector(".composer-editor-surface") ?? undefined;
  const rowText = (id: string) =>
    dock?.querySelector<HTMLElement>(`[data-queue-delivery-id="${CSS.escape(id)}"] .agent-queue-message`) ?? undefined;

  /** The send that waits for its target, when it is recent. A stale one shows its row again. */
  function takePending(): PendingSend | undefined {
    const current = pending;
    pending = undefined;
    if (current?.row) current.row.style.removeProperty("visibility");
    if (!current || performance.now() - current.at > SEND_MORPH_WINDOW_MS) return undefined;
    return current;
  }

  /** Shows `next` in the island, and moves the island from what it showed. A recent send moves into it. */
  function changeIsland(next: BrowserIslandContent | null) {
    const current = island?.isConnected ? island : undefined;
    const before = current && snapshotIsland(current);
    settleIsland?.();
    settleIsland = undefined;
    setShown(next);
    flush();
    const after = island?.isConnected ? island : undefined;
    if (!dock) return;
    const sent = next?.kind === "activity" ? takePending() : undefined;
    if (sent && after && status?.isConnected) {
      morphInto(dock, sent.text, sent.source, { box: after, text: status }, Boolean(before));
      if (!before) return;
    }
    settleIsland = playIsland(dock, before, after);
  }

  createEffect(
    () => ({ next: props.island, key: browserIslandKey(props.island) }),
    ({ next, key }) => {
      if (key === browserIslandKey(untrack(shown))) {
        setShown(next);
        return;
      }
      // The new island renders after this update, so the old one can be measured first.
      queueMicrotask(() => {
        if (mounted) changeIsland(props.island);
      });
    },
  );

  // A new queue row for the sent text: the text moves from the field into it.
  createEffect(
    () => props.deliveries.map((delivery) => ({ id: delivery.id, text: delivery.text })),
    (rows, previous) => {
      const known = new Set(previous?.map((row) => row.id));
      const added = rows.filter((row) => !known.has(row.id));
      if (!pending?.before || added.length === 0) return;
      const sent = pending;
      const delivery = added.find((row) => row.text.trim() === sent.text);
      if (!delivery) return;
      queueMicrotask(() => {
        const current = takePending();
        const row = rowText(delivery.id);
        const box = row?.closest<HTMLElement>(".agent-queue-item");
        if (!current?.before || !dock || !row || !box) return;
        morphIntoRow(dock, current.text, current.source, current.before, { box, text: row });
      });
    },
  );

  /**
   * An answer closes by itself after a while. It stays while the pointer or the focus is on the island (`held`).
   * A question stays until the user answers it or closes it.
   */
  function closeLater(held: boolean) {
    clearTimeout(closeTimer);
    const current = untrack(reply);
    closeTimer =
      held || !current || current.question
        ? undefined
        : setTimeout(() => props.onDismissReply(current.id), REPLY_CLOSE_MS);
  }

  createEffect(
    () => reply()?.id,
    () => closeLater(Boolean(island?.matches(":hover, :focus-within"))),
  );

  const send = () => {
    const text = props.value.trim();
    if (!text) return;
    if (editing()) {
      press(form);
      props.onSend(text);
      return;
    }
    const field = fieldText();
    const stack = form?.closest<HTMLElement>(".browser-dock-stack");
    if (field && form) {
      pending = {
        text,
        source: morphSource(form, field, true, textRect(field)),
        before: stack ? queueLayout(stack, form) : undefined,
        at: performance.now(),
      };
    }
    // The hint comes back after the text leaves, so the two do not show in the same place.
    if (!prefersReducedMotion()) {
      form
        ?.querySelector(".composer-editor-placeholder")
        ?.animate([{ opacity: 0 }, { opacity: 0, offset: 0.4 }, { opacity: 1 }], morphDuration());
    }
    props.onSend(text);
  };

  // Steer sends a queued message now: the row changes into the island.
  const steer = (id: string) => {
    const row = rowText(id);
    const box = row?.closest<HTMLElement>(".agent-queue-item");
    if (row && box) {
      pending = {
        text: row.textContent ?? "",
        source: morphSource(box, row, false),
        before: undefined,
        at: performance.now(),
        row: box,
      };
      box.style.visibility = "hidden";
    }
    props.onSteer?.(id);
  };

  onSettled(() => () => {
    mounted = false;
    clearTimeout(closeTimer);
    settleIsland?.();
    takePending();
  });

  const placeholder = () =>
    reply()
      ? t("island.reply.placeholder", { name: props.agent.name })
      : t("composer.placeholder.message", { name: props.agent.name });

  return (
    <div
      class="browser-dock"
      style={{
        "--browser-dock-island-easing": ISLAND_EASING,
        "--browser-dock-island-duration": `${ISLAND_DURATION_MS}ms`,
      }}
      ref={(element) => {
        dock = element;
      }}
    >
      <Show when={shown()}>
        {(content) => (
          <div
            class="browser-dock-glass browser-dock-island"
            data-mode={content().kind}
            ref={(element) => {
              island = element;
            }}
            onPointerEnter={() => closeLater(true)}
            onPointerLeave={() => closeLater(Boolean(island?.matches(":focus-within")))}
            onFocusIn={() => closeLater(true)}
            onFocusOut={(event) =>
              closeLater(
                Boolean(island?.matches(":hover")) ||
                  (event.relatedTarget instanceof Node && Boolean(island?.contains(event.relatedTarget))),
              )
            }
          >
            <BrowserIslandFace
              content={content()}
              agent={props.agent}
              agents={props.agents}
              handoffPending={props.handoffPending}
              sendShortcut={props.sendShortcut}
              onHandoff={props.onHandoff}
              vault={props.vault}
              onRespondSecret={props.onRespondSecret}
              onAnswerPrompt={props.onAnswerPrompt}
              onRespondApproval={props.onRespondApproval}
              onDismissReply={props.onDismissReply}
              onOpenChat={props.onOpenChat}
              onSelectAgent={props.onSelectAgent}
              onOpenLink={props.onOpenLink}
              statusRef={(element) => {
                status = element;
              }}
            />
          </div>
        )}
      </Show>
      <div class="browser-dock-stack">
        <div
          class="agent-queue-slot"
          data-open={queueOpen() ? "true" : "false"}
          aria-hidden={queueOpen() ? undefined : "true"}
          inert={queueOpen() ? undefined : true}
        >
          <div class="agent-queue-slot-inner">
            <Show when={queueOpen()}>
              <QueuePanel
                variant="floating"
                deliveries={props.deliveries}
                hold={props.hold}
                agents={props.agents}
                skills={props.skills}
                editingDeliveryId={props.editingDeliveryId}
                canSteer={props.canSteer}
                onSteer={props.onSteer ? steer : undefined}
                onRunAsTask={props.onRunAsTask}
                onCancel={props.onCancel}
                onEdit={props.onEdit}
                onReorder={props.onReorder}
              />
            </Show>
          </div>
        </div>
        <form
          class="browser-dock-glass browser-dock-composer"
          ref={(element) => {
            form = element;
          }}
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
          // Escape stops the edit, and the message goes back to its row unchanged.
          onKeyDown={(event) => {
            if (event.key !== "Escape" || event.defaultPrevented || !editing()) return;
            event.preventDefault();
            props.onCancelEdit();
          }}
        >
          <AgentAvatar agent={props.agent} class="browser-dock-avatar" />
          <div class="browser-dock-editor">
            <ComposerEditor
              size="compact"
              agentId={props.agent.id}
              agents={props.agents}
              skills={props.skills}
              mcpServers={props.mcpServers}
              value={props.value}
              focusRequest={props.focusRequest}
              placeholder={placeholder()}
              ariaLabel={t("browser.dock.messageTo", { name: props.agent.name })}
              disabled={false}
              sendShortcut={props.sendShortcut}
              onSubmit={send}
              onValueChange={props.onValueChange}
            />
          </div>
          {/* As in the conversation: while the agent works and the field is empty, Send is Stop. */}
          <Show
            when={props.working && !editing() && !props.value.trim()}
            fallback={
              <Button
                type="submit"
                variant="ghost"
                class="voice-button"
                aria-label={editing() ? t("composer.send.saveQueued") : t("composer.send.message")}
              >
                <ArrowUp aria-hidden="true" />
              </Button>
            }
          >
            <Button
              type="button"
              variant="ghost"
              class="voice-button voice-button-active"
              aria-label={t("composer.send.stop")}
              onClick={() => props.onStop()}
            >
              <StopIcon />
            </Button>
          </Show>
        </form>
      </div>
    </div>
  );
}
