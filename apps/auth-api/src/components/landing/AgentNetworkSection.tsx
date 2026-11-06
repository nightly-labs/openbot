import { ProviderLogo } from "@openbot/brand";
import { prefersReducedMotion } from "@openbot/ui/utils";
import { createSignal, For, onSettled } from "solid-js";
import { LANDING_NETWORK_AGENTS, LANDING_NETWORK_HUB, LANDING_PROVIDERS } from "../../lib/landing-content";
import { createAgentNetworkEggs } from "./agent-network-eggs";
import {
  agentNetworkHubAt,
  agentNetworkNodeAt,
  buildAgentNetwork,
  drawAgentNetwork,
  type HubSignal,
  type HubSignalStyle,
  type NetworkAssets,
  type NetworkView,
  randomHubSignalStyle,
  regrowAgentNetwork,
  startHubSignal,
} from "./agent-network-scene";
import { useLandingText } from "./LandingText";

/** The grown network chooses from this many avatars. The three named agents come after them. */
const GROWN_AVATARS = 24;
/**
 * The scene starts when this share of the stage is on screen, so the first agents are in view.
 * A stage that is higher than the window counts against the window height.
 */
const START_SHARE = 0.7;
const SHARE_STEPS = Array.from({ length: 11 }, (_, index) => index / 10);
const MARKS = LANDING_PROVIDERS.map((entry) => entry.provider);

/**
 * Draws an SVG element into a square canvas, so the scene can draw it many times a frame.
 * `crop` trims the empty margin around the drawing: an avatar fills its node.
 */
async function rasterize(svg: SVGSVGElement, size: number, crop = false): Promise<HTMLCanvasElement> {
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml;charset=utf-8" }),
  );
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d", { willReadFrequently: crop });
    if (!context) return canvas;
    context.drawImage(image, 0, 0, size, size);
    return crop ? trimmed(canvas, context) : canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The smallest square around the drawn pixels of `canvas`. */
function trimmed(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D): HTMLCanvasElement {
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  let left = canvas.width;
  let right = -1;
  let top = canvas.height;
  let bottom = -1;
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      if ((data[(y * canvas.width + x) * 4 + 3] ?? 0) < 8) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left) return canvas;
  const side = Math.max(right - left, bottom - top) + 1;
  const square = document.createElement("canvas");
  square.width = side;
  square.height = side;
  square
    .getContext("2d")
    ?.drawImage(
      canvas,
      left,
      top,
      right - left + 1,
      bottom - top + 1,
      (side - (right - left + 1)) / 2,
      (side - (bottom - top + 1)) / 2,
      right - left + 1,
      bottom - top + 1,
    );
  return square;
}

/**
 * A copy of a provider mark with its colour written on it: the page colours the
 * marks from CSS, which an image does not read. Gemini's gradient goes with it.
 */
function standaloneMark(mark: SVGSVGElement): SVGSVGElement {
  const copy = mark.cloneNode(true);
  if (!(copy instanceof SVGSVGElement)) throw new Error("A provider mark did not clone as SVG.");
  const fill = getComputedStyle(mark).fill;
  const gradientId = /url\("?#([^")]+)"?\)/.exec(fill)?.[1];
  const gradient = gradientId ? document.getElementById(gradientId) : null;
  if (gradient) {
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    defs.appendChild(gradient.cloneNode(true));
    copy.insertBefore(defs, copy.firstChild);
    copy.setAttribute("fill", `url(#${gradientId})`);
  } else {
    copy.setAttribute("fill", fill.startsWith("url(") ? getComputedStyle(mark).color : fill);
  }
  return copy;
}

/**
 * "Your agents talk to each other": Ada, Linus and Grace pass the Safari task
 * through OpenBot, then the network grows until it fills the frame. When it is
 * complete, a click on an agent grows a new network from that agent. At any time,
 * a click on the hub sends a signal, in one of the styles at random, through the
 * network. The picture is decorative; the heading and the sentence carry the message.
 * It also hides easter eggs (see `agent-network-eggs.ts`), which reduced motion turns off.
 */
