import type { LocalBrowserSecretResponse, QueueDelivery, QueueHold } from "@openbot/contracts/ipc";
import { ArrowUp, Button, ChevronDown, ChevronUp } from "@openbot/ui";
import type { ComposerAgent, ComposerMcpServer, ComposerSkill } from "@openbot/ui/data";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import type { BrowserSecretVault } from "@openbot/ui/features/conversation/BrowserSecretCard";
import { ComposerEditor } from "@openbot/ui/features/conversation/ComposerEditor";
import { StopIcon } from "@openbot/ui/features/conversation/ConversationIcons";
import { QueuePanel } from "@openbot/ui/features/conversation/QueuePanel";
import type { SendShortcut } from "@openbot/ui/features/conversation/send-shortcut";
import { EASE_OUT, ISLAND_CLOSE, ISLAND_OPEN, type Spring, springKeyframes } from "@openbot/ui/spring-motion";
import { useText } from "@openbot/ui/text";
import { mix, prefersReducedMotion } from "@openbot/ui/utils";
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

const REPLY_CLOSE_MS = 6000;

const SEND_MORPH_WINDOW_MS = 1500;

const HIDE_FADE_MS = 120;
const TAB_FADE_MS = 100;
const REVEAL_MS = 160;
const REVEAL_STAGGER_MS = 40;

type DockPhase = "open" | "hiding" | "hidden" | "showing";

function needsAnswer(island: BrowserIslandContent | null | undefined): boolean {
  if (!island) return false;
  if (island.kind === "reply") return Boolean(island.question);
  return island.kind === "secret" || island.kind === "prompt" || island.kind === "approval";
}

function px(value: number): string {
  return `${value}px`;
}

export interface BrowserDockProps {
  agent: ComposerAgent;
  agents: ComposerAgent[];
  skills?: ComposerSkill[] | undefined;
  mcpServers?: ComposerMcpServer[] | undefined;
  value: string;
  focusRequest?: number | undefined;
  sendShortcut?: SendShortcut | undefined;
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
  onSteer?: ((deliveryId: string) => void) | undefined;
  onRunAsTask?: ((deliveryId: string) => void) | undefined;
  onCancel: (deliveryId: string) => void;
  onEdit: (delivery: QueueDelivery) => void;
  onCancelEdit: () => void;
  onReorder: (deliveryIds: string[]) => void;
  onHandoff?: (() => void) | undefined;
  vault?: BrowserSecretVault | undefined;
  onRespondSecret: (input: LocalBrowserSecretResponse) => Promise<void>;
  onAnswerPrompt: (requestId: string | number, answers: Record<string, string[]>) => Promise<boolean>;
  onRespondApproval: (requestId: string | number, decision: "accept" | "decline") => Promise<boolean>;
  onDismissReply: (id: string) => void;
  onOpenChat?: (() => void) | undefined;
  onSelectAgent: (agentId: string) => void;
  onOpenLink: (url: string) => void;
}

interface PendingSend {
  text: string;
  source: MorphSource;
  before: QueueLayout | undefined;
  at: number;
  row?: HTMLElement;
}

