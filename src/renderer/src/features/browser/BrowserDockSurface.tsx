import {
  BROWSER_DOCK_LIMITS,
  BROWSER_DOCK_OVERLAY_WIDTH,
  type BrowserDockAction,
  type BrowserDockFrame,
  type BrowserDockGlass,
  type BrowserDockPresentation,
  LOCAL_SERVER_ID,
} from "@openbot/contracts/ipc";
import { BrowserDock } from "@openbot/ui/features/browser/BrowserDock";
import { clamp } from "@openbot/ui/utils";
import { createSignal, onSettled, Show } from "solid-js";
import { browserDockPort } from "./browser-dock-port";

const SHADOW_ROOM = 24;
const BLUR_PATTERN = /blur\(([\d.]+)px\)/;

export function BrowserDockSurface() {
  const [presentation, setPresentation] = createSignal<BrowserDockPresentation | null>(null);
  const [text, setText] = createSignal("");
  let revision = -1;
  let received = false;
  let surface: HTMLDivElement | undefined;
  let seq = 0;
  let lastFrame = "";
  let frameRequest = 0;

  function apply(next: BrowserDockPresentation | null) {
    received = true;
    if (next && next.draft.revision !== revision) {
      revision = next.draft.revision;
      setText(next.draft.text);
    }
    setPresentation(next);
  }

  function perform(action: BrowserDockAction) {
    void send(action);
  }

  function send(action: BrowserDockAction): Promise<boolean> {
    return browserDockPort()
      .browserDock.performAction(action)
      .then(
        () => true,
        () => false,
      );
  }

  function portals(): HTMLElement[] {
    return [...document.body.children].filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && !(surface && child.contains(surface)) && child.tagName !== "SCRIPT",
    );
  }

  function measure(): Omit<BrowserDockFrame, "seq"> {
    const dock = surface?.firstElementChild;
    if (!(dock instanceof HTMLElement)) return { height: 0, glass: [] };
    const viewport = window.innerHeight;
    const open = portals();
    const glass: BrowserDockGlass[] = [];
    for (const root of [dock, ...open]) {
      for (const element of [root, ...root.querySelectorAll<HTMLElement>("*")]) {
        if (glass.length >= BROWSER_DOCK_LIMITS.glass) break;
        const shape = glassOf(element, viewport);
        if (shape) glass.push(shape);
      }
    }
    const tab = dock.hasAttribute("data-tucked") ? dock.querySelector(".browser-dock-tab") : null;
    const box = (tab ?? dock).getBoundingClientRect();
    const limit = BROWSER_DOCK_LIMITS.frameSize;
    const needed = open.length > 0 ? limit : viewport - box.top;
    const height = clamp(Math.ceil(needed + SHADOW_ROOM), 0, limit);
    const centre = window.innerWidth / 2;
    const reach = Math.max(centre - box.left, box.right - centre);
    const width =
      open.length > 0 ? limit : tab ? clamp(2 * Math.ceil(reach + SHADOW_ROOM), 0, limit) : BROWSER_DOCK_OVERLAY_WIDTH;
    const shift = (width - window.innerWidth) / 2;
    for (const shape of glass) shape.left = clamp(shape.left + shift, -limit, limit);
    return { height, glass, anchor: { width } };
  }

  function report() {
    frameRequest = 0;
    const frame = measure();
    const key = JSON.stringify(frame);
    if (key !== lastFrame) {
      lastFrame = key;
      seq += 1;
      void browserDockPort()
        .browserDock.setFrame({ seq, ...frame })
        .catch(() => undefined);
    }
    const moving = document
      .getAnimations()
      .some((animation) => animation.effect?.getTiming().iterations !== Number.POSITIVE_INFINITY);
    if (moving) schedule();
  }

  function schedule() {
    if (frameRequest === 0) frameRequest = requestAnimationFrame(report);
  }

  onSettled(() => {
    const stop = browserDockPort().browserDock.onPresentation(apply);
    void browserDockPort()
      .browserDock.getPresentation()
      .then((current) => {
        if (!received) apply(current);
      })
      .catch(() => undefined);
    const resize = new ResizeObserver(schedule);
    const mutation = new MutationObserver(schedule);
    if (surface) resize.observe(surface);
    mutation.observe(document.body, { childList: true, subtree: true, attributes: true });
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      stop();
      resize.disconnect();
      mutation.disconnect();
      window.removeEventListener("resize", schedule);
      if (frameRequest !== 0) cancelAnimationFrame(frameRequest);
    };
  });

  return (
    <div class="browser-dock-surface" ref={(element) => (surface = element)}>
      <Show when={presentation()}>
        {(dock) => (
          <BrowserDock
            agent={dock().agent}
            agents={dock().agents}
            skills={dock().skills}
            mcpServers={dock().mcpServers}
            value={text()}
            focusRequest={dock().focusRequest}
            sendShortcut={dock().sendShortcut}
            working={dock().working}
            deliveries={dock().deliveries}
            hold={dock().hold}
            editingDeliveryId={dock().editingDeliveryId}
            canSteer={dock().canSteer}
            island={dock().island}
            handoffPending={dock().handoffPending}
            onValueChange={(value) => {
              setText(value);
              perform({ type: "value-change", text: value });
            }}
            onSend={(value) => perform({ type: "send", text: value })}
            onStop={() => perform({ type: "stop" })}
            onSteer={dock().steerSupported ? (deliveryId) => perform({ type: "steer", deliveryId }) : undefined}
            onRunAsTask={dock().canRunAsTask ? (deliveryId) => perform({ type: "run-as-task", deliveryId }) : undefined}
            onCancel={(deliveryId) => perform({ type: "cancel", deliveryId })}
            onEdit={(delivery) => perform({ type: "edit", deliveryId: delivery.id })}
            onCancelEdit={() => perform({ type: "cancel-edit" })}
            onReorder={(deliveryIds) => perform({ type: "reorder", deliveryIds })}
            onHandoff={dock().canHandoff ? () => perform({ type: "handoff" }) : undefined}
            vault={{ server: null }}
            onRespondSecret={(input) => browserDockPort().agent.respondToBrowserSecret(input, LOCAL_SERVER_ID)}
            onAnswerPrompt={(requestId, answers) => send({ type: "answer-prompt", requestId, answers })}
            onRespondApproval={(requestId, decision) => send({ type: "respond-approval", requestId, decision })}
            onDismissReply={(id) => perform({ type: "dismiss-reply", id })}
            onOpenChat={() => perform({ type: "open-chat" })}
            onSelectAgent={(agentId) => perform({ type: "select-agent", agentId })}
            onOpenLink={(url) => perform({ type: "open-link", url })}
          />
        )}
      </Show>
    </div>
  );
}

function glassOf(element: HTMLElement, viewport: number): BrowserDockGlass | undefined {
  const style = getComputedStyle(element);
  const blur = BLUR_PATTERN.exec(style.backdropFilter);
  if (!blur || style.visibility === "hidden") return undefined;
  const rect = element.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return undefined;
  const limit = BROWSER_DOCK_LIMITS.frameSize;
  const radius = style.borderTopLeftRadius.endsWith("%")
    ? (Math.min(rect.width, rect.height) * Number.parseFloat(style.borderTopLeftRadius)) / 100
    : Number.parseFloat(style.borderTopLeftRadius);
  return {
    left: clamp(Math.round(rect.left), -limit, limit),
    bottom: clamp(Math.round(viewport - rect.bottom), -limit, limit),
    width: clamp(Math.round(rect.width), 0, limit),
    height: clamp(Math.round(rect.height), 0, limit),
    radius: clamp(Number.isFinite(radius) ? radius : 0, 0, limit),
    blur: clamp(Number.parseFloat(blur[1] ?? "0"), 0, BROWSER_DOCK_LIMITS.blur),
  };
}
