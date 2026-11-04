/**
 * Plush motion scenes: felt-plush animations for the splash, empty states, offline, crash and typing.
 * Each scene goes into the real component that shows the state now: the scene finds that
 * component's empty-state element and renders into it, so everything around it is the shipped UI.
 */

import { PlushBot, type PlushCharacterId, type PlushState } from "@norbert_bodziony/bloub/plush";
import { Button, Heading, PlushMascot, type PlushMascotFace, Text, X } from "@openbot/ui";
import { GlobalSearch } from "@openbot/ui/components/GlobalSearch";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { ChannelAvatar } from "@openbot/ui/features/channels/ChannelAvatar";
import { FileList } from "@openbot/ui/features/files/FileList";
import { ServerConnectionNotice } from "@openbot/ui/features/servers/ServerConnectionNotice";
import { Sidebar } from "@openbot/ui/features/sidebar/Sidebar";
import { SidebarAgentIndicator } from "@openbot/ui/features/sidebar/SidebarAgentIndicator";
import type { SidebarAgentState } from "@openbot/ui/features/sidebar/sidebar-types";
import { useText } from "@openbot/ui/text";
import { prefersReducedMotion } from "@openbot/ui/utils";
import { type JSX, Portal } from "@solidjs/web";
import { type Accessor, createEffect, createSignal, For, onSettled, Show } from "solid-js";
import { defaultSidebarLayout } from "../src/features/sidebar/sidebar-sections";
import { STORY_QUEUES, STORY_SNAPSHOTS } from "../src/preview/fixtures";
import type { MockChannelSeed } from "../src/preview/mock-channels";
import type { MockOpenBotOptions } from "../src/preview/mock-openbot";
import ballLilac from "./assets/motion-scenes/ball-lilac.webp";
import ballMint from "./assets/motion-scenes/ball-mint.webp";
import ballPink from "./assets/motion-scenes/ball-pink.webp";
import splashBody from "./assets/motion-scenes/splash-body.webp";
import splashEyeLeft from "./assets/motion-scenes/splash-eye-left.webp";
import splashEyeRight from "./assets/motion-scenes/splash-eye-right.webp";
import splashIntro from "./assets/motion-scenes/splash-intro.webm";
import splashPoster from "./assets/motion-scenes/splash-intro-poster.webp";
import { STORY_AGENTS } from "./fixtures";
import { MarketplaceStory } from "./marketplace-story-support";
import { PrototypeApp } from "./prototype-support";
import "./MotionScenesPrototype.css";

export const BALLS = [ballLilac, ballMint, ballPink] as const;

// Shared helpers -----------------------------------------------------------

/** The first element that matches `selector` under `root`, as the real component draws and removes it. */
export function useElement(selector: string, root: Accessor<Element | null | undefined> = () => document.body) {
  const [element, setElement] = createSignal<Element | null>(null);
  onSettled(() => {
    const scope = root();
    if (!scope) return;
    let frame = 0;
    const sync = () => setElement(() => scope.querySelector(selector));
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    });
    observer.observe(scope, { subtree: true, childList: true });
    sync();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  });
  return element;
}

/** Renders `children` at the start of the element that `selector` finds, while it is there. */
export function MountInto(props: {
  selector: string;
  root?: Accessor<Element | null | undefined>;
  children: JSX.Element;
}) {
  const target = useElement(props.selector, props.root);
  return (
    <Show when={target()} keyed>
      {(element) => <Portal mount={element}>{props.children}</Portal>}
    </Show>
  );
}

/** Plays a Web Animation, or nothing when the user asked for less motion. */
export function play(
  element: Element | undefined,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
): Animation | undefined {
  if (!element || prefersReducedMotion()) return undefined;
  return element.animate(keyframes, { easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "both", ...options });
}

/** A small row of story controls, outside the scene. */
export function SceneControls(props: { children: JSX.Element }) {
  return <div class="ms-controls">{props.children}</div>;
}

/** The lilac plush with a gaze and a pose that a scene sets. */
export function Mascot(props: {
  size: number;
  face?: PlushMascotFace;
  eyes?: "open" | "closed";
  gaze?: { x: number; y: number } | null;
  class?: string;
  ref?: (element: HTMLElement) => void;
}) {
  return (
    <span
      ref={(element) => props.ref?.(element)}
      class={["ms-mascot", props.class]}
      data-eyes={props.eyes ?? "open"}
      data-gaze={props.gaze ? "follow" : undefined}
      style={{
        "--ui-plush-size": `${props.size}px`,
        "--ms-gaze-x": `${(props.gaze?.x ?? 0) * props.size * 0.07}px`,
        "--ms-gaze-y": `${(props.gaze?.y ?? 0) * props.size * 0.05}px`,
      }}
    >
      <PlushMascot face={props.face ?? "idle"} />
    </span>
  );
}

// 1. Startup felting --------------------------------------------------------

type SplashPhase = "intro" | "still" | "happy" | "reveal";

/**
 * The felting clip plays once. When the app is ready during the clip, the rest plays fast. Then the
 * plush squashes with a happy face and the splash opens through a hole the shape of the plush.
 */
