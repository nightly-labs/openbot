import { AppLogo } from "@openbot/brand";
import type { AppVariant } from "@openbot/contracts/ipc";
import { TRANSLATED_LOCALES, type TranslatedLocale } from "@openbot/i18n";
import { APP_LANGUAGE_OPTIONS, type AppLanguageOption } from "@openbot/i18n/languages";
import { ArrowRight, Button, ChevronDown, ChevronUp, IconButton, RadioGroup } from "@openbot/ui";
import { createSignal, createStore, For, onSettled } from "solid-js";
import { useText } from "../../text";

interface LanguageWheelProps {
  variant: AppVariant;
  /** The computer's language tag, such as `en-GB`. It picks the flag of a language spoken in several countries. */
  systemLocale: string;
  /** The language in the centre. The screen draws its own text in it. */
  language: TranslatedLocale;
  onChange: (language: TranslatedLocale) => void;
  onContinue: () => void;
}

interface WheelEntry {
  id: TranslatedLocale;
  option: AppLanguageOption;
}

const PRODUCT_NAME = "OpenBot";
const TITLE_ID = "language-wheel-title";

/** The catalog languages in selector order. "System default" is not a row: the wheel opens on it. */
const WHEEL: readonly WheelEntry[] = APP_LANGUAGE_OPTIONS.flatMap((option) => {
  const id = TRANSLATED_LOCALES.find((locale) => locale === option.id);
  return id ? [{ id, option }] : [];
});

/** The usual country of each catalog. Portuguese is the Brazilian catalog, so it keeps Brazil. */
const FLAG_REGION: Record<TranslatedLocale, string> = {
  en: "US",
  de: "DE",
  es: "ES",
  fr: "FR",
  it: "IT",
  ja: "JP",
  pl: "PL",
  pt: "BR",
  ru: "RU",
  tr: "TR",
};

/**
 * A language is not a country, so the flag follows the computer where it can: English on an
 * `en-GB` computer shows the British flag, Spanish on `es-MX` the Mexican one.
 */
function flagFor(id: TranslatedLocale, systemLocale: string): string {
  let region = FLAG_REGION[id];
  try {
    const locale = new Intl.Locale(systemLocale);
    if (id !== "pt" && locale.language === id && locale.region) region = locale.region;
  } catch {
    // An invalid system locale keeps the usual country.
  }
  return String.fromCodePoint(...[...region.toUpperCase()].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65));
}

/** Wheel and trackpad deltas below this move nothing; one gesture past it moves one row. */
const WHEEL_STEP_DELTA = 24;
/** The pause after a wheel step. A trackpad sends a burst of events for one swipe. */
const WHEEL_STEP_COOLDOWN_MS = 140;
/** Pointer travel before a press becomes a drag, so a click on a name still selects it. */
const DRAG_THRESHOLD_PX = 6;

/** Keys that turn the wheel from anywhere on the screen, not only from a focused radio. */
const WHEEL_KEY_STEP: Record<string, number> = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 };

/** The wheel is a loop, so every row index, however far a drag goes, names a language. */
function wheelIndex(index: number): number {
  return ((index % WHEEL.length) + WHEEL.length) % WHEEL.length;
}

/**
 * Rows from the centre to `row`, the short way round: from minus half the wheel to just under half.
 * The one row at the far side jumps between the two ends, and it is invisible there.
 */
function wheelOffset(row: number, position: number): number {
  return wheelIndex(row - position + WHEEL.length / 2) - WHEEL.length / 2;
}

/** A key typed into one of these is text, not a wheel command. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && target.type !== "radio";
}

/**
 * The wheel itself, a loop with no first or last row, so the language it opens on is always in the
 * centre with others above and below. Five ways to turn it: the arrow buttons, the scroll wheel or
 * a trackpad swipe, a drag, the arrow keys, and a click on a name. The keys work without focus
 * first, because this is the whole screen. Enter confirms.
 */
