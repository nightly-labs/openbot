import { AppLogo } from "@openbot/brand";
import type { AppVariant } from "@openbot/contracts/ipc";
import { TRANSLATED_LOCALES, type TranslatedLocale } from "@openbot/i18n";
import { APP_LANGUAGE_OPTIONS, type AppLanguageOption } from "@openbot/i18n/languages";
import { ArrowRight, Button, ChevronDown, ChevronUp, IconButton, RadioGroup } from "@openbot/ui";
import { createSignal, createStore, For, onSettled } from "solid-js";
import { useText } from "../../text";

interface LanguageWheelProps {
  variant: AppVariant;
  systemLocale: string;
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

const WHEEL: readonly WheelEntry[] = APP_LANGUAGE_OPTIONS.flatMap((option) => {
  const id = TRANSLATED_LOCALES.find((locale) => locale === option.id);
  return id ? [{ id, option }] : [];
});

const FLAG_REGION: Record<TranslatedLocale, string> = {
  en: "US",
  ar: "SA",
  de: "DE",
  es: "ES",
  fr: "FR",
  he: "IL",
  it: "IT",
  ja: "JP",
  ko: "KR",
  nl: "NL",
  pl: "PL",
  pt: "BR",
  ru: "RU",
  tr: "TR",
  zh: "CN",
};

function flagFor(id: TranslatedLocale, systemLocale: string): string {
  let region = FLAG_REGION[id];
  try {
    const locale = new Intl.Locale(systemLocale);
    if (id !== "pt" && locale.language === id && locale.region) region = locale.region;
  } catch {}
  return String.fromCodePoint(...[...region.toUpperCase()].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65));
}

const WHEEL_STEP_DELTA = 24;
const WHEEL_STEP_COOLDOWN_MS = 140;
const DRAG_THRESHOLD_PX = 6;

const WHEEL_KEY_STEP: Record<string, number> = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 };

function wheelIndex(index: number): number {
  return ((index % WHEEL.length) + WHEEL.length) % WHEEL.length;
}

function wheelOffset(row: number, position: number): number {
  return wheelIndex(row - position + WHEEL.length / 2) - WHEEL.length / 2;
}

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && target.type !== "radio";
}

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
  const position = () => (drag.active ? drag.anchor + drag.offset / drag.row : index());

  onSettled(() => {
    const found = viewport();
    if (!found) return;
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
    function onClickCapture(event: MouseEvent): void {
      if (!dragged) return;
      dragged = false;
      event.preventDefault();
      event.stopPropagation();
    }

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