function FeltSplash(props: { ready: boolean; onExited: () => void }) {
  const { t } = useText();
  const reduced = prefersReducedMotion();
  const [phase, setPhase] = createSignal<SplashPhase>(reduced ? "still" : "intro");
  let video: HTMLVideoElement | undefined;
  let happyTimer: ReturnType<typeof setTimeout> | undefined;

  function introEnded(): void {
    if (phase() === "intro") setPhase("still");
  }

  createEffect(
    () => [props.ready, phase()] as const,
    ([ready, current]) => {
      if (!ready) return;
      if (current === "intro" && video) video.playbackRate = 2.5;
      if (current !== "still") return;
      setPhase("happy");
      happyTimer = setTimeout(() => setPhase("reveal"), reduced ? 0 : 320);
    },
  );
  // The phase changes when the timer is set, so the effect cannot own the timer.
  onSettled(() => () => clearTimeout(happyTimer));

  return (
    <main
      class="ms-splash"
      data-phase={phase()}
      role="status"
      aria-label={t("app.loading")}
      aria-busy={phase() === "reveal" ? "false" : "true"}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) props.onExited();
      }}
    >
      <div class="ms-splash-stage" aria-hidden="true">
        <Show when={phase() === "intro"}>
          <video
            ref={(element) => {
              video = element;
              element.muted = true;
              element.play().catch(introEnded);
            }}
            class="ms-splash-video"
            src={splashIntro}
            poster={splashPoster}
            playsinline
            preload="auto"
            onEnded={introEnded}
          >
            <track kind="captions" />
          </video>
        </Show>
        <Show when={phase() !== "intro"}>
          <span class="ms-splash-still" data-face={phase() === "happy" || phase() === "reveal" ? "happy" : "idle"}>
            <img class="ms-splash-body" src={splashBody} alt="" draggable={false} />
            <img class="ms-splash-eye" data-side="left" src={splashEyeLeft} alt="" draggable={false} />
            <img class="ms-splash-eye" data-side="right" src={splashEyeRight} alt="" draggable={false} />
          </span>
        </Show>
      </div>
    </main>
  );
}

/** The real app on the preview mock, under the felt splash. "App ready" ends the splash. */
export function StartupFeltingVariant(props: { readyAfterMs?: number }) {
  const [run, setRun] = createSignal(1);
  const [ready, setReady] = createSignal(false);
  const [visible, setVisible] = createSignal(true);
  let timer: ReturnType<typeof setTimeout> | undefined;

  function replay(): void {
    clearTimeout(timer);
    setReady(false);
    setVisible(true);
    setRun((count) => count + 1);
    if (props.readyAfterMs !== undefined) timer = setTimeout(() => setReady(true), props.readyAfterMs);
  }

  onSettled(() => {
    if (props.readyAfterMs !== undefined) timer = setTimeout(() => setReady(true), props.readyAfterMs);
    return () => clearTimeout(timer);
  });

  return (
    <div class="ms-root ms-startup">
      <PrototypeApp />
      <Show when={visible() && run()} keyed>
        <FeltSplash ready={ready()} onExited={() => setVisible(false)} />
      </Show>
      <SceneControls>
        <Button size="sm" variant="outline" disabled={ready()} onClick={() => setReady(true)}>
          App ready
        </Button>
        <Button size="sm" variant="outline" onClick={replay}>
          Replay
        </Button>
      </SceneControls>
    </div>
  );
}

// 2. Search: nothing found --------------------------------------------------

export const NO_PAGE = { results: [], total: 0, nextCursor: null };

/** Where the caret of the focused text field is on the screen, or null. */
function caretPoint(): { x: number; y: number } | null {
  const input = document.activeElement;
  if (!(input instanceof HTMLInputElement)) return null;
  const style = getComputedStyle(input);
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return null;
  context.font = style.font;
  const before = input.value.slice(0, input.selectionStart ?? input.value.length);
  const rect = input.getBoundingClientRect();
  const left = rect.left + Number.parseFloat(style.paddingLeft) - input.scrollLeft;
  return { x: Math.min(rect.right, left + context.measureText(before).width), y: rect.top + rect.height / 2 };
}

/**
 * The plush watches the caret while the user types. When the typing stops, it scans left and right
 * for a result, then tilts its head and shrugs.
 */
function SearchPlush() {
  const [gaze, setGaze] = createSignal<{ x: number; y: number } | null>(null);
  let root: HTMLElement | undefined;
  let idle: ReturnType<typeof setTimeout> | undefined;

  function shrug(): void {
    setGaze(null);
    const eyes = root?.querySelector(".ui-plush-eyes") ?? undefined;
    const look = 4;
    play(
      eyes,
      [
        { translate: "0 0" },
        { translate: `${-look}px 0`, offset: 0.2 },
        { translate: `${look}px 0`, offset: 0.5 },
        { translate: `${-look}px 0`, offset: 0.75 },
        { translate: "0 0" },
      ],
      { duration: 760, easing: "ease-in-out", fill: "none" },
    );
    play(
      root,
      [
        { rotate: "0deg", translate: "0 0" },
        { rotate: "-10deg", translate: "0 -4px", offset: 0.35 },
        { rotate: "-10deg", translate: "0 -4px", offset: 0.7 },
        { rotate: "0deg", translate: "0 0" },
      ],
      { duration: 900, delay: 760, fill: "none" },
    );
  }

  function follow(): void {
    const caret = caretPoint();
    const rect = root?.getBoundingClientRect();
    if (!caret || !rect) return;
    const dx = (caret.x - (rect.left + rect.width / 2)) / 160;
    const dy = (caret.y - (rect.top + rect.height / 2)) / 160;
    setGaze({ x: Math.max(-1, Math.min(1, dx)), y: Math.max(-1, Math.min(1, dy)) });
    clearTimeout(idle);
    idle = setTimeout(shrug, 500);
  }

  onSettled(() => {
    shrug();
    document.addEventListener("input", follow, true);
    document.addEventListener("selectionchange", follow);
    return () => {
      clearTimeout(idle);
      document.removeEventListener("input", follow, true);
      document.removeEventListener("selectionchange", follow);
    };
  });

  return (
    <span class="ms-scene ms-search-scene" aria-hidden="true">
      <Mascot
        size={56}
        gaze={gaze()}
        ref={(element) => {
          root = element;
        }}
      />
    </span>
  );
}

/** The real search window. Each search finds nothing: type any text. */
export function SearchNothingFoundVariant() {
  return (
    <div class="ms-root ms-search">
      <GlobalSearch
        open
        agents={STORY_AGENTS}
        channels={[]}
        routines={[]}
        actions={[]}
        onSearchMessages={async () => ({ ...NO_PAGE })}
        onSearchFiles={async () => ({ ...NO_PAGE })}
        onOpenChange={() => {}}
        onSelectAgent={() => {}}
        onSelectChannel={() => {}}
        onSelectMessage={() => {}}
        onSelectRoutine={() => {}}
      />
      <MountInto selector=".global-search-empty">
        <SearchPlush />
      </MountInto>
    </div>
  );
}