function LanguageWheelPicker(props: {
  systemLocale: string;
  language: TranslatedLocale;
  onChange: (language: TranslatedLocale) => void;
  onConfirm: () => void;
}) {
  const { t } = useText();
  const [viewport, setViewport] = createSignal<HTMLElement>();
  const [drag, setDrag] = createStore({ active: false, anchor: 0, offset: 0, row: 1 });
  const index = () =>
    Math.max(
      0,
      WHEEL.findIndex((entry) => entry.id === props.language),
    );
  const move = (to: number) => {
    const next = WHEEL[wheelIndex(to)];
    if (next && next.id !== props.language) props.onChange(next.id);
  };
  // While dragging, the wheel follows the pointer between rows, so sizes ease with it.
  const position = () => (drag.active ? drag.anchor + drag.offset / drag.row : index());

  onSettled(() => {
    const found = viewport();
    if (!found) return;
    // Typed here, so the listeners below keep the narrowing.
    const element: HTMLElement = found;
    const rowHeight = () => element.querySelector<HTMLElement>(".language-wheel-item")?.offsetHeight ?? 1;

    let wheelDelta = 0;
    let wheelLockedUntil = 0;
    function onWheel(event: WheelEvent): void {
      event.preventDefault();
      if (event.timeStamp < wheelLockedUntil) return;
      wheelDelta += event.deltaY;
      if (Math.abs(wheelDelta) < WHEEL_STEP_DELTA) return;
      move(index() + Math.sign(wheelDelta));
      wheelDelta = 0;
      wheelLockedUntil = event.timeStamp + WHEEL_STEP_COOLDOWN_MS;
    }

    let pointerId: number | null = null;
    let startY = 0;
    let dragged = false;
    function onPointerDown(event: PointerEvent): void {
      if (event.button !== 0) return;
      pointerId = event.pointerId;
      startY = event.clientY;
      dragged = false;
      setDrag((state) => {
        state.anchor = index();
        state.offset = 0;
        state.row = rowHeight();
      });
    }
    function onPointerMove(event: PointerEvent): void {
      if (event.pointerId !== pointerId) return;
      // A press released outside the wheel before the drag captured the pointer sent no `pointerup` here.
      if (event.buttons === 0) {
        onPointerEnd(event);
        return;
      }
      const travel = startY - event.clientY;
      if (!dragged && Math.abs(travel) < DRAG_THRESHOLD_PX) return;
      if (!dragged) {
        dragged = true;
        element.setPointerCapture(event.pointerId);
      }
      setDrag((state) => {
        state.active = true;
        state.offset = travel;
      });
      move(drag.anchor + Math.round(travel / drag.row));
    }
    function onPointerEnd(event: PointerEvent): void {
      if (event.pointerId !== pointerId) return;
      pointerId = null;
      setDrag((state) => {
        state.active = false;
        state.offset = 0;
      });
    }
    // The click that ends a drag must not select the name under the pointer.
    function onClickCapture(event: MouseEvent): void {
      if (!dragged) return;
      dragged = false;
      event.preventDefault();
      event.stopPropagation();
    }

    // Replaces the radios' own arrow handling so the keys work unfocused, and keeps focus on the
    // radio that is now checked when the wheel has it.
    function onKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (isTextEntry(event.target)) return;
      if (event.key === "Enter") {
        if (event.target instanceof HTMLButtonElement || event.target instanceof HTMLAnchorElement) return;
        event.preventDefault();
        props.onConfirm();
        return;
      }
      const step = WHEEL_KEY_STEP[event.key];
      let to: number;
      if (event.key === "Home") to = 0;
      else if (event.key === "End") to = WHEEL.length - 1;
      else if (step !== undefined) to = wheelIndex(index() + step);
      else return;
      event.preventDefault();
      move(to);
      if (event.target instanceof HTMLInputElement && element.contains(event.target)) {
        element.querySelectorAll("input")[to]?.focus();
      }
    }
    const view = element.ownerDocument.defaultView;

    view?.addEventListener("keydown", onKeyDown);
    element.addEventListener("wheel", onWheel, { passive: false });
    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("pointerup", onPointerEnd);
    element.addEventListener("pointercancel", onPointerEnd);
    element.addEventListener("click", onClickCapture, true);
    return () => {
      view?.removeEventListener("keydown", onKeyDown);
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", onPointerEnd);
      element.removeEventListener("pointercancel", onPointerEnd);
      element.removeEventListener("click", onClickCapture, true);
    };
  });

  return (
    <div class="language-wheel-frame">
      <div class="language-wheel" ref={setViewport} data-dragging={drag.active ? "" : undefined}>
        <RadioGroup.Root
          class="language-wheel-track"
          name="language-wheel"
          aria-labelledby={TITLE_ID}
          value={props.language}
          onChange={(value) => {
            const entry = WHEEL.find((candidate) => candidate.id === value);
            if (entry) props.onChange(entry.id);
          }}
        >
          <For each={WHEEL}>
            {(entry, row) => (
              <RadioGroup.Item
                class="language-wheel-item"
                value={entry.id}
                lang={entry.option.lang}
                style={{
                  "--offset": wheelOffset(row(), position()),
                  "--distance": Math.min(3, Math.abs(wheelOffset(row(), position()))),
                }}
              >
                <RadioGroup.ItemInput />
                <RadioGroup.ItemLabel class="language-wheel-label">
                  <span class="language-wheel-name">
                    <span class="language-wheel-flag" aria-hidden="true">
                      {flagFor(entry.id, props.systemLocale)}
                    </span>
                    {entry.option.label}
                  </span>
                </RadioGroup.ItemLabel>
              </RadioGroup.Item>
            )}
          </For>
        </RadioGroup.Root>
      </div>
      <div class="language-wheel-arrows">
        <IconButton label={t("account.language.previous")} variant="ghost" onClick={() => move(index() - 1)}>
          <ChevronUp aria-hidden="true" />
        </IconButton>
        <IconButton label={t("account.language.next")} variant="ghost" onClick={() => move(index() + 1)}>
          <ChevronDown aria-hidden="true" />
        </IconButton>
      </div>
    </div>
  );
}

/**
 * The first screen OpenBot shows, before sign-in, with the same brand lockup as the sign-in screen
 * after it. The screen text follows the language in the centre, so a reader sees each choice at once.
 */
export function LanguageWheel(props: LanguageWheelProps) {
  const { t } = useText();
  return (
    <main class="account-login-screen" lang={props.language}>
      <div class="language-wheel-shell">
        <header class="account-login-brand-lockup">
          <AppLogo variant={props.variant} animation="blink" interactive class="account-login-logo" />
          <span class="account-login-wordmark">{PRODUCT_NAME}</span>
        </header>
        <h1 id={TITLE_ID} class="language-wheel-title">
          {t("account.language.title")}
        </h1>
        <LanguageWheelPicker
          systemLocale={props.systemLocale}
          language={props.language}
          onChange={props.onChange}
          onConfirm={props.onContinue}
        />
        <Button type="button" class="language-wheel-continue" onClick={() => props.onContinue()}>
          {t("account.language.continue")}
          <ArrowRight aria-hidden="true" />
        </Button>
      </div>
    </main>
  );
}