export function BrowserDock(props: BrowserDockProps) {
  const { t } = useText();
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
  const [queueRows, setQueueRows] = createSignal<QueueDelivery[]>(untrack(() => props.deliveries));
  let queueCloseTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(
    () => props.deliveries,
    (deliveries) => {
      if (deliveries.length > 0) {
        clearTimeout(queueCloseTimer);
        queueCloseTimer = undefined;
        setQueueRows(deliveries);
        return;
      }
      if (queueCloseTimer !== undefined || untrack(queueRows).length === 0) return;
      if (prefersReducedMotion()) {
        setQueueRows([]);
        return;
      }
      queueCloseTimer = setTimeout(() => {
        queueCloseTimer = undefined;
        setQueueRows([]);
      }, ISLAND_DURATION_MS);
    },
  );
  const [phase, setPhase] = createSignal<DockPhase>("open");
  const tucked = () => phase() === "hidden";
  let tab: HTMLDivElement | undefined;
  let tabButton: HTMLButtonElement | undefined;
  let reopen = false;
  let showing = false;

  function requestShow() {
    queueMicrotask(() => {
      const current = untrack(phase);
      if (current === "hidden") void show();
      else if (current === "hiding") reopen = true;
    });
  }

  createEffect(
    () => {
      const current = props.island;
      return needsAnswer(current) ? browserIslandKey(current) : "";
    },
    (key) => {
      if (key) requestShow();
    },
  );
  let focusSeen = untrack(() => props.focusRequest);
  createEffect(
    () => props.focusRequest,
    (request) => {
      if (request === focusSeen) return;
      focusSeen = request;
      requestShow();
    },
  );

  const boxParts = (): Element[] => [
    ...(island?.isConnected ? [island] : []),
    ...(dock?.querySelectorAll(".browser-dock-stack > .agent-queue-slot") ?? []),
    ...(form?.children ?? []),
  ];
  const tabParts = (): Element[] => [
    ...(tabButton?.children ?? []),
    ...(tab?.querySelectorAll(".browser-dock-tab-done") ?? []),
  ];

  async function glide(from: DOMRect, to: DOMRect, spring: Spring): Promise<() => void> {
    const root = dock;
    if (!root) return () => undefined;
    const base = root.getBoundingClientRect();
    const start = { left: from.left - base.left, top: from.top - base.top, width: from.width, height: from.height };
    const end = { left: to.left - base.left, top: to.top - base.top, width: to.width, height: to.height };
    const copy = document.createElement("div");
    copy.className = "browser-dock-morph browser-dock-tuck-glass";
    copy.setAttribute("aria-hidden", "true");
    root.prepend(copy);
    root.toggleAttribute("data-glassless", true);
    const motion = copy.animate(
      springKeyframes(spring, (progress) => ({
        left: px(mix(start.left, end.left, progress)),
        top: px(mix(start.top, end.top, progress)),
        width: px(mix(start.width, end.width, progress)),
        height: px(mix(start.height, end.height, progress)),
      })),
      { duration: spring.response * 1000, fill: "forwards" },
    );
    await motion.finished.catch(() => undefined);
    return () => {
      root.removeAttribute("data-glassless");
      copy.remove();
    };
  }

  function fadeIn(parts: Element[], stagger: number) {
    parts.forEach((part, index) => {
      part.animate(
        [
          { opacity: 0, filter: "blur(2px)" },
          { opacity: 1, filter: "blur(0)" },
        ],
        { duration: REVEAL_MS, delay: index * stagger, easing: EASE_OUT, fill: "backwards" },
      );
    });
  }

  async function tuck() {
    if (untrack(phase) !== "open") return;
    clearTimeout(closeTimer);
    if (dock) dock.style.setProperty("--browser-dock-open-width", px(dock.offsetWidth));
    const from = form?.getBoundingClientRect();
    if (!from || !tab || prefersReducedMotion()) {
      setPhase("hidden");
      flush();
      tabButton?.focus({ preventScroll: true });
      return;
    }
    setPhase("hiding");
    flush();
    const fades = boxParts().map((part) =>
      part.animate(
        [
          { opacity: 1, filter: "blur(0)" },
          { opacity: 0, filter: "blur(2px)" },
        ],
        { duration: HIDE_FADE_MS, easing: EASE_OUT, fill: "forwards" },
      ),
    );
    const done = await glide(from, tab.getBoundingClientRect(), ISLAND_OPEN);
    if (!mounted) return;
    setPhase("hidden");
    flush();
    done();
    for (const fade of fades) fade.cancel();
    fadeIn(tabParts(), REVEAL_STAGGER_MS);
    tabButton?.focus({ preventScroll: true });
    if (reopen) {
      reopen = false;
      void show();
    }
  }

  async function show() {
    if (untrack(phase) !== "hidden" || showing) return;
    showing = true;
    try {
      await grow();
    } finally {
      showing = false;
    }
  }

  async function grow() {
    reopen = false;
    const from = tab?.getBoundingClientRect();
    if (!from || !form || prefersReducedMotion()) {
      setPhase("open");
      flush();
      fieldText()?.focus({ preventScroll: true });
      closeLater(false);
      return;
    }
    await Promise.all(
      tabParts().map((part) =>
        part
          .animate([{ opacity: 1 }, { opacity: 0, filter: "blur(2px)" }], {
            duration: TAB_FADE_MS,
            easing: EASE_OUT,
            fill: "forwards",
          })
          .finished.catch(() => undefined),
      ),
    );
    if (!mounted) return;
    setPhase("showing");
    flush();
    for (const part of tabParts()) for (const motion of part.getAnimations()) motion.cancel();
    const done = await glide(from, form.getBoundingClientRect(), ISLAND_OPEN);
    if (!mounted) return;
    setPhase("open");
    flush();
    fadeIn(boxParts(), 0);
    done();
    fieldText()?.focus({ preventScroll: true });
    closeLater(false);
  }

  const tabLabel = () => {
    const name = props.agent.name;
    const current = props.island;
    switch (current?.kind) {
      case "activity":
        if (current.control === "agent") return current.label;
        return current.control === "user" ? t("browser.userControl.status") : t("browser.dock.needsYou", { name });
      case "secret":
      case "prompt":
        return t("browser.dock.needsAnswer", { name });
      case "approval":
        return t("browser.dock.needsApproval", { name });
      case "reply":
        return current.question ? t("browser.dock.needsAnswer", { name }) : t("browser.dock.replied", { name });
      default:
        return t("composer.placeholder.message", { name });
    }
  };
  const agentActs = () => props.island?.kind === "activity" && props.island.control === "agent";
  const stepDone = () =>
    props.island?.kind === "activity" && props.island.control === "request" ? props.onHandoff : undefined;
  const unread = () => props.island?.kind === "reply" || needsAnswer(props.island);

  let tabWidth = 0;
  createEffect(tabLabel, () => {
    const current = tab;
    if (!current) return;
    const width = current.offsetWidth;
    const from = tabWidth;
    tabWidth = width;
    if (from === 0 || width === from || untrack(phase) !== "hidden" || prefersReducedMotion()) return;
    current.animate(
      springKeyframes(ISLAND_CLOSE, (progress) => ({ width: px(mix(from, width, progress)) })),
      { duration: ISLAND_CLOSE.response * 1000 },
    );
    const label = current.querySelector(".browser-dock-tab-label");
    label?.animate(
      [
        { opacity: 0, filter: "blur(2px)" },
        { opacity: 1, filter: "blur(0)" },
      ],
      { duration: REVEAL_MS, easing: EASE_OUT },
    );
  });
  const fieldText = () => form?.querySelector<HTMLElement>(".composer-editor-surface") ?? undefined;
  const rowText = (id: string) =>
    dock?.querySelector<HTMLElement>(`[data-queue-delivery-id="${CSS.escape(id)}"] .agent-queue-message`) ?? undefined;

  function takePending(): PendingSend | undefined {
    const current = pending;
    pending = undefined;
    if (current?.row) current.row.style.removeProperty("visibility");
    if (!current || performance.now() - current.at > SEND_MORPH_WINDOW_MS) return undefined;
    return current;
  }

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
      queueMicrotask(() => {
        if (mounted) changeIsland(props.island);
      });
    },
  );

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

  function closeLater(held: boolean) {
    clearTimeout(closeTimer);
    const current = untrack(reply);
    closeTimer =
      held || !current || current.question || untrack(phase) !== "open"
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
    if (!prefersReducedMotion()) {
      form
        ?.querySelector(".composer-editor-placeholder")
        ?.animate([{ opacity: 0 }, { opacity: 0, offset: 0.4 }, { opacity: 1 }], morphDuration());
    }
    props.onSend(text);
  };

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
    clearTimeout(queueCloseTimer);
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
      data-tucked={tucked() ? "" : undefined}
      data-phase={phase()}
      style={{
        "--browser-dock-island-easing": ISLAND_EASING,
        "--browser-dock-island-duration": `${ISLAND_DURATION_MS}ms`,
      }}
      ref={(element) => {
        dock = element;
      }}
    >
      <div
        class="browser-dock-glass browser-dock-tab"
        ref={(element) => {
          tab = element;
        }}
      >
        <Button
          type="button"
          variant="ghost"
          class="browser-dock-tab-open"
          title={t("browser.dock.show")}
          ref={(element: HTMLButtonElement) => {
            tabButton = element;
          }}
          onClick={() => void show()}
        >
          <span
            class="browser-dock-tab-avatar"
            data-working={agentActs() ? "" : undefined}
            data-unread={unread() ? "" : undefined}
          >
            <AgentAvatar agent={props.agent} class="browser-dock-avatar" />
          </span>
          <span class="browser-dock-tab-label">{tabLabel()}</span>
          <ChevronUp class="browser-dock-tab-chevron" aria-hidden="true" />
        </Button>
        <Show when={stepDone()}>
          {(done) => (
            <Button
              type="button"
              size="xs"
              class="browser-dock-tab-done"
              loading={props.handoffPending === true}
              onClick={() => done()()}
            >
              {t("prompt.browser.done")}
            </Button>
          )}
        </Show>
      </div>
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
            <Show when={queueRows().length > 0}>
              <QueuePanel
                variant="floating"
                deliveries={queueRows()}
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
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            class="browser-dock-hide"
            aria-label={t("browser.dock.hide")}
            title={t("browser.dock.hide")}
            onClick={() => void tuck()}
          >
            <ChevronDown aria-hidden="true" />
          </Button>
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