// 3. Offline / reconnecting -------------------------------------------------

type LinkPhase = "offline" | "online" | "gone";

// The yarn between the two plushes, in the 120 x 44 box of the scene. Each pair has the same commands,
// so CSS can tween the path.
const YARN = {
  offline: { you: "M32 28 C 40 38, 46 40, 52 40", server: "M88 28 C 80 38, 74 40, 68 40" },
  toss: { you: "M32 28 C 42 14, 52 12, 58 22", server: "M88 28 C 80 38, 74 40, 68 40" },
  online: { you: "M32 26 C 40 26, 50 26, 60 26", server: "M88 26 C 80 26, 70 26, 60 26" },
} as const;

/** The lilac plush holds one end of a felt yarn; the server plush sleeps on the other end. */
function YarnScene(props: { phase: LinkPhase; tosses: number }) {
  const [tossing, setTossing] = createSignal(false);
  const [serverState, setServerState] = createSignal<PlushState>("asleep");
  const serverFace = (): { expression?: "heureux" } => (props.phase === "online" ? { expression: "heureux" } : {});
  let you: HTMLElement | undefined;
  let tossTimer: ReturnType<typeof setTimeout> | undefined;
  let wakeTimer: ReturnType<typeof setTimeout> | undefined;

  createEffect(
    () => props.tosses,
    (count) => {
      if (count === 0 || props.phase !== "offline" || prefersReducedMotion()) return;
      setTossing(true);
      play(you, [{ rotate: "0deg" }, { rotate: "-14deg", offset: 0.4 }, { rotate: "0deg" }], {
        duration: 520,
        fill: "none",
      });
      tossTimer = setTimeout(() => setTossing(false), 360);
      return () => clearTimeout(tossTimer);
    },
  );

  createEffect(
    () => props.phase,
    (phase) => {
      if (phase !== "online") {
        setServerState("asleep");
        return;
      }
      setServerState("wide");
      wakeTimer = setTimeout(() => setServerState("idle"), 520);
      return () => clearTimeout(wakeTimer);
    },
  );

  const path = (end: "you" | "server") =>
    props.phase === "online" ? YARN.online[end] : tossing() ? YARN.toss[end] : YARN.offline[end];

  return (
    <span class="ms-scene ms-yarn" data-phase={props.phase} aria-hidden="true">
      <span
        class="ms-yarn-you"
        ref={(element) => {
          you = element;
        }}
      >
        <Mascot size={36} face={props.phase === "online" ? "happy" : "idle"} />
      </span>
      <svg class="ms-yarn-line" viewBox="0 0 120 44" width="120" height="44" aria-hidden="true">
        <defs>
          <filter id="ms-yarn-fuzz" filterUnits="userSpaceOnUse" x="0" y="0" width="120" height="44">
            <feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="2" seed="4" />
            <feDisplacementMap in="SourceGraphic" scale="1.6" />
          </filter>
        </defs>
        <g filter="url(#ms-yarn-fuzz)">
          <path class="ms-yarn-strand" style={`d: path("${path("you")}")`} />
          <path class="ms-yarn-strand" style={`d: path("${path("server")}")`} />
          <path class="ms-yarn-ply" style={`d: path("${path("you")}")`} />
          <path class="ms-yarn-ply" style={`d: path("${path("server")}")`} />
        </g>
      </svg>
      <Show when={props.phase === "online"}>
        <img class="ms-yarn-ball" src={ballMint} alt="" draggable={false} />
      </Show>
      <span class="ms-yarn-server">
        <PlushBot
          character="nexo"
          state={serverState()}
          {...serverFace()}
          size={36}
          autoPause={false}
          paused={prefersReducedMotion()}
          ariaLabel=""
        />
      </span>
    </span>
  );
}

const RETRY_SECONDS = 12;

/** The real reconnect notice. Retry and each countdown end toss the yarn; "Online" connects it. */
export function OfflineYarnVariant() {
  const [phase, setPhase] = createSignal<LinkPhase>("offline");
  const [remaining, setRemaining] = createSignal(RETRY_SECONDS);
  const [tosses, setTosses] = createSignal(0);
  let goneTimer: ReturnType<typeof setTimeout> | undefined;

  function retry(): void {
    setTosses((count) => count + 1);
    setRemaining(RETRY_SECONDS);
  }

  onSettled(() => {
    const clock = setInterval(() => {
      if (phase() !== "offline") return;
      if (remaining() <= 1) retry();
      else setRemaining((seconds) => seconds - 1);
    }, 1000);
    return () => {
      clearInterval(clock);
      clearTimeout(goneTimer);
    };
  });

  function connect(): void {
    setPhase("online");
    goneTimer = setTimeout(() => setPhase("gone"), prefersReducedMotion() ? 600 : 1800);
  }

  function drop(): void {
    clearTimeout(goneTimer);
    setRemaining(RETRY_SECONDS);
    setPhase("offline");
  }

  let root: HTMLDivElement | undefined;
  return (
    <div
      ref={(element) => {
        root = element;
      }}
      class="ms-root ms-offline"
    >
      <Show when={phase() !== "gone"}>
        <ServerConnectionNotice
          name="Research server"
          phase="waiting"
          initial={false}
          remainingSeconds={remaining()}
          onRetry={retry}
          hideDetails
        />
      </Show>
      <MountInto selector=".server-connection-notice" root={() => root}>
        <YarnScene phase={phase()} tosses={tosses()} />
      </MountInto>
      <SceneControls>
        <Button size="sm" variant="outline" disabled={phase() !== "offline"} onClick={connect}>
          Online
        </Button>
        <Button size="sm" variant="outline" disabled={phase() === "offline"} onClick={drop}>
          Drop connection
        </Button>
      </SceneControls>
    </div>
  );
}

// 4. Crash / oops -----------------------------------------------------------

// Where each felt ball lands after the burst, from the plush's centre, in px. The plush tips to the
// right, so the balls land on the left, where it does not cover them.
const BALL_LANDINGS = [
  { x: -104, y: 30, turn: -220 },
  { x: -46, y: 36, turn: -300 },
  { x: -156, y: 26, turn: -420 },
] as const;

