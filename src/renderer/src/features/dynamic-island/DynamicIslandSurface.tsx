import type {
  AppVariant,
  DynamicIslandAction,
  DynamicIslandPreference,
  DynamicIslandPresentation,
} from "@openbot/contracts/ipc";
import { DEFAULT_DYNAMIC_ISLAND_PREFERENCE, IDLE_DYNAMIC_ISLAND_PRESENTATION } from "@openbot/contracts/ipc";
import { presentationPriority } from "@openbot/team-client/dynamic-island-presentation";
import type { DynamicIslandNotchSize, DynamicIslandStateChangeReason, DynamicIslandViewState } from "@openbot/ui";
import { OpenBotDynamicIsland } from "@openbot/ui/features/dynamic-island/OpenBotDynamicIsland";
import { useText } from "@openbot/ui/text";
import { errorReference, type UserErrorDetails } from "@openbot/user-errors";
import { createEffect, createSignal, onSettled, Show } from "solid-js";
import { currentDevicePlatform } from "../../send-shortcut-preference";
import { windowShape } from "../../window-shape";
import { dynamicIslandPort } from "./dynamic-island-port";

const DEFAULT_NOTCH_WIDTH = 192;
const DEFAULT_NOTCH_HEIGHT = 32;
const SHAPED_WINDOW = currentDevicePlatform() === "linux";
const SHAPE_PARTS = ".dynamic-island-shell, .dynamic-island-hover-zone";
const SHAPE_TARGET = ".dynamic-island-shell .dynamic-island-size-target";
const MOTION_ROOM = 2;

type ShapeBox = { x: number; y: number; width: number; height: number };

