import {
  BROWSER_DOCK_LIMITS,
  type BrowserDockAction,
  type BrowserDockGlass,
  type BrowserDockPresentation,
  LOCAL_SERVER_ID,
} from "@openbot/contracts/ipc";
import { BrowserDock } from "@openbot/ui/features/browser/BrowserDock";
import { clamp } from "@openbot/ui/utils";
import { createSignal, onSettled, Show } from "solid-js";
import { browserDockPort } from "./browser-dock-port";

/** The space above the dock for its shadow, in CSS pixels. */
const SHADOW_ROOM = 24;
const BLUR_PATTERN = /blur\(([\d.]+)px\)/;

/**
 * The browser dock in the overlay view above a local page. The main renderer owns the conversation: this
 * view shows what it publishes, sends each action back, and reports the space and the glass of the dock,
 * so main can size the overlay and blur the page under each glass shape.
 */
export function BrowserDockSurface() {
  const [presentation, setPresentation] = createSignal<BrowserDockPresentation | null>(null);
  /** The field keeps its own text while the user types. A new draft revision replaces it. */
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

  // Main decodes each action, so a failure here is a value that it refused; the dock stays as it was.
  function perform(action: BrowserDockAction) {
    void send(action);
  }

  /**
   * Resolves true when main has the action. The main renderer answers the agent; when that fails, it
   * publishes the card again with a new attempt.
   */
  function send(action: BrowserDockAction): Promise<boolean> {
    return browserDockPort()
      .browserDock.performAction(action)
      .then(
        () => true,
        () => false,
      );
  }

  /** The portals of the menus and popovers of the dock. They are children of the body, outside the root. */
  function portals(): HTMLElement[] {
    return [...document.body.children].filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && !(surface && child.contains(surface)) && child.tagName !== "SCRIPT",
    );
  }

  function measure(): { height: number; glass: BrowserDockGlass[] } {
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
    // A menu needs room above the dock, so the overlay takes the whole page while one is open.
    const needed = open.length > 0 ? BROWSER_DOCK_LIMITS.frameSize : viewport - dock.getBoundingClientRect().top;
    return { height: clamp(Math.ceil(needed + SHADOW_ROOM), 0, BROWSER_DOCK_LIMITS.frameSize), glass };
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
    // A spring moves the glass on each frame, so the blur follows it until the animations end. A spinner
    // that never ends does not move the glass.
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
        // A presentation that arrived first is newer than this answer.
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
            // The code goes to main from here and never through the main renderer.
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

/** The glass shape of `element`, measured from the left and the bottom of the overlay, or undefined. */
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
