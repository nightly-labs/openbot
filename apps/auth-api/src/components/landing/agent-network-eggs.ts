// Easter eggs of the landing agent network. They add message bubbles and hub signals to the
// network that the scene draws, move the canvas for a roll or a shake, and draw a sleep over it.
// All three run together: secret words, pokes on the hub, and an idle network that falls asleep.
// All times are seconds of the network, as in the scene, except the idle timers, which use
// the page clock: the network clock stops when the section is off screen.

import type { LandingPageText } from "../../lib/landing-page-text";
import {
  type AgentNetwork,
  agentNetworkNodePoint,
  clamp01,
  easeInOutCubic,
  HUB_SIGNAL_STYLES,
  type HubSignalStyle,
  type NetworkAssets,
  type NetworkMessage,
  type NetworkView,
  randomHubSignalStyle,
} from "./agent-network-scene";

const KONAMI = [
  "arrowup",
  "arrowup",
  "arrowdown",
  "arrowdown",
  "arrowleft",
  "arrowright",
  "arrowleft",
  "arrowright",
  "b",
  "a",
];
/** Clicks on the hub that are less than this many seconds apart make a streak. */
const POKE_STREAK_GAP = 1.4;
/** Milliseconds with no input before a complete network falls asleep. */
const IDLE_MS = 8000;
/** Milliseconds that the pointer stays on an agent before the agent talks. */
const HOVER_MS = 1100;
const ROLL_SECONDS = 1.6;
/** A click adds no chat while this many agents talk. */
const MAX_TALKERS = 4;

const pick = (lines: readonly string[]) => lines[Math.floor(Math.random() * lines.length)] ?? "";
/** The lines in a random order, so agents that talk together do not say the same line. */
const shuffled = (lines: readonly string[]) =>
  lines
    .map((line) => ({ line, order: Math.random() }))
    .sort((a, b) => a.order - b.order)
    .map((entry) => entry.line);

export interface AgentNetworkEggsHost {
  network: () => AgentNetwork;
  view: NetworkView;
  now: () => number;
  /** True where the mask of the canvas shows the network. */
  unmasked: (x: number, y: number) => boolean;
  /** Starts a hub signal at second `at`. */
  signal: (style: HubSignalStyle, at: number) => void;
  /** What the network says, in the language of the page. */
  eggs: LandingPageText["network"]["eggs"];
}

