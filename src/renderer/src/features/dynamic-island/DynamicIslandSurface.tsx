import type {
  AppVariant,
  DynamicIslandAction,
  DynamicIslandPreference,
  DynamicIslandPresentation,
} from "@openbot/contracts/ipc";
import { DEFAULT_DYNAMIC_ISLAND_PREFERENCE, IDLE_DYNAMIC_ISLAND_PRESENTATION } from "@openbot/contracts/ipc";
import type { DynamicIslandNotchSize, DynamicIslandStateChangeReason, DynamicIslandViewState } from "@openbot/ui";
import { OpenBotDynamicIsland } from "@openbot/ui/features/dynamic-island/OpenBotDynamicIsland";
import { useText } from "@openbot/ui/text";
import { errorReference, type UserErrorDetails } from "@openbot/user-errors";
import { createSignal, onSettled, Show } from "solid-js";
import { dynamicIslandPort } from "./dynamic-island-port";

const DEFAULT_NOTCH_WIDTH = 192;
const DEFAULT_NOTCH_HEIGHT = 32;

export function DynamicIslandSurface() {
  const { t } = useText();
  const query = new URLSearchParams(window.location.search);
  const displayMode = query.get("display") === "island" ? "island" : "notch";
  const variant = readAppVariant(query.get("variant"));
  // The main process names a notch only on a MacBook that has one. Without it, the island draws its
  // own gap, which follows the width setting.
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
  // A failed action keeps the panel open with this message, so an Approve that did not reach the
  // agent does not look like it worked.
  const [actionError, setActionError] = createSignal<UserErrorDetails>();
  // Each action and each clear starts a new generation, so a late failure does not show on another panel.
  let actionGeneration = 0;
  let pointerInside = false;
  let focusInside = false;
  // A reply field was pressed. The panel is not focusable by default, so main makes it key only until
  // the focus leaves the island. A focus change inside the island keeps it key: when the panel stops
  // being key, its blur collapses the island before a click on an option lands.
  let keyboardInside = false;
  let queuedPresentation: DynamicIslandPresentation | undefined;

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
    // The pointer can leave while the user types a reply. Escape, Close and a click outside still collapse.
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

  /** A press on a reply field asks main for key input, then puts the caret in the field. */
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

  /** Resolves `false` when the action failed. */
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
    return () => {
      stopPreference();
      stopPresentation();
      stopGeometry();
      window.removeEventListener("blur", close);
    };
  });
  return (
    <main class="dynamic-island-surface" aria-label={t("island.surface.label")}>
      <Show when={presentation().mode !== "idle" || preference().idleVisible}>
        <fieldset
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
            variant={variant}
            notchSize={displayMode === "notch" ? notchSize() : undefined}
            widthPercent={preference().widthPercent}
            heightPercent={preference().heightPercent}
            extendedHoverArea
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
  // While the user types a reply, a new card must not take the draft to another agent.
  if (!interacting || !(typing || isCriticalPresentation(current))) return false;
  return presentationIdentity(current) !== presentationIdentity(next);
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