/** The plush tips over and its felt balls roll away. Reload rolls it back and calls the balls home. */
function CrashScene(props: { onReloaded: () => void }) {
  const [eyes, setEyes] = createSignal<"open" | "closed">("open");
  const [face, setFace] = createSignal<PlushMascotFace>("wide");
  const [reloading, setReloading] = createSignal(false);
  let plush: HTMLElement | undefined;
  const balls: HTMLElement[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];
  const later = (ms: number, run: () => void) => timers.push(setTimeout(run, prefersReducedMotion() ? 0 : ms));

  function burst(): void {
    play(
      plush,
      [
        { rotate: "0deg", scale: "1 1" },
        { rotate: "0deg", scale: "1.12 0.84", offset: 0.18 },
        { rotate: "-6deg", scale: "0.96 1.06", offset: 0.34 },
        { rotate: "96deg", scale: "1 1", offset: 0.78 },
        { rotate: "90deg", scale: "1 1" },
      ],
      { duration: 900, delay: 120 },
    );
    BALL_LANDINGS.forEach((landing, index) => {
      play(
        balls[index],
        [
          { translate: "0 0", rotate: "0deg", scale: "0.3", opacity: 0 },
          { translate: `${landing.x * 0.5}px -64px`, scale: "1", opacity: 1, offset: 0.4 },
          { translate: `${landing.x}px ${landing.y}px`, rotate: `${landing.turn}deg`, offset: 0.8 },
          { translate: `${landing.x * 1.04}px ${landing.y - 6}px`, offset: 0.9 },
          {
            translate: `${landing.x * 1.06}px ${landing.y}px`,
            rotate: `${landing.turn * 1.1}deg`,
            scale: "1",
            opacity: 1,
          },
        ],
        { duration: 820, delay: 220 + index * 60, easing: "cubic-bezier(0.3, 0.6, 0.4, 1)" },
      );
    });
    later(780, () => setEyes("closed"));
  }

  function reload(): void {
    if (reloading()) return;
    setReloading(true);
    BALL_LANDINGS.forEach((landing, index) => {
      play(
        balls[index],
        [
          { translate: `${landing.x * 1.06}px ${landing.y}px`, scale: "1", opacity: 1 },
          { translate: `${landing.x * 0.5}px -56px`, offset: 0.55 },
          { translate: "0 0", scale: "0.3", opacity: 0 },
        ],
        { duration: 560, delay: index * 70, easing: "cubic-bezier(0.5, 0, 0.6, 1)" },
      );
    });
    later(260, () => setEyes("open"));
    play(
      plush,
      [
        { rotate: "90deg", scale: "1 1" },
        { rotate: "-10deg", scale: "1 1", offset: 0.55 },
        { rotate: "0deg", scale: "1.14 0.82", offset: 0.72 },
        { rotate: "0deg", scale: "0.96 1.06", offset: 0.86 },
        { rotate: "0deg", scale: "1 1" },
      ],
      { duration: 820, delay: 360 },
    );
    later(1000, () => setFace("happy"));
    later(1700, props.onReloaded);
  }

  onSettled(() => {
    burst();
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  });

  return (
    <div class="ms-crash-panel">
      <div
        class="ms-scene ms-crash-stage"
        data-reduced={prefersReducedMotion() ? "true" : undefined}
        aria-hidden="true"
      >
        <For each={BALLS}>
          {(src, index) => (
            <img
              ref={(element) => {
                balls[index()] = element;
              }}
              class="ms-crash-ball"
              src={src}
              alt=""
              draggable={false}
            />
          )}
        </For>
        <Mascot
          size={96}
          class="ms-crash-plush"
          face={face()}
          eyes={eyes()}
          ref={(element) => {
            plush = element;
          }}
        />
      </div>
      <Heading as="h1" size="md">
        OpenBot stopped working
      </Heading>
      <Text as="p" variant="body-sm" tone="muted">
        Your chats and files are safe on this computer.
      </Text>
      <Button onClick={reload} disabled={reloading()}>
        Reload
      </Button>
    </div>
  );
}

/** A new screen for a renderer crash. Reload rolls the plush back up, then shows the real app. */
export function CrashVariant() {
  const [crashed, setCrashed] = createSignal(1);
  return (
    <div class="ms-root ms-crash">
      <Show when={crashed()} keyed fallback={<PrototypeApp />}>
        <CrashScene onReloaded={() => setCrashed(0)} />
      </Show>
      <SceneControls>
        <Button size="sm" variant="outline" disabled={crashed() !== 0} onClick={() => setCrashed((count) => count + 1)}>
          Crash again
        </Button>
      </SceneControls>
    </div>
  );
}

// 5. Files empty ------------------------------------------------------------

/** The plush peeks over the edge, looks around and ducks. A pointer brings it up; a drag makes it jump. */
function PeekScene() {
  const [awake, setAwake] = createSignal(false);
  const [gaze, setGaze] = createSignal<{ x: number; y: number } | null>(null);
  let root: HTMLElement | undefined;
  let plush: HTMLElement | undefined;

  function look(event: PointerEvent): void {
    const rect = plush?.getBoundingClientRect();
    if (!rect) return;
    const dx = (event.clientX - (rect.left + rect.width / 2)) / 120;
    const dy = (event.clientY - (rect.top + rect.height / 2)) / 120;
    setGaze({ x: Math.max(-1, Math.min(1, dx)), y: Math.max(-1, Math.min(1, dy)) });
  }

  onSettled(() => {
    const area = root?.closest(".file-list-message");
    if (!(area instanceof HTMLElement)) return;
    const enter = () => setAwake(true);
    const leave = () => {
      setAwake(false);
      setGaze(null);
    };
    const drag = () => {
      setAwake(true);
      play(
        plush,
        [
          { translate: "0 0", scale: "1 1" },
          { translate: "0 4px", scale: "1.12 0.86", offset: 0.2 },
          { translate: "0 -18px", scale: "0.94 1.08", offset: 0.55 },
          { translate: "0 0", scale: "1 1" },
        ],
        { duration: 560, fill: "none" },
      );
    };
    area.addEventListener("pointerenter", enter);
    area.addEventListener("pointerleave", leave);
    area.addEventListener("pointermove", look);
    area.addEventListener("dragenter", drag);
    return () => {
      area.removeEventListener("pointerenter", enter);
      area.removeEventListener("pointerleave", leave);
      area.removeEventListener("pointermove", look);
      area.removeEventListener("dragenter", drag);
    };
  });

  return (
    <span
      ref={(element) => {
        root = element;
      }}
      class="ms-scene ms-peek"
      data-awake={awake() ? "true" : undefined}
      aria-hidden="true"
    >
      <span class="ms-peek-window">
        <Mascot
          size={64}
          class="ms-peek-plush"
          face={awake() ? "wide" : "idle"}
          gaze={gaze()}
          ref={(element) => {
            plush = element;
          }}
        />
      </span>
    </span>
  );
}

