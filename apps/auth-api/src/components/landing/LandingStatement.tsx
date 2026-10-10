import { ProviderLogo } from "@openbot/brand";
import { Button } from "@openbot/ui/button";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, For, Match, onCleanup, onSettled, Show, Switch } from "solid-js";
import "./landing-statement.css";

type StickerKind = "team" | "models" | "computer" | "build" | "design" | "desktop";

type StatementChoice = { text: string } & (
  | { sticker: StickerKind; provider?: never }
  | { sticker?: never; provider: "codex" | "claude" | "antigravity" | "grok" }
);

function StatementSticker(props: { kind: StickerKind }) {
  return (
    <svg
      class={`landing-statement-sticker landing-statement-sticker-${props.kind}`}
      viewBox="0 0 96 96"
      aria-hidden="true"
    >
      <Switch>
        <Match when={props.kind === "team"}>
          <path
            d="M25 11a17 17 0 0 1 17 17v7h12v-7a17 17 0 0 1 34 0v10c0 7-3 12-8 15 7 5 11 13 11 23v5a7 7 0 0 1-7 7H12a7 7 0 0 1-7-7v-5c0-10 4-18 11-23-5-3-8-8-8-15V28a17 17 0 0 1 17-17Z"
            fill="#fff"
            stroke="#fff"
            stroke-width="5"
            stroke-linejoin="round"
          />
          <rect x="12" y="15" width="27" height="38" rx="14" fill="#a58aff" />
          <path d="M9 79c0-15 7-24 17-24s17 9 17 24v5H9Z" fill="#8958f5" />
          <rect x="57" y="15" width="27" height="38" rx="14" fill="#65d8f0" />
          <path d="M53 79c0-15 7-24 17-24s17 9 17 24v5H53Z" fill="#16b9dc" />
          <path d="M25 33v4m45-4v4" stroke="#35294e" stroke-width="4" stroke-linecap="round" />
          <path d="M26 82c0-15 8-24 22-24s22 9 22 24" fill="#ffc94c" stroke="#fff" stroke-width="5" />
          <circle cx="48" cy="49" r="17" fill="#ffda6a" stroke="#fff" stroke-width="5" />
          <path d="M42 48v3m12-3v3" stroke="#8a550d" stroke-width="3.5" stroke-linecap="round" />
        </Match>
        <Match when={props.kind === "models"}>
          <rect x="6" y="9" width="57" height="38" rx="12" fill="#9061ff" stroke="#fff" stroke-width="6" />
          <path d="M23 28h23" stroke="#fff" stroke-width="5" stroke-linecap="round" />
          <rect x="8" y="51" width="35" height="35" rx="12" fill="#15bfe9" stroke="#fff" stroke-width="6" />
          <circle cx="25.5" cy="68.5" r="6" fill="#d4f7ff" />
          <rect x="48" y="36" width="40" height="50" rx="12" fill="#ffcb41" stroke="#fff" stroke-width="6" />
          <path
            d="m60 61 7 7 11-15"
            fill="none"
            stroke="#a76a0a"
            stroke-width="5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </Match>
        <Match when={props.kind === "computer"}>
          <path
            d="M19 14h58a8 8 0 0 1 8 8v43l7 11a5 5 0 0 1-4 8H8a5 5 0 0 1-4-8l7-11V22a8 8 0 0 1 8-8Z"
            fill="#a58aff"
            stroke="#fff"
            stroke-width="6"
            stroke-linejoin="round"
          />
          <rect x="20" y="23" width="56" height="36" rx="4" fill="#433080" />
          <path
            d="m30 35 7 6-7 6m17 0h12"
            fill="none"
            stroke="#c5f18b"
            stroke-width="4"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <path d="M14 69h68M38 76h20" stroke="#6444b2" stroke-width="4" stroke-linecap="round" />
          <circle cx="77" cy="25" r="13" fill="#ffc94c" stroke="#fff" stroke-width="5" />
          <path
            d="m71 25 4 4 7-8"
            fill="none"
            stroke="#9b640b"
            stroke-width="3.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </Match>
        <Match when={props.kind === "build"}>
          <rect x="9" y="14" width="78" height="68" rx="13" fill="#7d5df5" stroke="#fff" stroke-width="6" />
          <path d="M12 32h72" stroke="#fff" stroke-width="5" />
          <circle cx="24" cy="24" r="3" fill="#ffcf48" />
          <circle cx="35" cy="24" r="3" fill="#67dbef" />
          <path
            d="m32 46-10 11 10 11m32-22 10 11-10 11M53 43 43 71"
            fill="none"
            stroke="#dcff96"
            stroke-width="5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </Match>
        <Match when={props.kind === "design"}>
          <rect
            x="20"
            y="9"
            width="30"
            height="73"
            rx="9"
            fill="#ffca43"
            stroke="#fff"
            stroke-width="6"
            transform="rotate(-16 35 70)"
          />
          <rect
            x="26"
            y="14"
            width="30"
            height="70"
            rx="9"
            fill="#ff5f99"
            stroke="#fff"
            stroke-width="6"
            transform="rotate(14 41 70)"
          />
          <rect
            x="32"
            y="20"
            width="30"
            height="67"
            rx="9"
            fill="#9061ff"
            stroke="#fff"
            stroke-width="6"
            transform="rotate(48 47 72)"
          />
          <circle cx="42" cy="72" r="5" fill="#fff" />
        </Match>
        <Match when={props.kind === "desktop"}>
          <path d="M40 64h16v16h13v7H27v-7h13Z" fill="#a58aff" stroke="#fff" stroke-width="6" stroke-linejoin="round" />
          <rect x="7" y="10" width="82" height="57" rx="9" fill="#5dcbdf" stroke="#fff" stroke-width="6" />
          <rect x="15" y="18" width="66" height="35" rx="3" fill="#214d64" />
          <path
            d="m27 31 7 6-7 6m16 0h14"
            fill="none"
            stroke="#cff3a2"
            stroke-width="4"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <circle cx="48" cy="60" r="3" fill="#fff" />
        </Match>
      </Switch>
    </svg>
  );
}

