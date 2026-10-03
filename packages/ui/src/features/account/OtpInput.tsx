import { ONE_TIME_CODE_ALPHABET, ONE_TIME_CODE_LENGTH } from "@openbot/contracts/validation";
import { Input } from "@openbot/ui";
import { prefersReducedMotion } from "@openbot/ui/utils";
import { createEffect, createMemo, createSignal, createUniqueId, For, flush, Show, untrack } from "solid-js";
import { useText } from "../../text";

export type OtpInputStatus = "idle" | "verifying" | "error" | "success";

interface OtpInputProps {
  value: string;
  length?: number;
  numeric?: boolean;
  masked?: boolean;
  label?: string;
  status?: OtpInputStatus;
  hint?: string;
  errorMessage?: string | null;
  successMessage?: string;
  disabled?: boolean;
  autofocus?: boolean;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
}

export function OtpInput(props: OtpInputProps) {
  const { t } = useText();
  const length = () => props.length ?? ONE_TIME_CODE_LENGTH;
  const alphabet = () => (props.numeric ? "0123456789" : ONE_TIME_CODE_ALPHABET);
  const groupAt = () => Math.ceil(length() / 2);
  const inputId = `openbot-otp-${createUniqueId()}`;
  const messageId = `${inputId}-message`;
  const initialSlots = toSlots(untrack(() => props.value));
  const [slots, setSlots] = createSignal(initialSlots);
  const [active, setActive] = createSignal(firstEmptySlot(initialSlots));
  const [focused, setFocused] = createSignal(false);
  let inputElement: HTMLInputElement | undefined;
  let slotsElement: HTMLDivElement | undefined;
  let composing = false;
  // An IME can still change composed text, so a code that it completes is
  // submitted at `compositionend`, not before.
  let completeAfterComposition = false;

  const status = () => props.status ?? "idle";
  const disabled = () => Boolean(props.disabled || status() === "verifying" || status() === "success");
  const message = createMemo(() => {
    if (status() === "success") return props.successMessage ?? t("account.login.verified");
    if (status() === "error") return props.errorMessage ?? t("account.otp.incorrect");
    if (status() === "verifying") return t("account.otp.verifying");
    return props.hint;
  });

  createEffect(
    () => Boolean(props.autofocus && !disabled()),
    (shouldFocus) => {
      if (!shouldFocus) return;
      queueMicrotask(() => inputElement?.focus({ preventScroll: true }));
    },
  );

  createEffect(
    () => props.value,
    (value) => {
      const incoming = sanitize(value);
      if (incoming === untrack(() => slots().join(""))) return;
      const next = toSlots(incoming);
      setSlots(next);
      setActive(firstEmptySlot(next));
    },
  );

  // The native input keeps the code as its value. iOS and Android autofill and
  // keyboard suggestions read and replace that value, and a soft keyboard that
  // sends no key name edits it in place. An IME owns the value while it
  // composes, so the copy waits for `compositionend`.
  createEffect(
    () => slots().join(""),
    () => syncNativeValue(),
  );

  createEffect(
    () => status(),
    (nextStatus, previousStatus) => {
      if (nextStatus !== "error" || previousStatus === "error" || prefersReducedMotion() || !slotsElement) return;
      slotsElement.animate?.(
        [
          { transform: "translateX(0)" },
          { transform: "translateX(-5px)" },
          { transform: "translateX(5px)" },
          { transform: "translateX(-3px)" },
          { transform: "translateX(3px)" },
          { transform: "translateX(-1px)" },
          { transform: "translateX(0)" },
        ],
        { duration: 200, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
      );
    },
  );

  function commit(next: string[]): void {
    const previous = slots().join("");
    setSlots(next);
    const value = next.join("");
    props.onChange(value);
    if (value === previous) return;
    const complete = next.every(Boolean);
    if (composing) {
      completeAfterComposition = complete;
      return;
    }
    if (complete) {
      props.onComplete?.(value);
      inputElement?.focus({ preventScroll: true });
    }
  }

  function applyCode(value: string): void {
    const next = toSlots(value);
    commit(next);
    setActive(firstEmptySlot(next));
  }

  function clearSlot(index: number): void {
    const next = [...slots()];
    next[index] = "";
    commit(next);
  }

  function insert(raw: string, from = active()): void {
    const characters = sanitize(raw);
    if (!characters) return;
    const next = [...slots()];
    let index = from;
    for (const character of characters) {
      if (index >= length()) break;
      next[index] = character;
      index += 1;
    }
    commit(next);
    setActive(Math.min(index, length() - 1));
  }

  function syncNativeValue(): void {
    const value = slots().join("");
    if (!inputElement || composing || inputElement.value === value) return;
    inputElement.value = value;
    inputElement.setSelectionRange(value.length, value.length);
  }

  function backspace(): void {
    if (slots()[active()]) {
      clearSlot(active());
    } else if (active() > 0) {
      const previous = active() - 1;
      clearSlot(previous);
      setActive(previous);
    }
  }

  function handleInput(event: InputEvent & { currentTarget: HTMLInputElement }): void {
    if (disabled()) {
      syncNativeValue();
      return;
    }
    // Android keyboards send `Unidentified` keydown events, so one typed
    // character or a backspace arrives here and edits the active slot.
    const typed = event.inputType === "insertText" && !event.isComposing ? sanitize(event.data ?? "") : "";
    if (typed.length === 1) {
      insert(typed);
    } else if (event.inputType === "deleteContentBackward") {
      backspace();
    } else {
      // Autofill, a suggestion, or IME text: the inserted text can be the full
      // code, with its hyphen. Otherwise the field value is the code. The field
      // does not show empty slots, so text that adds no code character, such
      // as a hyphen, must not move the characters after an empty slot.
      const inserted = sanitize(event.data ?? "");
      const value = inserted.length === length() ? inserted : sanitize(event.currentTarget.value);
      if (value !== slots().join("")) applyCode(value);
    }
    // The field can hold text that the code drops, such as a hyphen or a
    // ninth character, and then the slots do not change to start the effect.
    flush();
    syncNativeValue();
  }

  function handleCompositionEnd(event: CompositionEvent & { currentTarget: HTMLInputElement }): void {
    composing = false;
    const pending = completeAfterComposition;
    completeAfterComposition = false;
    if (!disabled()) {
      const value = sanitize(event.currentTarget.value);
      if (value !== slots().join("")) applyCode(value);
      else if (pending && value.length === length()) props.onComplete?.(value);
    }
    flush();
    syncNativeValue();
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (disabled()) {
      event.preventDefault();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.toUpperCase();
    if (key.length === 1 && alphabet().includes(key)) {
      event.preventDefault();
      insert(key);
      return;
    }
    if (event.key === "Backspace") {
      event.preventDefault();
      backspace();
      return;
    }
    if (event.key === "Delete") {
      event.preventDefault();
      clearSlot(active());
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, length() - 1));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setActive(length() - 1);
    }
  }

  function handlePointerDown(event: PointerEvent): void {
    if (disabled()) return;
    event.preventDefault();
    const slot = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-otp-index]") : null;
    const requested = slot ? Number.parseInt(slot.dataset.otpIndex ?? "0", 10) : slotIndexAtX(event.clientX);
    setActive(Math.min(Math.max(Number.isFinite(requested) ? requested : 0, 0), length() - 1));
    inputElement?.focus();
  }

  function slotIndexAtX(pointerX: number): number {
    const slotElements = slotsElement?.querySelectorAll<HTMLElement>(".otp-input-slot");
    if (!slotElements?.length) return 0;
    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;
    slotElements.forEach((element, index) => {
      const bounds = element.getBoundingClientRect();
      const distance = Math.abs(pointerX - (bounds.left + bounds.width / 2));
      if (distance >= closestDistance) return;
      closestIndex = index;
      closestDistance = distance;
    });
    return closestIndex;
  }

  return (
    <div class="otp-input" data-status={status()}>
      {/*
        The slot characters below are loose text in the accessibility tree.
        Naming this group is what lets both consumers tell what they are:
        assistive tech announces the context, and `dev:automation` recognizes
        the subtree whose text and control values it must not print into an
        agent transcript.
      */}
      <fieldset
        class="otp-input-fieldset"
        aria-label={t("account.otp.entry")}
        aria-disabled={disabled() ? "true" : undefined}
        onPointerDown={handlePointerDown}
      >
        <Input
          ref={(element) => (inputElement = element)}
          id={inputId}
          class="otp-input-native"
          type={props.masked ? "password" : "text"}
          inputmode={props.numeric ? "numeric" : "text"}
          autocomplete="one-time-code"
          autocapitalize="characters"
          autocorrect="off"
          spellcheck={false}
          readonly={Boolean(props.disabled || status() === "success")}
          aria-label={props.label ?? t("account.otp.label")}
          aria-invalid={status() === "error" ? "true" : undefined}
          aria-describedby={message() ? messageId : undefined}
          autofocus={props.autofocus}
          onBlur={() => setFocused(false)}
          onFocus={() => setFocused(true)}
          onCompositionStart={() => (composing = true)}
          onCompositionEnd={handleCompositionEnd}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={(event) => {
            event.preventDefault();
            if (disabled()) return;
            const value = sanitize(event.clipboardData?.getData("text") ?? "");
            insert(value, value.length === length() ? 0 : active());
          }}
        />

        <div
          ref={(element) => (slotsElement = element)}
          class="otp-input-slots"
          style={{
            "--otp-active-index": String(active()),
            "--otp-length": String(length()),
            "--otp-group-offset": active() >= groupAt() ? "var(--otp-group-gap)" : "0px",
          }}
        >
          <span class="otp-input-focus-ring" data-visible={focused() && status() !== "success" ? "true" : undefined} />
          <For each={slots()} keyed={false}>
            {(character, index) => (
              <span
                class="otp-input-slot"
                data-active={focused() && index === active() ? "true" : undefined}
                data-filled={character() ? "true" : undefined}
                data-otp-index={index}
                data-group-start={index === groupAt() ? "true" : undefined}
              >
                <Show when={focused() && index === active() && status() !== "success"}>
                  <span class="otp-input-caret" data-trailing={character() ? "true" : undefined} aria-hidden="true" />
                </Show>
                <Show when={character()} keyed>
                  {(value) => <span class="otp-input-character">{props.masked ? "•" : value}</span>}
                </Show>
              </span>
            )}
          </For>
        </div>
      </fieldset>

      <Show when={message()}>
        {(content) => (
          <p
            id={messageId}
            class="otp-input-message"
            role={status() === "error" ? "alert" : "status"}
            aria-live={status() === "error" ? "assertive" : "polite"}
          >
            <Show when={status() === "success"}>
              <svg class="otp-input-success" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 13l4 4L19 7" />
              </svg>
            </Show>
            {content()}
          </p>
        )}
      </Show>
    </div>
  );

  function sanitize(value: string): string {
    return value
      .toUpperCase()
      .split("")
      .filter((character) => alphabet().includes(character))
      .join("")
      .slice(0, length());
  }

  function toSlots(value: string): string[] {
    const characters = sanitize(value);
    return Array.from({ length: length() }, (_, index) => characters[index] ?? "");
  }

  function firstEmptySlot(slots: string[]): number {
    const index = slots.findIndex((character) => !character);
    return index === -1 ? length() - 1 : index;
  }
}