/** The real file list with no files. */
export function FilesEmptyVariant() {
  return (
    <div class="ms-root ms-files">
      <div class="ms-files-page">
        <FileList label="All files" files={[]} showConversation onPreview={() => {}} onAction={async () => {}} />
      </div>
      <MountInto selector=".file-list-message">
        <PeekScene />
      </MountInto>
    </div>
  );
}

// 6. No agents / connecting -------------------------------------------------

const CREW: readonly PlushCharacterId[] = ["vita", "cloe", "yoshi"];
const WAVE_STEP_MS = 420;
const WAVE_LENGTH = 9;

/** Three crew plushes sleep and wake one by one, as a wave, while the roster connects. */
function CrewWave() {
  const reduced = prefersReducedMotion();
  const [tick, setTick] = createSignal(reduced ? 3 : 0);
  onSettled(() => {
    if (reduced) return;
    const clock = setInterval(() => setTick((value) => (value + 1) % WAVE_LENGTH), WAVE_STEP_MS);
    return () => clearInterval(clock);
  });
  const state = (index: number): PlushState => {
    const step = tick() - index;
    if (step === 0) return "wide";
    return step > 0 && step < 4 ? "idle" : "asleep";
  };
  return (
    <span class="ms-scene ms-crew" aria-hidden="true">
      <For each={CREW}>
        {(character, index) => (
          <span class="ms-crew-member" data-awake={state(index()) === "asleep" ? undefined : "true"}>
            <PlushBot
              character={character}
              state={state(index())}
              size={34}
              initialPhase={index() * 0.7}
              autoPause={false}
              paused={reduced}
              ariaLabel=""
            />
          </span>
        )}
      </For>
    </span>
  );
}

export const SIDEBAR_BASE = {
  serverName: "Research server",
  onOpenServerSettings: () => {},
  activeAgentId: "",
  people: [],
  directThreads: [],
  activeDirectMemberId: null,
  agentMoods: {},
  layout: defaultSidebarLayout(),
  collapsedSectionIds: [],
  onMutateLayout: async () => undefined,
  onToggleSection: () => {},
  pinnedItems: [],
  peopleOrder: [],
  onPin: () => {},
  onUnpin: () => {},
  onReorderPinned: () => {},
  onReorderPeople: () => {},
  onSelectAgent: () => {},
  onSelectPerson: () => {},
  onCreateAgent: () => {},
  onEditAgent: () => {},
  onDeleteAgent: async () => undefined,
  compact: false,
  onExpand: () => {},
  onOpenSearch: () => {},
  onOpenMarketplace: () => {},
} satisfies Omit<Parameters<typeof Sidebar>[0], "agents" | "agentStates">;

/** The real sidebar of a joined server while its roster connects. "Roster arrives" ends the wait. */
export function SidebarConnectingVariant() {
  const [arrived, setArrived] = createSignal(false);
  let root: HTMLDivElement | undefined;
  return (
    <div
      ref={(element) => {
        root = element;
      }}
      class="ms-root ms-sidebar"
    >
      <div class="ms-sidebar-frame">
        <Sidebar
          {...SIDEBAR_BASE}
          agents={arrived() ? STORY_AGENTS : []}
          agentStates={{}}
          agentsConnecting={!arrived()}
        />
      </div>
      <MountInto selector=".empty-search" root={() => root}>
        <CrewWave />
      </MountInto>
      <SceneControls>
        <Button size="sm" variant="outline" onClick={() => setArrived((value) => !value)}>
          {arrived() ? "Connect again" : "Roster arrives"}
        </Button>
      </SceneControls>
    </div>
  );
}

// 7. Marketplace no match ---------------------------------------------------

/** The plush tumbles in, lands with a squash, looks for a listing, and shrugs. A new query replays it. */
function TumbleScene() {
  const [run, setRun] = createSignal(0);
  let root: HTMLElement | undefined;

  function tumble(): void {
    const plush = root?.querySelector(".ms-mascot") ?? undefined;
    const eyes = root?.querySelector(".ui-plush-eyes") ?? undefined;
    play(
      plush,
      [
        { translate: "-150px -40px", rotate: "-360deg", scale: "1 1", opacity: 0 },
        { translate: "-112px 0", rotate: "-270deg", scale: "1 1", opacity: 1, offset: 0.16 },
        { translate: "-74px -22px", rotate: "-180deg", offset: 0.3 },
        { translate: "-38px 0", rotate: "-90deg", offset: 0.46 },
        { translate: "0 -8px", rotate: "-12deg", offset: 0.6 },
        { translate: "0 0", rotate: "0deg", scale: "1.16 0.82", offset: 0.7 },
        { translate: "0 -3px", rotate: "0deg", scale: "0.95 1.06", offset: 0.8 },
        { translate: "0 0", rotate: "0deg", scale: "1 1", opacity: 1 },
      ],
      { duration: 1100, easing: "linear" },
    );
    play(
      eyes,
      [
        { translate: "0 0" },
        { translate: "-5px 0", offset: 0.25 },
        { translate: "5px 0", offset: 0.6 },
        { translate: "0 0" },
      ],
      { duration: 900, delay: 1100, easing: "ease-in-out", fill: "none" },
    );
    play(
      plush,
      [
        { rotate: "0deg", translate: "0 0" },
        { rotate: "9deg", translate: "0 -5px", offset: 0.35 },
        { rotate: "9deg", translate: "0 -5px", offset: 0.7 },
        { rotate: "0deg", translate: "0 0" },
      ],
      { duration: 820, delay: 2000, fill: "none", composite: "replace" },
    );
  }

  onSettled(() => {
    tumble();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const replay = (event: Event) => {
      if (!(event.target instanceof HTMLInputElement)) return;
      clearTimeout(timer);
      timer = setTimeout(() => setRun((count) => count + 1), 450);
    };
    document.addEventListener("input", replay, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("input", replay, true);
    };
  });

  createEffect(run, (count) => {
    if (count > 0) tumble();
  });

  return (
    <span
      ref={(element) => {
        root = element;
      }}
      class="ms-scene ms-tumble"
      aria-hidden="true"
    >
      <Mascot size={72} />
    </span>
  );
}