function boxAround(boxes: readonly ShapeBox[]): ShapeBox {
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function DynamicIslandSurface() {
  const { t } = useText();
  const query = new URLSearchParams(window.location.search);
  const displayMode = query.get("display") === "island" ? "island" : "notch";
  const builtInDisplay = query.get("built-in") === "true";
  const variant = readAppVariant(query.get("variant"));
  const queryNotchWidth = query.get("notch-width");
  const initialNotchSize: DynamicIslandNotchSize | undefined =
    queryNotchWidth === null
      ? undefined
      : {
          width: readPositivePixelValue(queryNotchWidth, DEFAULT_NOTCH_WIDTH),
          height: readPositivePixelValue(query.get("notch-height"), DEFAULT_NOTCH_HEIGHT),
        };
  const [notchSize, setNotchSize] = createSignal<DynamicIslandNotchSize | undefined>(initialNotchSize);
  const [presentation, setPresentation] = createSignal(IDLE_DYNAMIC_ISLAND_PRESENTATION);
  const [preference, setPreference] = createSignal<DynamicIslandPreference>({
    ...DEFAULT_DYNAMIC_ISLAND_PREFERENCE,
  });
  const [viewState, setViewState] = createSignal<DynamicIslandViewState>("compact");
  const [actionError, setActionError] = createSignal<UserErrorDetails>();
  let actionGeneration = 0;
  let pointerInside = false;
  let focusInside = false;
  let keyboardInside = false;
  let queuedPresentation: DynamicIslandPresentation | undefined;
  let anchor: HTMLFieldSetElement | undefined;
  let sentShape: string | undefined;
  let motionBox: ShapeBox | undefined;
  const followedMotions = new WeakSet<Animation>();
  let shapeStopped = false;
  const shapeObserver = SHAPED_WINDOW ? new MutationObserver(() => followShape()) : undefined;
  const visible = () => presentation().mode !== "idle" || preference().idleVisible;

  function sendShape(parts: readonly ShapeBox[]): void {
    const shape = windowShape(parts);
    const key = JSON.stringify(shape);
    if (key === sentShape) return;
    sentShape = key;
    void dynamicIslandPort()
      .dynamicIsland.setInputRegion(shape)
      .catch(() => undefined);
  }

  function followShape(): void {
    if (!shapeObserver || shapeStopped) return;
    const parts = visible() && anchor?.isConnected ? [...anchor.querySelectorAll(SHAPE_PARTS)] : [];
    const still: ShapeBox[] = [];
    const moving: ShapeBox[] = [];
    for (const part of parts) {
      const motions = part.getAnimations().filter((motion) => motion.playState === "running");
      (motions.length > 0 ? moving : still).push(part.getBoundingClientRect());
      for (const motion of motions) {
        if (followedMotions.has(motion)) continue;
        followedMotions.add(motion);
        motion.finished.then(followShape, followShape);
      }
    }
    if (moving.length === 0) {
      motionBox = undefined;
      sendShape(still);
      return;
    }
    const target = anchor?.querySelector(SHAPE_TARGET)?.getBoundingClientRect();
    motionBox = boxAround([...(motionBox ? [motionBox] : []), ...moving, ...(target ? [target] : [])]);
    sendShape([
      ...still,
      {
        x: motionBox.x - MOTION_ROOM,
        y: motionBox.y - MOTION_ROOM,
        width: motionBox.width + MOTION_ROOM * 2,
        height: motionBox.height + MOTION_ROOM * 2,
      },
    ]);
  }

  function observeShape(element: HTMLFieldSetElement): void {
    anchor = element;
    if (!shapeObserver) return;
    shapeObserver.disconnect();
    shapeObserver.observe(element, { attributes: true, childList: true, subtree: true });
    queueMicrotask(followShape);
  }
  createEffect(visible, () => queueMicrotask(followShape));

  function applyPresentation(next: DynamicIslandPresentation): void {
    if (
      interactionLocksPresentation(
        presentation(),
        next,
        pointerInside || focusInside || viewState() === "expanded",
        keyboardInside,
      )
    ) {
      queuedPresentation = next;
      return;
    }
    queuedPresentation = undefined;
    commitPresentation(next);
  }

  function commitPresentation(next: DynamicIslandPresentation): void {
    if (presentationIdentity(next) !== presentationIdentity(presentation())) clearActionError();
    setPresentation(next);
    if (next.mode === "idle") {
      setViewState("compact");
      if (!preference().idleVisible) closeInteraction();
    }
  }

  function applyPreference(next: DynamicIslandPreference): void {
    setPreference(next);
    if (!next.idleVisible && presentation().mode === "idle") {
      setViewState("compact");
      closeInteraction();
    }
  }

  function changeViewState(next: DynamicIslandViewState, reason: DynamicIslandStateChangeReason): void {
    if (reason === "hover-exit" && keyboardInside && isTextField(document.activeElement)) return;
    if (reason === "pointer" || reason === "keyboard" || reason === "escape") performHaptic();
    setViewState(next);
    if (next === "compact" && keyboardInside) {
      keyboardInside = false;
      void syncInteractive();
    }
    if (next === "compact") clearActionError();
    if (next === "compact" && !pointerInside && !focusInside) applyQueuedPresentation();
  }

  function applyQueuedPresentation(): void {
    const next = queuedPresentation;
    queuedPresentation = undefined;
    if (next) commitPresentation(next);
  }

  function syncInteractive(): Promise<void> {
    const interactive = pointerInside || focusInside;
    return dynamicIslandPort().dynamicIsland.setInteractive({ interactive, keyboard: interactive && keyboardInside });
  }

  function beginPointerInteraction(): void {
    pointerInside = true;
    void syncInteractive();
  }

  function endPointerInteraction(): void {
    pointerInside = false;
    if (viewState() === "compact" && !focusInside) applyQueuedPresentation();
    void syncInteractive();
  }

  function beginFocusInteraction(): void {
    focusInside = true;
    void syncInteractive();
  }

  function endFocusInteraction(): void {
    focusInside = false;
    if (viewState() === "compact" && !pointerInside) applyQueuedPresentation();
    void syncInteractive();
  }

  function closeInteraction(): void {
    pointerInside = false;
    focusInside = false;
    keyboardInside = false;
    if (viewState() === "compact") applyQueuedPresentation();
    void syncInteractive();
  }

  function enterInteraction(event: MouseEvent & { currentTarget: HTMLFieldSetElement }): void {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    if (!pointerInside) performHaptic();
    beginPointerInteraction();
  }

  function leaveInteraction(event: MouseEvent & { currentTarget: HTMLFieldSetElement }): void {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    endPointerInteraction();
  }

  function leaveFocusInteraction(event: FocusEvent & { currentTarget: HTMLFieldSetElement }): void {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    keyboardInside = false;
    endFocusInteraction();
  }

  async function requestKeyboard(event: PointerEvent): Promise<void> {
    const field = event.target;
    if (!isTextField(field)) return;
    if (!keyboardInside) {
      keyboardInside = true;
      await syncInteractive();
    }
    if (keyboardInside && document.activeElement !== field) field.focus();
  }

  function clearActionError(): number {
    setActionError(undefined);
    return ++actionGeneration;
  }

  async function perform(action: DynamicIslandAction): Promise<boolean> {
    performHaptic();
    const generation = clearActionError();
    try {
      await dynamicIslandPort().dynamicIsland.performAction(action);
    } catch (error) {
      if (generation === actionGeneration)
        setActionError({ message: t("island.action.failed"), reference: errorReference(error) });
      return false;
    }
    pointerInside = false;
    focusInside = false;
    keyboardInside = false;
    setViewState("compact");
    applyQueuedPresentation();
    await dynamicIslandPort().dynamicIsland.setInteractive({ interactive: false });
    return true;
  }

  function performHaptic(): void {
    void dynamicIslandPort()
      .dynamicIsland.performHaptic()
      .catch(() => undefined);
  }

  onSettled(() => {
    void dynamicIslandPort()
      .dynamicIsland.getPresentation()
      .then(applyPresentation)
      .catch(() => undefined);
    void dynamicIslandPort()
      .dynamicIsland.getPreference()
      .then(applyPreference)
      .catch(() => undefined);
    const stopPreference = dynamicIslandPort().dynamicIsland.onPreference(applyPreference);
    const stopPresentation = dynamicIslandPort().dynamicIsland.onPresentation(applyPresentation);
    const stopGeometry = dynamicIslandPort().dynamicIsland.onGeometry((next) => setNotchSize(next ?? undefined));
    const close = () => {
      pointerInside = false;
      focusInside = false;
      keyboardInside = false;
      setViewState("compact");
      clearActionError();
      applyQueuedPresentation();
      void dynamicIslandPort().dynamicIsland.setInteractive({ interactive: false });
    };
    window.addEventListener("blur", close);
    window.addEventListener("resize", followShape);
    return () => {
      stopPreference();
      stopPresentation();
      stopGeometry();
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", followShape);
      shapeStopped = true;
      shapeObserver?.disconnect();
    };
  });
  return (
    <main
      class="dynamic-island-surface"
      aria-label={notchSize() ? t("island.surface.label") : t("island.surface.labelIsland")}
    >
      <Show when={visible()}>
        <fieldset
          ref={observeShape}
          class="dynamic-island-surface-anchor"
          aria-label={t("island.surface.interactionArea")}
          onMouseOver={enterInteraction}
          onMouseOut={leaveInteraction}
          onFocus={beginFocusInteraction}
          onFocusIn={beginFocusInteraction}
          onBlur={leaveFocusInteraction}
          onFocusOut={leaveFocusInteraction}
          onPointerDown={(event) => void requestKeyboard(event)}
        >
          <OpenBotDynamicIsland
            presentation={presentation()}
            state={viewState()}
            displayMode={displayMode}
            builtInDisplay={builtInDisplay}
            variant={variant}
            notchSize={displayMode === "notch" ? notchSize() : undefined}
            widthPercent={preference().widthPercent}
            heightPercent={preference().heightPercent}
            extendedHoverArea
            idleInsideNotch
            inlineReply
            onStateChange={changeViewState}
            onAction={perform}
            actionError={actionError()}
            onHaptic={performHaptic}
          />
        </fieldset>
      </Show>
    </main>
  );
}

function isTextField(target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

function readAppVariant(value: string | null): AppVariant {
  return value === "dev" || value === "preview" ? value : "production";
}

function readPositivePixelValue(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function interactionLocksPresentation(
  current: DynamicIslandPresentation,
  next: DynamicIslandPresentation,
  interacting: boolean,
  typing: boolean,
): boolean {
  if (!interacting || !(typing || isCriticalPresentation(current))) return false;
  if (isCriticalPresentation(current) && heldRequestEnded(current, next)) return false;
  return presentationIdentity(current) !== presentationIdentity(next);
}

function heldRequestEnded(current: DynamicIslandPresentation, next: DynamicIslandPresentation): boolean {
  return presentationPriority(next.mode) > presentationPriority(current.mode);
}

function isCriticalPresentation(presentation: DynamicIslandPresentation): boolean {
  return (
    presentation.mode === "approval" ||
    presentation.mode === "question" ||
    presentation.mode === "takeover" ||
    presentation.mode === "failed"
  );
}

function presentationIdentity(presentation: DynamicIslandPresentation): string {
  if (presentation.mode === "approval" || presentation.mode === "question" || presentation.mode === "takeover") {
    return `${presentation.serverId}:${presentation.mode}:${String(presentation.item.requestId)}`;
  }
  if (presentation.mode === "failed") {
    return `${presentation.serverId}:${presentation.mode}:${presentation.item.turnId}`;
  }
  if (presentation.mode === "message") {
    return `${presentation.serverId}:${presentation.mode}:${presentation.message.messageId}`;
  }
  return `${presentation.serverId}:${presentation.mode}`;
}