export function AgentNetworkSection() {
  const [playing, setPlaying] = createSignal(false);
  let stageRef: HTMLDivElement | undefined;
  let canvasRef: HTMLCanvasElement | undefined;
  let marksRef: HTMLDivElement | undefined;
  let headingRef: HTMLElement | undefined;
  const text = useLandingText();

  onSettled(() => {
    const stage = stageRef;
    const canvas = canvasRef;
    const context = canvas?.getContext("2d");
    const named = LANDING_NETWORK_AGENTS.map((agent, index) => ({
      label: agent.teammate.name,
      avatar: GROWN_AVATARS + index,
      mark: MARKS.indexOf(agent.provider),
    }));
    const [first, second, third] = named;
    const [firstMessage, secondMessage, thirdMessage] = text().picture.team.messages;
    // With no canvas, or in Safari before 16, which cannot draw rounded rectangles,
    // the section shows its heading with no network.
    if (
      !stage ||
      !canvas ||
      !context ||
      typeof context.roundRect !== "function" ||
      !first ||
      !second ||
      !third ||
      !firstMessage ||
      !secondMessage ||
      !thirdMessage
    ) {
      setPlaying(true);
      return;
    }

    const reduced = prefersReducedMotion();
    // A new network at each visit. The scene builds only in the browser, so the page markup does not change.
    const newSeed = () => Math.floor(Math.random() * 2 ** 32);
    const seed = newSeed();
    let network = buildAgentNetwork({
      agents: [first, second, third],
      messages: [firstMessage, secondMessage, thirdMessage],
      hubLabel: LANDING_NETWORK_HUB,
      seed,
      avatarCount: GROWN_AVATARS,
      markCount: MARKS.length,
    });

    const style = getComputedStyle(stage);
    const token = (name: string) => style.getPropertyValue(name).trim();
    const assets: NetworkAssets = {
      avatars: [],
      avatarColors: [],
      marks: [],
      font: style.fontFamily,
      colors: {
        hub: token("--openbot-logo-production"),
        hubEye: token("--openbot-logo-production-eye"),
        dot: token("--openbot-glass-border"),
        badge: token("--openbot-bg-control-active"),
        canvas: token("--openbot-bg-canvas"),
        bubble: token("--openbot-bg-surface"),
        bubbleBorder: token("--openbot-dialog-ring"),
        bubbleText: token("--openbot-text-primary"),
        label: token("--openbot-text-secondary"),
        hubPulse: token("--openbot-text-primary"),
      },
    };

    const view: NetworkView = { width: 0, height: 0, top: 0, narrow: false };
    let ratio = 1;
    let time = 0;
    let signals: HubSignal[] = [];
    let started = false;
    let visible = false;
    let frame = 0;
    let last = 0;
    let disposed = false;

    const now = () => (reduced ? network.end : time);
    const draw = () => {
      if (!view.width) return;
      const t = now();
      if (signals.some((signal) => signal.end <= t)) signals = signals.filter((signal) => signal.end > t);
      // A roll turns the canvas, so the scene cannot clear the corners: clear the whole canvas first.
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      eggs.move(context, t);
      drawAgentNetwork(context, eggs.shown(t), assets, view, t, !reduced && !eggs.asleep(), signals);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      eggs.drawSleep(context, assets, t);
    };
    const tick = (stamp: number) => {
      frame = 0;
      // A long gap (a hidden tab, a slow frame) does not jump the story forward.
      time += last ? Math.min(0.05, (stamp - last) / 1000) : 0;
      last = stamp;
      eggs.tick();
      draw();
      if (visible && !document.hidden) frame = requestAnimationFrame(tick);
    };
    const play = () => {
      if (reduced || !started || !visible || document.hidden || frame) return;
      last = 0;
      frame = requestAnimationFrame(tick);
    };

    const resize = () => {
      const box = stage.getBoundingClientRect();
      ratio = Math.min(2, window.devicePixelRatio || 1);
      view.width = box.width;
      view.height = box.height;
      view.narrow = box.width < 640;
      view.top = headingRef ? headingRef.getBoundingClientRect().bottom - box.top : 0;
      // The network behind the heading fades out, so the heading stays readable.
      stage.style.setProperty("--landing-network-top", `${Math.round(view.top)}px`);
      canvas.width = Math.round(box.width * ratio);
      canvas.height = Math.round(box.height * ratio);
      draw();
    };
    // True where the mask of `.landing-network-canvas` shows at least half of the network:
    // between the middles of the fades under the heading and at the bottom, and inside the middle
    // of the fade of the ellipse (72% × 78% at 50% 55%, solid to 60%).
    const unmasked = (x: number, y: number) =>
      y >= view.top + 48 &&
      y <= view.height - 60 &&
      Math.hypot((x - view.width * 0.5) / (view.width * 0.72), (y - view.height * 0.55) / (view.height * 0.78)) <= 0.8;
    const startSignal = (style: HubSignalStyle, at: number) => {
      const signal = startHubSignal(network, style, at);
      if (signal) signals = [...signals, signal];
    };
    const eggs = createAgentNetworkEggs({
      network: () => network,
      view,
      now,
      unmasked,
      signal: startSignal,
      eggs: text().network.eggs,
    });
    // When the network is complete, a click on a visible agent grows a new network from it.
    const agentAt = (event: MouseEvent) => {
      if (now() < network.end) return -1;
      const box = canvas.getBoundingClientRect();
      const x = event.clientX - box.left;
      const y = event.clientY - box.top;
      return unmasked(x, y) ? agentNetworkNodeAt(network, view, now(), x, y) : -1;
    };
    // Reduced motion has no signal.
    const onHub = (event: MouseEvent) => {
      if (reduced) return false;
      const box = canvas.getBoundingClientRect();
      return agentNetworkHubAt(network, view, now(), event.clientX - box.left, event.clientY - box.top);
    };
    const click = (event: MouseEvent) => {
      if (onHub(event)) {
        startSignal(randomHubSignalStyle(), now());
        eggs.poke();
        return;
      }
      const root = agentAt(event);
      if (root < 0) return;
      signals = [];
      eggs.reset();
      network = regrowAgentNetwork(network, root, now(), {
        seed: newSeed(),
        avatarCount: GROWN_AVATARS,
        markCount: MARKS.length,
      });
      time = 0;
      canvas.style.cursor = "";
      draw();
      play();
    };
    const point = (event: PointerEvent) => {
      const mouse = event.pointerType === "mouse";
      const agent = mouse ? agentAt(event) : -1;
      canvas.style.cursor = mouse && (onHub(event) || agent >= 0) ? "pointer" : "";
      if (!reduced) eggs.hover(agent);
    };
    canvas.addEventListener("click", click);
    canvas.addEventListener("pointermove", point);
    const leave = () => eggs.hover(-1);
    canvas.addEventListener("pointerleave", leave);
    const typed = (event: KeyboardEvent) => {
      if (!reduced && visible) eggs.typed(event);
    };
    document.addEventListener("keydown", typed);
    const inputEvents = ["pointermove", "pointerdown", "keydown", "wheel", "scroll", "touchstart"] as const;
    for (const name of inputEvents) window.addEventListener(name, eggs.active, { passive: true });

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(stage);

    const intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        visible = entry.isIntersecting;
        const room = Math.min(entry.boundingClientRect.height, entry.rootBounds?.height ?? window.innerHeight);
        if (room > 0 && entry.intersectionRect.height / room >= START_SHARE && !started) {
          started = true;
          setPlaying(true);
        }
        play();
      },
      { threshold: SHARE_STEPS },
    );
    intersectionObserver.observe(stage);
    document.addEventListener("visibilitychange", play);
    if (reduced) setPlaying(true);

    // A failed image keeps its node as a coloured circle; the rest of the scene still draws.
    const marks = Array.from(marksRef?.querySelectorAll("svg") ?? []);
    void Promise.all(marks.map((mark) => rasterize(standaloneMark(mark), 64)))
      .then((images) => {
        if (disposed) return;
        assets.marks = images;
        draw();
      })
      .catch(() => {});
    // The avatar engine is too large for the first load of the home page, as in the features section.
    void import("@openbot/ui/bloub-avatar")
      .then(({ AVATAR_HUE_CHOICES, avatarHeadColor, createStaticAvatarSvg }) => {
        if (disposed) return;
        const seeds = [
          ...Array.from({ length: GROWN_AVATARS }, (_, index) => ({
            seed: `landing-network-${seed}-${index}`,
            hue: AVATAR_HUE_CHOICES[(seed + index) % AVATAR_HUE_CHOICES.length]?.hue ?? null,
          })),
          ...LANDING_NETWORK_AGENTS.map((agent) => ({
            seed: agent.teammate.avatarSeed,
            hue: agent.teammate.avatarHue,
          })),
        ];
        assets.avatarColors = seeds.map((entry) => avatarHeadColor(entry.seed, entry.hue));
        draw();
        return Promise.all(seeds.map((entry) => rasterize(createStaticAvatarSvg(entry.seed, entry.hue), 192, true)));
      })
      .then((avatars) => {
        if (disposed || !avatars) return;
        assets.avatars = avatars;
        draw();
      })
      .catch(() => {});

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", play);
      document.removeEventListener("keydown", typed);
      for (const name of inputEvents) window.removeEventListener(name, eggs.active);
      canvas.removeEventListener("click", click);
      canvas.removeEventListener("pointermove", point);
      canvas.removeEventListener("pointerleave", leave);
      cancelAnimationFrame(frame);
    };
  });

  return (
    <section
      class="landing-section landing-network"
      aria-labelledby="network-title"
      data-playing={playing() ? "true" : "false"}
    >
      <div ref={stageRef} class="landing-network-stage">
        <canvas ref={canvasRef} class="landing-network-canvas" />
        <header ref={headingRef} class="landing-section-heading landing-network-heading">
          <h2 id="network-title">
            <For each={text().network.title}>
              {(word, index) => (
                <>
                  <span class="landing-network-word" style={{ "--landing-network-word": index() }}>
                    {word}
                  </span>{" "}
                </>
              )}
            </For>
          </h2>
          <p class="landing-network-description">{text().network.description}</p>
        </header>
        {/* The provider marks that the scene draws on each badge, with their page colours. */}
        <div ref={marksRef} class="landing-network-marks" aria-hidden="true">
          <For each={MARKS}>{(provider) => <ProviderLogo provider={provider} />}</For>
        </div>
      </div>
    </section>
  );
}