/** The real marketplace with a query that matches nothing. Change the query to replay. */
export function MarketplaceNoMatchVariant() {
  let root: HTMLDivElement | undefined;
  return (
    <div
      ref={(element) => {
        root = element;
      }}
      class="ms-root ms-market"
    >
      <MarketplaceStory
        start={(nav) =>
          nav.set((draft) => {
            draft.query = "no listing has this name";
          })
        }
      />
      <MountInto selector=".marketplace-empty" root={() => root}>
        <TumbleScene />
      </MountInto>
    </div>
  );
}

// 8. Typing balls -----------------------------------------------------------

/** The agents that work in the app story. Research stays idle, so its row shows no badge. */
const WORKING_AGENTS = ["chief", "research", "sales"] as const;

const WORKING_OPTIONS: MockOpenBotOptions = {
  runtimeSnapshot: {
    agents: [],
    activeTurns: WORKING_AGENTS.map((agentId) => ({ agentId, threadId: agentId, turnId: `${agentId}-working` })),
    work: [],
    latestMessages: [],
    attentionComplete: true,
    pendingPrompts: [],
    pendingApprovals: [],
    pendingBrowserTakeovers: [],
    failedTurns: [],
  },
};

export type TypingLook = "now" | "pill" | "perch" | "orbit";

/**
 * The real app with two working agents. `look` changes only the working badge of the sidebar:
 * the shipped dots, or one of the felt-ball badges. CSS only.
 */
export function TypingBallsVariant(props: { look: TypingLook }) {
  return (
    <div class="ms-root ms-typing-app" data-look={props.look}>
      <PrototypeApp options={WORKING_OPTIONS} />
    </div>
  );
}

/* 9. Felt counts ----------------------------------------------------------- */

const UNREAD_AGENT = "research";
const FAILED_AGENT = "sales";
const FAILED_TURN = "sales-routine-failed";
const UNREAD_REPLIES = 10;

const researchSnapshot = STORY_SNAPSHOTS[UNREAD_AGENT];
const researchMessages = researchSnapshot?.messages ?? [];

/** Channel members. The first three are the story agents; the cluster counts the rest as "+N". */
const channelMembers = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ agentId: STORY_AGENTS[index]?.id ?? `member-${index + 1}` }));

/** A channel of five members: the sidebar cluster shows three faces and "+2". */
const COUNTS_CHANNEL: MockChannelSeed = {
  channel: {
    id: "channel-launch",
    name: "launch",
    title: "Friday launch",
    instructions: "Plan and run Friday's launch.",
    members: channelMembers(5),
    leadAgentId: "chief",
    archived: false,
    revision: 1,
    createdAt: "2026-08-19T08:00:00.000Z",
  },
  messages: [],
};

/**
 * Research has ten replies after the last read message. A routine run of Sales failed, so its row
 * shows the failed mark. Chief is the open chat and shows no badge. The launch channel has five
 * members, so its cluster shows "+2".
 */
const COUNTS_OPTIONS: MockOpenBotOptions = {
  channels: [COUNTS_CHANNEL],
  snapshots: {
    ...STORY_SNAPSHOTS,
    [UNREAD_AGENT]: {
      agentId: UNREAD_AGENT,
      threadId: researchSnapshot?.threadId ?? UNREAD_AGENT,
      activeTurnId: null,
      revision: 1,
      messages: [
        ...researchMessages,
        ...Array.from({ length: UNREAD_REPLIES }, (_, index) => ({
          id: `research-unread-${index}`,
          author: "assistant" as const,
          source: "assistant" as const,
          text: `Source ${index + 1} of the launch notes checks out.`,
          createdAt: `2026-08-19T10:${String(10 + index).padStart(2, "0")}:00.000Z`,
          status: "completed" as const,
        })),
      ],
    },
  },
  conversationReads: {
    [UNREAD_AGENT]: {
      unreadCount: 0,
      firstUnreadMessageId: null,
      throughMessageId: researchMessages.at(-1)?.id ?? null,
    },
  },
  queues: {
    ...STORY_QUEUES,
    [FAILED_AGENT]: [
      {
        id: "delivery-sales-routine",
        messageId: "message-sales-routine",
        recipientAgentId: FAILED_AGENT,
        sender: {
          kind: "routine",
          routineId: "routine-pipeline",
          runId: "run-pipeline-1",
          routineName: "Pipeline review",
          scheduledFor: "2026-08-19T09:00:00.000Z",
        },
        text: "Review the open deals and flag the ones that stalled.",
        attachments: [],
        replyToMessageId: null,
        status: "failed",
        position: null,
        turnId: FAILED_TURN,
        error: "The provider stopped the turn.",
        createdAt: "2026-08-19T09:00:00.000Z",
        expectsReply: false,
      },
    ],
  },
  runtimeSnapshot: {
    agents: [],
    activeTurns: [],
    work: [],
    latestMessages: [],
    attentionComplete: true,
    pendingPrompts: [],
    pendingApprovals: [],
    pendingBrowserTakeovers: [],
    failedTurns: [{ agentId: FAILED_AGENT, turnId: FAILED_TURN }],
  },
};

export type CountsLook = "now" | "puffy" | "yarn";

