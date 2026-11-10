/**
 * The chat color picker: a SolidJS port of the beUI motion color picker.
 * Source: https://beui.dev/components/motion/color-picker (github.com/starc007/ui-components).
 *
 * MIT License. Copyright (c) 2026 Saurabh Chauhan. Permission is hereby granted, free of charge, to
 * any person obtaining a copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation the rights to use,
 * copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all copies or
 * substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY
 * KIND, EXPRESS OR IMPLIED.
 *
 * The port keeps the area with its loupe, the hue slider, the eye dropper, the format switch with
 * the hex field or the RGB and HSL channels, the swatch and the presets with the hopping ring. The
 * presets are "no color" and the swatches of the caller. It drops alpha, because a tint has no
 * opacity. Springs come from `@openbot/ui/spring-motion` as CSS `linear()` curves and WAAPI
 * keyframes. The panel has a 1px ring and no drop shadow.
 *
 * `ColorPickerPopover` floats the picker beside its trigger, and `ColorPickerTrigger` is a trigger
 * that looks like the select triggers.
 */

import type { AvatarColor } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { type JSX, Portal } from "@solidjs/web";
import ChevronsUpDown from "lucide-solid/icons/chevrons-up-down";
import Pipette from "lucide-solid/icons/pipette";
import { createEffect, createMemo, createSignal, For, onSettled, Show, untrack } from "solid-js";
import { type Spring, springKeyframes, springProgress } from "./spring-motion";
import { useText } from "./text";

// ---------------------------------------------------------------------------
// Color math (as in beUI)
// ---------------------------------------------------------------------------

interface Hsv {
  h: number;
  s: number;
  v: number;
}
interface Rgb {
  r: number;
  g: number;
  b: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const sat = s / 100;
  const val = v / 100;
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return val - val * sat * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return { r: Math.round(f(5) * 255), g: Math.round(f(3) * 255), b: Math.round(f(1) * 255) };
}

/** `previous` keeps hue for greys and saturation for black, which RGB cannot carry. */
function rgbToHsv({ r, g, b }: Rgb, previous?: Hsv): Hsv {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const d = max - Math.min(rn, gn, bn);
  let h = previous?.h ?? 0;
  if (d) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max ? (d / max) * 100 : (previous?.s ?? 0), v: max * 100 };
}

function hsvToHsl({ h, s, v }: Hsv) {
  const sv = s / 100;
  const vv = v / 100;
  const l = vv * (1 - sv / 2);
  const sl = l === 0 || l === 1 ? 0 : (vv - l) / Math.min(l, 1 - l);
  return { h, s: sl * 100, l: l * 100 };
}

function hslToHsv(h: number, s: number, l: number, previous: Hsv): Hsv {
  const sl = s / 100;
  const ll = l / 100;
  const v = ll + sl * Math.min(ll, 1 - ll);
  return { h, s: v ? 2 * (1 - ll / v) * 100 : previous.s, v: v * 100 };
}

const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

function parseHex(input: string): Rgb | null {
  const match = HEX_PATTERN.exec(input.trim());
  let hex = match?.[1];
  if (!hex) return null;
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join("");
  const n = (i: number) => Number.parseInt(hex.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4) };
}

function formatHex({ r, g, b }: Rgb): AvatarColor {
  const pair = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return `#${pair(r)}${pair(g)}${pair(b)}`;
}

// ---------------------------------------------------------------------------
// Springs. The beUI springs (stiffness, damping, mass) as a period and a damping fraction.
// ---------------------------------------------------------------------------

function physical(stiffness: number, damping: number, mass: number): Spring {
  const angular = Math.sqrt(stiffness / mass);
  return {
    response: (2 * Math.PI) / angular,
    dampingFraction: Math.min(1, damping / (2 * Math.sqrt(stiffness * mass))),
  };
}

const SPRING_PRESS = physical(500, 30, 0.6);
const SPRING_LAYOUT = physical(360, 32, 0.6);
const LOUPE_LIFT = physical(520, 24, 0.6);

/** A spring as a CSS `linear()` easing, to use with a duration of `spring.response` seconds. */
function springEasing(spring: Spring, samples = 40): string {
  const end = springProgress(spring.response, spring);
  const points = Array.from({ length: samples + 1 }, (_, index) =>
    index === samples ? 1 : springProgress((index / samples) * spring.response, spring) / end,
  );
  return `linear(${points.map((point) => point.toFixed(4)).join(", ")})`;
}