function StatementLabel(props: {
  choices: readonly [StatementChoice, ...StatementChoice[]];
  register: (advance: () => void) => () => void;
}) {
  const { t } = useText();
  const [selected, setSelected] = createSignal(0);
  const [width, setWidth] = createSignal<number>();
  let choicesElement: HTMLSpanElement | undefined;
  let resizeObserver: ResizeObserver | undefined;

  onSettled(() => {
    if (!choicesElement) return;
    const measure = () => {
      const active = choicesElement?.querySelector<HTMLElement>('[data-active="true"]');
      if (active) setWidth(active.offsetWidth);
    };
    measure();
    resizeObserver = new ResizeObserver(measure);
    for (const choice of choicesElement.children) resizeObserver.observe(choice);
  });
  onCleanup(() => resizeObserver?.disconnect());

  function advance(): void {
    const index = (selected() + 1) % props.choices.length;
    const choice = choicesElement?.children.item(index);
    if (choice instanceof HTMLElement) setWidth(choice.offsetWidth);
    setSelected(index);
  }

  onSettled(() => props.register(advance));

  const current = () => props.choices[selected()] ?? props.choices[0];
  const next = () => props.choices[(selected() + 1) % props.choices.length] ?? props.choices[0];

  return (
    <Button
      variant="ghost"
      class="landing-statement-label"
      aria-label={t("landing.statement.next", { current: current().text, next: next().text })}
      onClick={advance}
    >
      <span
        ref={choicesElement}
        class="landing-statement-choices"
        style={{ width: width() === undefined ? undefined : `${width()}px` }}
        aria-hidden="true"
      >
        <For each={props.choices}>
          {(choice, index) => (
            <span class="landing-statement-choice" data-active={selected() === index() ? "true" : "false"}>
              <span class="landing-statement-motion">
                <Show when={choice.provider} fallback={<StatementSticker kind={choice.sticker ?? "models"} />}>
                  {(provider) => (
                    <span class="landing-statement-provider">
                      <ProviderLogo provider={provider()} />
                    </span>
                  )}
                </Show>
              </span>
              <span class="landing-statement-word">{choice.text}</span>
            </span>
          )}
        </For>
      </span>
    </Button>
  );
}