/** The ring width of every felt badge and of the faces in a channel cluster. */
export type RingWidth = "2" | "2.5" | "3" | "3.5";

/**
 * One cluster filter for each ring width. A dilate radius of 0.85 of the ring width draws the same
 * gap between faces as the CSS ring of the count, measured in device pixels.
 */
const RING_WIDTHS: readonly { width: RingWidth; filter: string; radius: number }[] = [
  { width: "2", filter: "ms-plush-ring", radius: 1.7 },
  { width: "2.5", filter: "ms-plush-ring-2-5", radius: 2.1 },
  { width: "3", filter: "ms-plush-ring-3", radius: 2.55 },
  { width: "3.5", filter: "ms-plush-ring-3-5", radius: 3 },
];

/**
 * The ring of the faces in a channel cluster. Single hairs make the fur edge noisy, so the filter
 * blurs the edge first and cuts it at 30%: a smooth outline of the face with an anti-aliased edge.
 * That outline, grown by the outline width and filled with the sidebar colour, is the ring under the
 * face. The face is cut to the outline, so it has the smooth, crisp edge of the "+N" count. The flood colour reads the token where the
 * filter is in the page, so it follows the theme.
 */
function PlushRingFilter() {
  return (
    <svg class="ms-plush-ring-defs" width="0" height="0" aria-hidden="true">
      <For each={RING_WIDTHS}>
        {(entry) => (
          <filter id={entry.filter} x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.5" result="soft" />
            <feComponentTransfer in="soft" result="hard">
              <feFuncA type="linear" slope="8" intercept="-2.4" />
            </feComponentTransfer>
            <feMorphology in="hard" operator="dilate" radius={entry.radius} result="grown" />
            <feFlood style={{ "flood-color": "var(--openbot-bg-sidebar)" }} />
            <feComposite in2="grown" operator="in" result="ring" />
            <feComposite in="SourceGraphic" in2="hard" operator="in" result="face" />
            <feMerge>
              <feMergeNode in="ring" />
              <feMergeNode in="face" />
            </feMerge>
          </filter>
        )}
      </For>
    </svg>
  );
}

/**
 * The real app with ten unread replies on Research and a failed routine on Sales. CSS only, and one
 * SVG filter for the ring of the channel faces.
 */
export function FeltCountsVariant(props: { look: CountsLook; ring?: RingWidth }) {
  return (
    <div class="ms-root ms-counts" data-look={props.look} data-ring={props.ring ?? "2"}>
      <PlushRingFilter />
      <PrototypeApp options={COUNTS_OPTIONS} />
    </div>
  );
}

const COUNTS_LOOKS: readonly { look: CountsLook; label: string; ring?: RingWidth }[] = [
  { look: "now", label: "Now" },
  { look: "puffy", label: "D. Puffy felt" },
  { look: "yarn", label: "E. Yarn" },
];

/** E with the three wider rings, under E with the 2px ring of now. */
const RING_LOOKS: readonly { look: CountsLook; label: string; ring?: RingWidth }[] = [
  { look: "now", label: "Now" },
  { look: "yarn", label: "E. Ring 2px" },
  { look: "yarn", label: "E1. Ring 2.5px", ring: "2.5" },
  { look: "yarn", label: "E2. Ring 3px", ring: "3" },
  { look: "yarn", label: "E3. Ring 3.5px", ring: "3.5" },
];

const SHEET_STATES: readonly SidebarAgentState[] = [
  { kind: "unread", count: 1 },
  { kind: "unread", count: 4 },
  { kind: "unread", count: 10 },
  { kind: "unread", count: 37 },
  { kind: "unread", count: 128 },
  { kind: "routine", phase: "failed", count: 1 },
];

/** Channels of 5 and 14 members: the cluster counts "+2" in its last cell and "+12" across its bottom row. */
const SHEET_CHANNEL_SIZES = [5, 14] as const;

/**
 * Each look next to the others, on the sidebar colour, with the counts the app can show. "Replay"
 * clears the badges and shows them again, so the entrance plays as it does when a reply arrives.
 */
export function FeltCountsSheetVariant(props: { rings?: boolean }) {
  const [shown, setShown] = createSignal(true);
  const replay = () => {
    setShown(false);
    requestAnimationFrame(() => setShown(true));
  };
  return (
    <div class="ms-root ms-counts-sheet">
      <PlushRingFilter />
      <div class="ms-counts-sheet-grid">
        <For each={props.rings ? RING_LOOKS : COUNTS_LOOKS}>
          {(entry) => (
            <div class="ms-counts ms-counts-sheet-row" data-look={entry.look} data-ring={entry.ring ?? "2"}>
              <Text as="span" variant="body-sm" tone="muted" class="ms-counts-sheet-label">
                {entry.label}
              </Text>
              <For each={SHEET_STATES}>
                {(state, index) => (
                  <span class="agent-row-avatar">
                    <AgentAvatar agent={STORY_AGENTS[index() % STORY_AGENTS.length]} motion="idle" />
                    <SidebarAgentIndicator state={() => (shown() ? state : undefined)} />
                  </span>
                )}
              </For>
              <For each={SHEET_CHANNEL_SIZES}>
                {(size) => (
                  <span class="agent-row-avatar">
                    <ChannelAvatar members={channelMembers(size)} agents={STORY_AGENTS} layout="cluster" />
                  </span>
                )}
              </For>
            </div>
          )}
        </For>
      </div>
      <Button size="sm" variant="outline" onClick={replay}>
        Replay
      </Button>
    </div>
  );
}

// 9T. Felt count transitions ------------------------------------------------

/** "bump" and "bump-b" take turns, so a second change during a bounce starts the bounce again. */
type BadgePhase = "idle" | "in" | "bump" | "bump-b" | "out";

/**
 * A copy of the shipped badge markup for the unread count and the failed mark, with felt motion:
 * it lands with a squash, bounces and rolls its digits when the count changes, and shrinks away when
 * it closes. The pill also grows or shrinks to the new width. The X lands, then shakes "no" once.
 */