const SPRING_STYLE = [
  `--chat-color-press-ease: ${springEasing(SPRING_PRESS)}`,
  `--chat-color-press-duration: ${Math.round(SPRING_PRESS.response * 1000)}ms`,
  `--chat-color-layout-ease: ${springEasing(SPRING_LAYOUT)}`,
  `--chat-color-layout-duration: ${Math.round(SPRING_LAYOUT.response * 1000)}ms`,
  `--chat-color-lift-ease: ${springEasing(LOUPE_LIFT)}`,
  `--chat-color-lift-duration: ${Math.round(LOUPE_LIFT.response * 1000)}ms`,
].join("; ");

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A preset swatch: its color and its accessible name. */
interface ColorPreset {
  value: AvatarColor;
  label: string;
}

// ---------------------------------------------------------------------------
// The picker
// ---------------------------------------------------------------------------

export interface ColorPickerProps {
  /** Names the panel, for example "Your chat color". */
  label: string;
  /** The preset swatches after "No color". */
  presets: readonly ColorPreset[];
  /** The current color, or null for no color. */
  value: AvatarColor | null;
  /** Live: each drag frame, key, preset and field commit. */
  onChange: (value: AvatarColor | null) => void;
  /** The name of the first swatch, which gives null. "No color" when it is absent. */
  clearLabel?: string;
}

/** The area starts on this blue when there is no color yet. */
const START_COLOR = "#3478f6";