export function createAgentNetworkEggs(host: AgentNetworkEggsHost) {
  const { view, now } = host;
  let bubbles: NetworkMessage[] = [];
  let shake = { at: -1, until: -1, size: 0 };
  let roll = { at: -1, until: -1 };
  let keys: string[] = [];
  let pokes = { count: 0, last: -10 };
  let lastInput = performance.now();
  let sleep: { asleep: boolean; at: number; sleepers: number[] } = { asleep: false, at: -1, sleepers: [] };
  let dim = 0;
  let dimAt = 0;
  let hover = { node: -1, since: 0, spoken: false };
  /** True when a new network is to chat when it is complete. */
  let chatWhenComplete = false;
  /** The page time at which the network was complete, or -1. A visitor who watches it grow is not idle. */
  let completedAt = -1;

  const point = (t: number, index: number) => agentNetworkNodePoint(host.network(), view, t, index);
  const hubIndex = () => host.network().nodes.findIndex((node) => node.avatar === -1);
  /** The hub speaks. A regrown network has no hub, so its first agent speaks. */
  const speaker = () => Math.max(0, hubIndex());
  /**
   * Up to `count` agents on screen, large ones first with some chance, far enough apart that their
   * bubbles do not overlap, also with the bubbles that show now. Agents near the heading do not
   * count: their bubbles go under it.
   */
  const spreadAgents = (count: number, gap = 190) => {
    const t = now();
    const network = host.network();
    const candidates = network.nodes
      .map((node, index) => ({ index, node, at: point(t, index) }))
      .filter(
        ({ node, at }) =>
          node.avatar !== -1 &&
          node.at <= t &&
          at !== undefined &&
          at.radius >= 7 &&
          host.unmasked(at.x, at.y) &&
          at.y - at.radius > view.top + 130,
      )
      .sort((a, b) => (b.at?.radius ?? 0) - (a.at?.radius ?? 0) + (Math.random() - 0.5) * 6);
    const hub = point(t, speaker());
    const talking = bubbles.filter((bubble) => bubble.until >= t).flatMap((bubble) => point(t, bubble.node) ?? []);
    const chosen: { x: number; y: number; index: number }[] = [];
    for (const { index, at } of candidates) {
      if (!at || chosen.length >= count) continue;
      if (hub && Math.hypot(hub.x - at.x, hub.y - at.y) < gap * 0.8) continue;
      if ([...talking, ...chosen].some((other) => Math.hypot(other.x - at.x, other.y - at.y) < gap)) continue;
      chosen.push({ x: at.x, y: at.y, index });
    }
    return chosen.map((entry) => entry.index);
  };
  const say = (node: number, text: string, delay = 0, length = 2.6) => {
    const at = now() + delay;
    bubbles = [
      ...bubbles.filter((bubble) => bubble.node !== node || bubble.until < at),
      { node, text, at, until: at + length },
    ];
  };
  /**
   * Each agent of `nodes` says a different line of `lines`, one after the other. A narrow frame
   * shows one bubble at a time, so there only the first agent speaks, and only when no bubble shows.
   */
  const chorus = (nodes: readonly number[], lines: readonly string[], delay: number, step: number, length: number) => {
    const t = now();
    const busy = [...host.network().messages, ...bubbles].some((bubble) => bubble.until >= t);
    const speakers = view.narrow ? (busy ? [] : nodes.slice(0, 1)) : nodes;
    const order = shuffled(lines);
    for (const [index, node] of speakers.entries())
      say(node, order[index % order.length] ?? "", delay + index * step, length);
  };
  const signal = (style: HubSignalStyle, delay = 0) => host.signal(style, now() + delay);
  const randomSignal = (delay = 0) => signal(randomHubSignalStyle(), delay);
  /** Up to `count` agents chat after `delay`, when there is room. */
  const chat = (count: number, delay: number) => {
    const t = now();
    const talkers = new Set(bubbles.filter((bubble) => bubble.until >= t).map((bubble) => bubble.node)).size;
    chorus(spreadAgents(Math.min(count, MAX_TALKERS - talkers)), host.eggs.chats, delay, 0.45, 2.6);
  };
  const startShake = (length: number, size: number) => {
    shake = { at: now(), until: now() + length, size };
  };

  return {
    /** The network with the bubbles of the eggs, to draw at second `t`. Old bubbles go. */
    shown(t: number): AgentNetwork {
      if (bubbles.some((bubble) => bubble.until + 0.3 < t))
        bubbles = bubbles.filter((bubble) => bubble.until + 0.3 >= t);
      const network = host.network();
      return bubbles.length ? { ...network, messages: [...network.messages, ...bubbles] } : network;
    },

    /** Turns or shakes the canvas at second `t`. Call it after the base transform and before the scene draws. */
    move(context: CanvasRenderingContext2D, t: number) {
      if (t >= roll.at && t < roll.until) {
        const centreX = view.width / 2;
        const centreY = view.top + (view.height - view.top) / 2;
        context.translate(centreX, centreY);
        context.rotate(easeInOutCubic((t - roll.at) / (roll.until - roll.at)) * Math.PI * 2);
        context.translate(-centreX, -centreY);
      }
      if (t >= shake.at && t < shake.until) {
        const size = shake.size * (1 - (t - shake.at) / (shake.until - shake.at));
        context.translate(Math.sin(t * 93) * size, Math.cos(t * 71) * size);
      }
    },

    /** A sleeping network has no background pulses. */
    asleep: () => sleep.asleep,

    /** Dims the frame and draws letters that rise from the sleepers. Call it with the base transform. */
    drawSleep(context: CanvasRenderingContext2D, assets: NetworkAssets, t: number) {
      const target = sleep.asleep ? 1 : 0;
      dim += (target - dim) * clamp01((t - dimAt) * (sleep.asleep ? 1.5 : 6));
      dimAt = t;
      if (dim <= 0.01) return;
      context.globalAlpha = dim * 0.55;
      context.fillStyle = assets.colors.canvas;
      context.fillRect(0, 0, view.width, view.height);
      context.fillStyle = assets.colors.bubbleText;
      context.textAlign = "center";
      context.textBaseline = "middle";
      for (const [order, index] of sleep.sleepers.entries()) {
        const at = point(t, index);
        if (!at) continue;
        for (let letter = 0; letter < 3; letter += 1) {
          const phase = ((t - sleep.at) * 0.45 + letter / 3 + order * 0.17) % 1;
          context.globalAlpha = Math.sin(Math.PI * phase) * dim * 0.9;
          context.font = `600 ${Math.round(12 + phase * 12)}px ${assets.font}`;
          context.fillText(
            "z",
            at.x + at.radius * 0.7 + phase * 16 + Math.sin(phase * 6 + order) * 3,
            at.y - at.radius * 0.7 - phase * 38,
          );
        }
      }
      context.globalAlpha = 1;
    },

    /**
     * Call it each frame: a new network chats when it is complete, a complete network with no input
     * falls asleep, and an agent under a still pointer talks.
     */
    tick() {
      const t = now();
      const stamp = performance.now();
      if (t < host.network().end) return;
      if (completedAt < 0) completedAt = stamp;
      if (chatWhenComplete) {
        chatWhenComplete = false;
        chat(2 + Math.floor(Math.random() * 2), 0.2);
      }
      if (!sleep.asleep && stamp - Math.max(lastInput, completedAt) > IDLE_MS) {
        bubbles = [];
        const hub = hubIndex();
        sleep = { asleep: true, at: t, sleepers: [...spreadAgents(9, 120), ...(hub >= 0 ? [hub] : [])] };
      }
      if (hover.node >= 0 && !hover.spoken && !sleep.asleep && stamp - hover.since > HOVER_MS) {
        hover.spoken = true;
        say(hover.node, pick(host.eggs.hover), 0, 3);
      }
    },

    /** The agent under the mouse, or -1. */
    hover(node: number) {
      if (node !== hover.node) hover = { node, since: performance.now(), spoken: false };
    },

    /** Any input wakes the network. */
    active() {
      lastInput = performance.now();
      if (!sleep.asleep) return;
      sleep = { asleep: false, at: -1, sleepers: [] };
      randomSignal();
      chorus(spreadAgents(3), host.eggs.wake, 0.3, 0.35, 2.4);
    },

    /**
     * A click on the hub. One or two agents answer the signal. A quick streak of clicks makes the
     * hub answer, then shake, then sneeze.
     */
    poke() {
      const t = now();
      pokes = { count: t - pokes.last < POKE_STREAK_GAP ? pokes.count + 1 : 1, last: t };
      const hub = speaker();
      if (pokes.count === 3) say(hub, pick(host.eggs.tickle));
      if (pokes.count === 5) {
        say(hub, pick(host.eggs.awake));
        chorus(spreadAgents(4), host.eggs.wonder, 0.25, 0.15, 1.8);
      }
      if (pokes.count === 8) {
        say(hub, pick(host.eggs.busy));
        startShake(0.6, 5);
      }
      if (pokes.count === 12) {
        say(hub, pick(host.eggs.sneeze), 0, 1.6);
        startShake(0.9, 14);
        for (const style of HUB_SIGNAL_STYLES) signal(style, 0.05);
        chorus(spreadAgents(5), host.eggs.blessings, 0.9, 0.2, 2);
        pokes = { count: 0, last: -10 };
        return;
      }
      if (pokes.count !== 5) chat(1 + Math.floor(Math.random() * 2), 0.5);
    },

    /** A key on the page. Secret words: "hello", "party", "sudo", and the Konami code. Keys in a field do not count. */
    typed(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))
      )
        return;
      keys = [...keys, event.key.toLowerCase()].slice(-12);
      const word = keys.filter((key) => key.length === 1).join("");
      const hub = speaker();
      if (KONAMI.every((key, index) => keys[keys.length - KONAMI.length + index] === key)) {
        keys = [];
        roll = { at: now(), until: now() + ROLL_SECONDS };
        say(hub, pick(host.eggs.konami), ROLL_SECONDS, 2.4);
        randomSignal(ROLL_SECONDS);
      } else if (word.endsWith("hello")) {
        keys = [];
        chorus(spreadAgents(6), host.eggs.greetings, 0, 0.18, 2.4);
      } else if (word.endsWith("party")) {
        keys = [];
        say(hub, pick(host.eggs.party), 0, 4);
        for (let beat = 0; beat < 10; beat += 1) randomSignal(beat * 0.45);
        startShake(0.4, 3);
      } else if (word.endsWith("sudo")) {
        keys = [];
        say(hub, pick(host.eggs.sudo), 0, 3);
      }
    },

    /** A new network starts with no egg running, and chats when it is complete. */
    reset() {
      chatWhenComplete = true;
      completedAt = -1;
      bubbles = [];
      shake = { at: -1, until: -1, size: 0 };
      roll = { at: -1, until: -1 };
      sleep = { asleep: false, at: -1, sleepers: [] };
      dim = 0;
      dimAt = 0;
      hover = { node: -1, since: 0, spoken: false };
      pokes = { count: 0, last: -10 };
    },
  };
}