function FeltBadge(props: { state: () => SidebarAgentState | undefined }) {
  const [shown, setShown] = createSignal<SidebarAgentState | undefined>(props.state());
  const [phase, setPhase] = createSignal<BadgePhase>("idle");
  const [previousCount, setPreviousCount] = createSignal<number | null>(null);
  let badge: HTMLSpanElement | undefined;
  let mounted = false;

  createEffect(
    () => props.state(),
    (next) => {
      if (!mounted) {
        mounted = true;
        return;
      }
      const current = shown();
      if (!next) {
        if (current) setPhase("out");
        return;
      }
      if (current?.kind === "unread" && next.kind === "unread" && phase() !== "out") {
        if (current.count === next.count) return;
        const from = badge?.getBoundingClientRect().width;
        setPreviousCount(current.count);
        setShown(next);
        setPhase(phase() === "bump" ? "bump-b" : "bump");
        requestAnimationFrame(() => {
          const to = badge?.getBoundingClientRect().width;
          if (!badge || from === undefined || to === undefined || from === to || prefersReducedMotion()) return;
          badge.animate([{ width: `${from}px` }, { width: `${to}px` }], {
            duration: 280,
            easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          });
        });
        return;
      }
      setPreviousCount(null);
      setShown(next);
      setPhase("in");
    },
  );

  const animationEnded = (event: AnimationEvent) => {
    if (event.target !== event.currentTarget) return;
    if (phase() === "out") setShown(undefined);
    setPhase("idle");
  };
  const failed = () => {
    const state = shown();
    return state?.kind === "routine" && state.phase === "failed";
  };
  const count = () => {
    const state = shown();
    return state?.kind === "unread" ? state.count : 0;
  };
  const rollClass = (direction: "in" | "out") => {
    if (phase() === "bump") return `ms-roll-${direction}`;
    if (phase() === "bump-b") return `ms-roll-${direction}-b`;
    return undefined;
  };

  return (
    <Show when={shown()}>
      {(state) => (
        <span
          ref={badge}
          class={[
            "agent-row-agent-status",
            `agent-row-agent-status-${state().kind}`,
            failed() ? "agent-row-agent-status-routine-failed" : "",
            `ms-badge-${phase()}`,
          ]}
          aria-hidden="true"
          onAnimationEnd={animationEnded}
        >
          <Show when={failed()}>
            <X aria-hidden="true" />
          </Show>
          <Show when={state().kind === "unread"}>
            <Show when={previousCount()}>
              {(previous) => (
                <span class={rollClass("out") ?? "ms-roll-gone"} onAnimationEnd={() => setPreviousCount(null)}>
                  {previous()}
                </span>
              )}
            </Show>
            <span class={rollClass("in")}>{count()}</span>
          </Show>
        </span>
      )}
    </Show>
  );
}

/** The steps of "Play all": a reply lands, more arrive, the user reads them, a routine fails and is retried. */
const TRANSITION_STEPS: readonly { replies: number; failed: boolean; ms: number }[] = [
  { replies: 1, failed: false, ms: 900 },
  { replies: 2, failed: false, ms: 700 },
  { replies: 3, failed: false, ms: 700 },
  { replies: 10, failed: false, ms: 900 },
  { replies: 10, failed: true, ms: 1100 },
  { replies: 0, failed: true, ms: 1100 },
  { replies: 0, failed: false, ms: 900 },
];

/**
 * Two rows per look: Research with unread replies and Sales with a failed routine. The buttons
 * change the state of every look at once, so the transitions play side by side. "Now" is the
 * shipped indicator: it only pops in.
 */
export function FeltCountsTransitionsVariant() {
  const [replies, setReplies] = createSignal(0);
  const [failed, setFailed] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const unreadState = (): SidebarAgentState | undefined =>
    replies() > 0 ? { kind: "unread", count: replies() } : undefined;
  const failedState = (): SidebarAgentState | undefined =>
    failed() ? { kind: "routine", phase: "failed", count: 1 } : undefined;

  const stop = () => clearTimeout(timer);
  const playFrom = (step: number) => {
    const next = TRANSITION_STEPS[step];
    if (!next) return;
    setReplies(next.replies);
    setFailed(next.failed);
    timer = setTimeout(() => playFrom(step + 1), next.ms);
  };
  const playAll = () => {
    stop();
    setReplies(0);
    setFailed(false);
    timer = setTimeout(() => playFrom(0), 400);
  };
  onSettled(() => stop);

  return (
    <div class="ms-root ms-counts-sheet">
      <PlushRingFilter />
      <div class="ms-counts-sheet-grid">
        <For each={COUNTS_LOOKS}>
          {(entry) => (
            <div class="ms-counts ms-counts-sheet-row ms-counts-transition-row" data-look={entry.look}>
              <Text as="span" variant="body-sm" tone="muted" class="ms-counts-sheet-label">
                {entry.label}
              </Text>
              <span class="agent-row-avatar">
                <AgentAvatar agent={STORY_AGENTS[1] ?? STORY_AGENTS[0]} motion="idle" />
                <Show when={entry.look === "now"} fallback={<FeltBadge state={unreadState} />}>
                  <SidebarAgentIndicator state={unreadState} />
                </Show>
              </span>
              <span class="agent-row-avatar">
                <AgentAvatar agent={STORY_AGENTS[2] ?? STORY_AGENTS[0]} motion="idle" />
                <Show when={entry.look === "now"} fallback={<FeltBadge state={failedState} />}>
                  <SidebarAgentIndicator state={failedState} />
                </Show>
              </span>
            </div>
          )}
        </For>
      </div>
      <div class="ms-counts-transition-controls">
        <Button size="sm" variant="outline" onClick={playAll}>
          Play all
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            stop();
            setReplies((count) => count + 1);
          }}
        >
          New reply
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            stop();
            setReplies((count) => count + 9);
          }}
        >
          9 new replies
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={replies() === 0}
          onClick={() => {
            stop();
            setReplies(0);
          }}
        >
          Mark read
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            stop();
            setFailed((value) => !value);
          }}
        >
          {failed() ? "Retry routine" : "Fail routine"}
        </Button>
      </div>
    </div>
  );
}