export function ColorPicker(props: ColorPickerProps) {
  const { t } = useText();
  // The picker owns its state while it is open: the value is read once, as the start value.
  const start = untrack(() => props.value);
  const [hsv, setHsv] = createSignal<Hsv>(rgbToHsv(parseHex(start ?? START_COLOR) ?? { r: 52, g: 120, b: 246 }));
  // Null shows "No color" selected. The area keeps the last color, so a drag starts from it.
  const [cleared, setCleared] = createSignal(start === null);
  const hex = createMemo(() => formatHex(hsvToRgb(hsv())));
  const [format, setFormat] = createSignal<Format>("hex");
  const channelFormat = (): ChannelFormat => (format() === "hsl" ? "hsl" : "rgb");

  const update = (next: Hsv) => {
    const clean = { h: clamp(next.h, 0, 360), s: clamp(next.s, 0, 100), v: clamp(next.v, 0, 100) };
    setHsv(clean);
    setCleared(false);
    props.onChange(formatHex(hsvToRgb(clean)));
  };
  const clear = () => {
    setCleared(true);
    props.onChange(null);
  };

  let panel: HTMLFieldSetElement | undefined;

  onSettled(() => {
    panel?.querySelector<HTMLElement>('[role="slider"]')?.focus({ preventScroll: true });
  });

  return (
    <fieldset
      ref={(element) => (panel = element)}
      class="chat-color-picker"
      style={SPRING_STYLE}
      aria-label={props.label}
    >
      <Area hsv={hsv()} hex={hex()} update={update} />
      <div class="chat-color-picker-row">
        <EyeDropper hsv={hsv()} update={update} />
        <Hue hsv={hsv()} update={update} />
      </div>
      <div class="chat-color-picker-row chat-color-picker-fields">
        <FormatButton format={format()} onCycle={setFormat} />
        <Show when={format() === "hex"} fallback={<Channels format={channelFormat()} hsv={hsv()} update={update} />}>
          <HexField hsv={hsv()} hex={hex()} cleared={cleared()} update={update} />
          <span
            class={["chat-color-picker-swatch", { "chat-color-none": cleared() }]}
            style={`--chat-color-value: ${hex()}`}
            aria-hidden="true"
          />
        </Show>
      </div>
      <Presets
        presets={props.presets}
        hex={hex()}
        cleared={cleared()}
        clearLabel={props.clearLabel ?? t("settings.chatColor.noColor")}
        hsv={hsv()}
        update={update}
        clear={clear}
      />
      <span class="sr-only" aria-live="polite">
        {cleared() ? (props.clearLabel ?? t("settings.chatColor.none")) : ""}
      </span>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Pointer drag shared by the area and the hue slider
// ---------------------------------------------------------------------------

function createDrag(onPoint: (x: number, y: number) => void) {
  const [dragging, setDragging] = createSignal(false);
  const [tilt, setTilt] = createSignal(0);
  let rail: HTMLElement | undefined;
  let thumb: HTMLElement | undefined;
  let last: { x: number; time: number } | undefined;
  let settle = 0;

  const point = (event: PointerEvent) => {
    const rect = rail?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    onPoint(x, clamp((event.clientY - rect.top) / rect.height, 0, 1));
    // The loupe swings against the drag, as a pendulum: ±400 %/s gives ∓16°.
    if (last && event.timeStamp > last.time) {
      const velocity = ((x - last.x) * 100) / ((event.timeStamp - last.time) / 1000);
      setTilt(clamp((-velocity / 400) * 16, -16, 16));
    }
    last = { x, time: event.timeStamp };
    cancelAnimationFrame(settle);
    settle = requestAnimationFrame(() => {
      settle = requestAnimationFrame(() => setTilt(0));
    });
  };
  const end = (event: PointerEvent & { currentTarget: HTMLElement }) => {
    if (!dragging()) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
    last = undefined;
    setTilt(0);
  };

  return {
    dragging,
    tilt,
    rail: (element: HTMLElement) => (rail = element),
    thumb: (element: HTMLElement) => (thumb = element),
    handlers: {
      onPointerDown: (event: PointerEvent & { currentTarget: HTMLElement }) => {
        if (event.button !== 0) return;
        event.preventDefault();
        setDragging(true);
        event.currentTarget.setPointerCapture(event.pointerId);
        thumb?.focus({ preventScroll: true });
        point(event);
      },
      onPointerMove: (event: PointerEvent) => {
        if (dragging()) point(event);
      },
      onPointerUp: end,
      onPointerCancel: end,
    },
  };
}

function keyStep(event: KeyboardEvent): { axis: "x" | "y"; delta: number } | "min" | "max" | null {
  const step = event.shiftKey ? 10 : 1;
  switch (event.key) {
    case "ArrowRight":
      return { axis: "x", delta: step };
    case "ArrowLeft":
      return { axis: "x", delta: -step };
    case "ArrowUp":
      return { axis: "y", delta: step };
    case "ArrowDown":
      return { axis: "y", delta: -step };
    case "PageUp":
      return { axis: "y", delta: 10 };
    case "PageDown":
      return { axis: "y", delta: -10 };
    case "Home":
      return "min";
    case "End":
      return "max";
    default:
      return null;
  }
}

function Loupe(props: { color: string; tilt: number }) {
  return (
    <span class="chat-color-picker-loupe" style={`--chat-color-tilt: ${props.tilt}deg`} aria-hidden="true">
      <span class="chat-color-picker-loupe-drop" style={`--chat-color-value: ${props.color}`} />
    </span>
  );
}

function Area(props: { hsv: Hsv; hex: string; update: (next: Hsv) => void }) {
  const { t } = useText();
  const drag = createDrag((x, y) => props.update({ ...props.hsv, s: x * 100, v: (1 - y) * 100 }));
  const s = () => Math.round(props.hsv.s);
  const v = () => Math.round(props.hsv.v);
  return (
    <div
      ref={drag.rail}
      class={["chat-color-picker-area", { "chat-color-picker-dragging": drag.dragging() }]}
      style={`--chat-color-pure: ${formatHex(hsvToRgb({ h: props.hsv.h, s: 100, v: 100 }))}; --chat-color-x: ${props.hsv.s}; --chat-color-y: ${100 - props.hsv.v}; --chat-color-value: ${props.hex}`}
      {...drag.handlers}
    >
      <span class="chat-color-picker-ring" aria-hidden="true" />
      <span class="chat-color-picker-track">
        <button
          type="button"
          ref={drag.thumb}
          class="chat-color-picker-thumb"
          role="slider"
          aria-label={t("settings.chatColor.area")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={s()}
          aria-valuetext={t("settings.chatColor.areaValue", { saturation: s(), brightness: v() })}
          onKeyDown={(event) => {
            const step = keyStep(event);
            if (!step) return;
            event.preventDefault();
            event.stopPropagation();
            if (step === "min") props.update({ ...props.hsv, s: 0 });
            else if (step === "max") props.update({ ...props.hsv, s: 100 });
            else if (step.axis === "x") props.update({ ...props.hsv, s: props.hsv.s + step.delta });
            else props.update({ ...props.hsv, v: props.hsv.v + step.delta });
          }}
        >
          <span class="chat-color-picker-thumb-dot" />
          <Show when={drag.dragging() && !reducedMotion()}>
            <Loupe color={props.hex} tilt={drag.tilt()} />
          </Show>
        </button>
      </span>
    </div>
  );
}

function Hue(props: { hsv: Hsv; update: (next: Hsv) => void }) {
  const { t } = useText();
  const drag = createDrag((x) => props.update({ ...props.hsv, h: x * 360 }));
  const h = () => Math.round(props.hsv.h);
  return (
    <div class={["chat-color-picker-hue", { "chat-color-picker-dragging": drag.dragging() }]} {...drag.handlers}>
      <span class="chat-color-picker-ring" aria-hidden="true" />
      {/* The rail is inset by half a thumb, so the thumb never leaves the rounded track. */}
      <span ref={drag.rail} class="chat-color-picker-hue-rail" style={`--chat-color-x: ${(props.hsv.h / 360) * 100}`}>
        <span class="chat-color-picker-track">
          <button
            type="button"
            ref={drag.thumb}
            class="chat-color-picker-thumb"
            role="slider"
            aria-label={t("settings.chatColor.hue")}
            aria-orientation="horizontal"
            aria-valuemin={0}
            aria-valuemax={360}
            aria-valuenow={h()}
            aria-valuetext={t("settings.chatColor.hueValue", { degrees: h() })}
            style={`--chat-color-value: hsl(${props.hsv.h} 100% 50%)`}
            onKeyDown={(event) => {
              const step = keyStep(event);
              if (!step) return;
              event.preventDefault();
              event.stopPropagation();
              if (step === "min") props.update({ ...props.hsv, h: 0 });
              else if (step === "max") props.update({ ...props.hsv, h: 360 });
              else props.update({ ...props.hsv, h: h() + step.delta });
            }}
          >
            <span class="chat-color-picker-thumb-dot" />
            <Show when={drag.dragging() && !reducedMotion()}>
              <Loupe color={`hsl(${props.hsv.h} 100% 50%)`} tilt={drag.tilt()} />
            </Show>
          </button>
        </span>
      </span>
    </div>
  );
}

declare global {
  interface Window {
    /** Chromium has the EyeDropper API; the TypeScript DOM library does not have it yet. */
    EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> };
  }
}

/** The EyeDropper API, or undefined in a browser that does not have it, such as Safari. */
function eyeDropperApi() {
  return typeof window === "undefined" ? undefined : window.EyeDropper;
}

function EyeDropper(props: { hsv: Hsv; update: (next: Hsv) => void }) {
  const { t } = useText();
  return (
    <Show when={eyeDropperApi()}>
      {(Api) => (
        <button
          type="button"
          class="chat-color-picker-icon-button"
          aria-label={t("settings.chatColor.eyeDropper")}
          onClick={async () => {
            try {
              const Constructor = Api();
              const { sRGBHex } = await new Constructor().open();
              const parsed = parseHex(sRGBHex);
              if (parsed) props.update(rgbToHsv(parsed, props.hsv));
            } catch {
              // Dismissed with Escape.
            }
          }}
        >
          <Pipette aria-hidden="true" />
        </button>
      )}
    </Show>
  );
}

function HexField(props: { hsv: Hsv; hex: string; cleared: boolean; update: (next: Hsv) => void }) {
  const { t } = useText();
  const [draft, setDraft] = createSignal<string | null>(null);
  let field: HTMLDivElement | undefined;
  const shake = () => {
    if (!field || reducedMotion()) return;
    field.animate(
      [0, -5, 5, -3, 3, 0].map((x) => ({ transform: `translateX(${x}px)` })),
      { duration: 300, easing: "ease-out" },
    );
  };
  const settle = (text: string | null) => {
    if (text === null) return;
    const parsed = parseHex(text);
    if (parsed) props.update(rgbToHsv(parsed, props.hsv));
    else shake();
    setDraft(null);
  };
  const shown = () => draft() ?? (props.cleared ? "" : props.hex.slice(1).toUpperCase());
  return (
    <div ref={(element) => (field = element)} class="chat-color-picker-hex">
      <span class="chat-color-picker-hex-hash" aria-hidden="true">
        {HASH}
      </span>
      <input
        type="text"
        class="chat-color-picker-field chat-color-picker-hex-input"
        autocomplete="off"
        spellcheck={false}
        maxlength={7}
        aria-label={t("settings.chatColor.hex")}
        placeholder={t("settings.chatColor.none")}
        value={shown()}
        onInput={(event) => {
          const next = event.currentTarget.value.replace(/^#/, "");
          setDraft(next);
          // Live only at six digits, so "abc" on the way to "abcdef" does not flash a short color.
          if (next.length === 6) {
            const parsed = parseHex(next);
            if (parsed) props.update(rgbToHsv(parsed, props.hsv));
          }
        }}
        onBlur={(event) => settle(draft() === null ? null : event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") settle(event.currentTarget.value);
          if (event.key === "Escape" && draft() !== null) {
            event.preventDefault();
            event.stopPropagation();
            setDraft(null);
          }
        }}
      />
    </div>
  );
}

const HASH = "#";

// ---------------------------------------------------------------------------
// Format switch and channels (as in the beUI preview)
// ---------------------------------------------------------------------------

const FORMATS = ["hex", "rgb", "hsl"] as const;
type Format = (typeof FORMATS)[number];
type ChannelFormat = Exclude<Format, "hex">;

function FormatButton(props: { format: Format; onCycle: (next: Format) => void }) {
  const { t } = useText();
  const next = () => FORMATS[(FORMATS.indexOf(props.format) + 1) % FORMATS.length] ?? "hex";
  return (
    <button
      type="button"
      class="chat-color-picker-format"
      aria-label={t("settings.chatColor.format", {
        format: props.format.toUpperCase(),
        next: next().toUpperCase(),
      })}
      onClick={() => props.onCycle(next())}
    >
      {/* The new label rises in from below, as the beUI swap does. */}
      <Show when={props.format} keyed>
        {(format) => <span class="chat-color-picker-format-label">{format.toUpperCase()}</span>}
      </Show>
    </button>
  );
}

interface ChannelSpec {
  key: "h" | "s" | "l" | "r" | "g" | "b";
  name: AppTextKey;
  max: number;
  value: number;
  set: (n: number) => Hsv;
}

function channelSpecs(format: ChannelFormat, hsv: Hsv): ChannelSpec[] {
  if (format === "hsl") {
    const hsl = hsvToHsl(hsv);
    return [
      { key: "h", name: "settings.chatColor.hue", max: 360, value: hsl.h, set: (n) => hslToHsv(n, hsl.s, hsl.l, hsv) },
      {
        key: "s",
        name: "settings.chatColor.saturation",
        max: 100,
        value: hsl.s,
        set: (n) => hslToHsv(hsl.h, n, hsl.l, hsv),
      },
      {
        key: "l",
        name: "settings.chatColor.lightness",
        max: 100,
        value: hsl.l,
        set: (n) => hslToHsv(hsl.h, hsl.s, n, hsv),
      },
    ];
  }
  const rgb = hsvToRgb(hsv);
  return [
    { key: "r", name: "settings.chatColor.red", max: 255, value: rgb.r, set: (n) => rgbToHsv({ ...rgb, r: n }, hsv) },
    { key: "g", name: "settings.chatColor.green", max: 255, value: rgb.g, set: (n) => rgbToHsv({ ...rgb, g: n }, hsv) },
    { key: "b", name: "settings.chatColor.blue", max: 255, value: rgb.b, set: (n) => rgbToHsv({ ...rgb, b: n }, hsv) },
  ];
}

function Channels(props: { format: ChannelFormat; hsv: Hsv; update: (next: Hsv) => void }) {
  const specs = createMemo(() => channelSpecs(props.format, props.hsv));
  return (
    <div class="chat-color-picker-channels">
      <For each={specs()} keyed={(spec) => `${props.format}-${spec.key}`}>
        {(spec) => <ChannelField spec={spec()} update={props.update} />}
      </For>
    </div>
  );
}

function ChannelField(props: { spec: ChannelSpec; update: (next: Hsv) => void }) {
  const { t } = useText();
  const [draft, setDraft] = createSignal<string | null>(null);
  const shown = () => Math.round(props.spec.value);
  return (
    <label class="chat-color-picker-channel">
      <input
        type="text"
        inputmode="numeric"
        class="chat-color-picker-field chat-color-picker-channel-input"
        autocomplete="off"
        aria-label={t(props.spec.name)}
        value={draft() ?? String(shown())}
        onInput={(event) => {
          const next = event.currentTarget.value.replace(/[^\d]/g, "").slice(0, 3);
          event.currentTarget.value = next;
          setDraft(next);
          if (next !== "") props.update(props.spec.set(clamp(Number(next), 0, props.spec.max)));
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 10 : 1;
          const delta = event.key === "ArrowUp" ? step : event.key === "ArrowDown" ? -step : 0;
          if (delta) {
            event.preventDefault();
            setDraft(null);
            props.update(props.spec.set(clamp(shown() + delta, 0, props.spec.max)));
          } else if (event.key === "Enter") setDraft(null);
        }}
      />
      <span class="chat-color-picker-channel-label" aria-hidden="true">
        {props.spec.key.toUpperCase()}
      </span>
    </label>
  );
}

function Presets(props: {
  presets: readonly ColorPreset[];
  hex: string;
  cleared: boolean;
  clearLabel: string;
  hsv: Hsv;
  update: (next: Hsv) => void;
  clear: () => void;
}) {
  const { t } = useText();
  let row: HTMLFieldSetElement | undefined;
  let ring: HTMLSpanElement | undefined;
  let previous: { x: number; y: number } | undefined;
  const selected = () =>
    props.cleared ? "none" : (props.presets.find((preset) => preset.value === props.hex)?.value ?? null);

  /** Moves the ring to the selected swatch. It hops over a low arc above the row, as in beUI. */
  const place = (key: string | null) => {
    if (!row || !ring) return;
    const target = key ? row.querySelector<HTMLElement>(`[data-preset="${key}"]`) : null;
    if (!target) {
      ring.dataset.visible = "false";
      previous = undefined;
      return;
    }
    const next = { x: target.offsetLeft, y: target.offsetTop };
    ring.style.transform = `translate(${next.x}px, ${next.y}px)`;
    const wasVisible = ring.dataset.visible === "true";
    ring.dataset.visible = "true";
    if (previous && wasVisible && !reducedMotion() && (previous.x !== next.x || previous.y !== next.y)) {
      const from = previous;
      const distance = Math.hypot(next.x - from.x, next.y - from.y);
      const apex = 0.15 * distance;
      ring.animate(
        springKeyframes(SPRING_LAYOUT, (p) => ({
          transform: `translate(${from.x + (next.x - from.x) * p}px, ${from.y + (next.y - from.y) * p - apex * Math.sin(Math.PI * clamp(p, 0, 1))}px)`,
        })),
        { duration: SPRING_LAYOUT.response * 1000, easing: "linear" },
      );
    }
    previous = next;
  };

  // A drag or a typed hex that leaves the presets hides the ring; a preset moves it.
  createEffect(selected, place);

  return (
    <fieldset
      ref={(element) => (row = element)}
      class="chat-color-picker-presets"
      aria-label={t("settings.chatColor.presets")}
    >
      <span
        ref={(element) => (ring = element)}
        class="chat-color-picker-preset-ring"
        data-visible="false"
        aria-hidden="true"
      />
      <button
        type="button"
        class="chat-color-picker-preset chat-color-none"
        data-preset="none"
        aria-label={props.clearLabel}
        aria-pressed={selected() === "none" ? "true" : "false"}
        onClick={props.clear}
      />
      <For each={props.presets}>
        {(preset) => (
          <button
            type="button"
            class="chat-color-picker-preset"
            data-preset={preset.value}
            style={`--chat-color-value: ${preset.value}`}
            aria-label={preset.label}
            aria-pressed={selected() === preset.value ? "true" : "false"}
            onClick={() => {
              const parsed = parseHex(preset.value);
              if (parsed) props.update(rgbToHsv(parsed, props.hsv));
            }}
          />
        )}
      </For>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// The popover and the select-like trigger
// ---------------------------------------------------------------------------

/** A duration token in milliseconds, for example `--openbot-duration-dialog: 180ms`. */
function durationToken(element: Element, name: string): number {
  return Number.parseFloat(getComputedStyle(element).getPropertyValue(name)) || 0;
}

/** Plays the open backwards, to the dot. A cancelled animation rejects; the popover closes all the same. */
async function playClose(panel: HTMLElement, shift: number): Promise<void> {
  if (reducedMotion()) return;
  const animation = panel.animate(
    { opacity: [1, 0], transform: ["none", `translateY(${shift}px) scale(0.96)`] },
    { duration: durationToken(panel, "--openbot-duration-dialog"), easing: "ease-in", fill: "forwards" },
  );
  await animation.finished.catch(() => undefined);
}

/** The trigger that a popover opens from, and the dot that its open grows out of. */
export interface ColorPickerAnchor {
  trigger: HTMLElement;
  dot: HTMLElement | undefined;
}

export interface ColorPickerPopoverProps {
  anchor: ColorPickerAnchor;
  /** Names the popover. */
  label: string;
  /** Called when the close animation ends. */
  onClose: () => void;
  /** Receives the function that plays the close and then calls `onClose`. */
  controls: (close: () => void) => void;
  children: JSX.Element;
}

/**
 * A popover beside its trigger: below it when it fits, above it when not. Escape, and a press outside
 * the popover and the trigger, close it.
 */
export function ColorPickerPopover(props: ColorPickerPopoverProps) {
  let panel: HTMLDivElement | undefined;
  let closing = false;
  /** The 6px that the popover travels: down into place under the row, up into place over it. */
  let shift = -6;
  const close = () => {
    if (closing || !panel) return;
    closing = true;
    panel.inert = true;
    void playClose(panel, shift).then(props.onClose);
  };
  props.controls(close);

  /** Puts the popover 6px from the row, its end edge on the row's end edge, and below the row when it fits. */
  const place = () => {
    if (!panel || closing) return;
    const gutter = 8;
    const gap = 6;
    const row = props.anchor.trigger.getBoundingClientRect();
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const below = row.bottom + gap + height <= innerHeight - gutter;
    const rtl = getComputedStyle(props.anchor.trigger).direction === "rtl";
    const end = rtl ? row.left : row.right - width;
    const left = Math.max(gutter, Math.min(end, innerWidth - width - gutter));
    const top = Math.max(gutter, below ? row.bottom + gap : row.top - gap - height);
    const dot = props.anchor.dot?.getBoundingClientRect();
    const originX = dot ? dot.left + dot.width / 2 - left : width;
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.transformOrigin = `${originX}px ${below ? "0" : "100%"}`;
    shift = below ? -gap : gap;
    panel.style.setProperty("--chat-color-shift", `${shift}px`);
  };

  onSettled(() => {
    if (!panel) return;
    // Synchronous, so the first frame of the open is already in place.
    place();
    const resize = new ResizeObserver(place);
    resize.observe(panel);
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || panel?.contains(event.target)) return;
      if (props.anchor.trigger.contains(event.target)) return;
      close();
    };
    // Captured and stopped, so Escape closes only the popover and not the settings dialog under it.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || closing) return;
      event.stopPropagation();
      close();
      props.anchor.trigger.focus();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      resize.disconnect();
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  });

  // In a dialog, the popover mounts in it, as the select menus of the settings do. A click on the
  // popover is then a click in the dialog, and the dialog stays open.
  const mount = () => props.anchor.trigger.closest<HTMLElement>('[role="dialog"]') ?? document.body;

  return (
    <Portal mount={mount()}>
      <div ref={(element) => (panel = element)} class="chat-color-popover" role="dialog" aria-label={props.label}>
        {props.children}
      </div>
    </Portal>
  );
}

export interface ColorPickerTriggerProps {
  /** The accessible name of the trigger. */
  label: string;
  expanded: boolean;
  onClick: (trigger: HTMLElement) => void;
  /** The dot and the color name. */
  children: JSX.Element;
}

/** A trigger for a color popover that looks like the select triggers beside it. */
export function ColorPickerTrigger(props: ColorPickerTriggerProps) {
  return (
    <button
      type="button"
      class="ui-select-trigger chat-color-own-trigger"
      data-size="sm"
      aria-label={props.label}
      aria-haspopup="dialog"
      aria-expanded={props.expanded ? "true" : "false"}
      onClick={(event) => props.onClick(event.currentTarget)}
    >
      {props.children}
      <span class="ui-select-trigger-icon">
        <ChevronsUpDown aria-hidden="true" />
      </span>
    </button>
  );
}