export function LandingStatement() {
  const { t } = useText();
  let section: HTMLElement | undefined;
  const advances = new Map<string, () => void>();
  const [visible, setVisible] = createSignal(false);
  const [revealed, setRevealed] = createSignal(false);
  const [paused, setPaused] = createSignal(false);
  const [hovered, setHovered] = createSignal(false);
  const [focused, setFocused] = createSignal(false);
  const [reducedMotion, setReducedMotion] = createSignal(true);
  const [pageVisible, setPageVisible] = createSignal(true);
  let nextLabel = 0;

  function register(kind: string, advance: () => void): () => void {
    advances.set(kind, advance);
    return () => {
      advances.delete(kind);
    };
  }

  onSettled(() => {
    if (!section) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => setReducedMotion(media.matches);
    const syncVisibility = () => setPageVisible(!document.hidden);
    syncMotion();
    syncVisibility();
    media.addEventListener("change", syncMotion);
    document.addEventListener("visibilitychange", syncVisibility);
    const observer = new IntersectionObserver(
      (entries) => {
        const inView = entries.some((entry) => entry.isIntersecting);
        setVisible(inView);
        if (inView) setRevealed(true);
      },
      { threshold: 0.4 },
    );
    observer.observe(section);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", syncMotion);
      document.removeEventListener("visibilitychange", syncVisibility);
    };
  });

  createEffect(
    () => visible() && pageVisible() && !paused() && !hovered() && !focused() && !reducedMotion(),
    (playing) => {
      if (!playing) return;
      const timer = window.setInterval(() => {
        const kind = ["team", "models", "computer"][nextLabel];
        if (kind) advances.get(kind)?.();
        nextLabel = (nextLabel + 1) % 3;
      }, 3000);
      return () => window.clearInterval(timer);
    },
  );

  const parts = () =>
    t("landing.statement.text", { team: "{team}", models: "{models}", computer: "{computer}" }).split(
      /(\{(?:team|models|computer)\}[,.]?)/,
    );

  return (
    <section
      ref={section}
      class="landing-statement"
      aria-labelledby="landing-statement-title"
      data-revealed={revealed() ? "true" : "false"}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") setHovered(true);
      }}
      onPointerLeave={() => setHovered(false)}
      onFocusIn={() => setFocused(true)}
      onFocusOut={(event) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget))
          setFocused(false);
      }}
    >
      <h2 id="landing-statement-title" class="landing-statement-text">
        <For each={parts()}>
          {(part) => (
            <Switch fallback={part}>
              <Match when={part.startsWith("{team}")}>
                <span class="landing-statement-term">
                  <StatementLabel
                    register={(advance) => register("team", advance)}
                    choices={[
                      { text: t("landing.statement.team"), sticker: "team" },
                      { text: t("landing.statement.buildTeam"), sticker: "build" },
                      { text: t("landing.statement.designTeam"), sticker: "design" },
                    ]}
                  />
                  {part.slice(part.indexOf("}") + 1)}
                </span>
              </Match>
              <Match when={part.startsWith("{models}")}>
                <span class="landing-statement-term">
                  <StatementLabel
                    register={(advance) => register("models", advance)}
                    choices={[
                      { text: t("landing.statement.models"), sticker: "models" },
                      { text: t("landing.statement.codex"), provider: "codex" },
                      { text: t("landing.statement.claude"), provider: "claude" },
                      { text: t("landing.statement.gemini"), provider: "antigravity" },
                      { text: t("landing.statement.grok"), provider: "grok" },
                    ]}
                  />
                  {part.slice(part.indexOf("}") + 1)}
                </span>
              </Match>
              <Match when={part.startsWith("{computer}")}>
                <span class="landing-statement-term">
                  <StatementLabel
                    register={(advance) => register("computer", advance)}
                    choices={[
                      { text: t("landing.statement.computer"), sticker: "computer" },
                      { text: t("landing.statement.desktop"), sticker: "desktop" },
                      { text: t("landing.statement.laptop"), sticker: "computer" },
                    ]}
                  />
                  {part.slice(part.indexOf("}") + 1)}
                </span>
              </Match>
            </Switch>
          )}
        </For>
      </h2>
      <Show when={!reducedMotion()}>
        <Button
          variant="ghost"
          size="sm"
          class="landing-statement-playback"
          onClick={() => setPaused((value) => !value)}
        >
          {paused() ? t("landing.statement.resume") : t("landing.statement.pause")}
        </Button>
      </Show>
    </section>
  );
}
