import { APP_LOGO_CORNER, APP_LOGO_EYE_POINTS, APP_LOGO_SIZE } from "@openbot/brand/app-logo-shape";

const HUB = -1;

interface NetworkNode {
  x: number;
  y: number;
  at: number;
  radius: number;
  avatar: number;
  mark: number;
  label?: string;
  busy: boolean;
  phase: number;
}

interface NetworkEdge {
  from: number;
  to: number;
  at: number;
  dots: Float32Array;
  length: number;
}

export interface NetworkMessage {
  node: number;
  text: string;
  at: number;
  until: number;
}

interface NetworkPulse {
  edge: number;
  reverse: boolean;
  at: number;
  duration: number;
  sender: number;
}

export interface AgentNetwork {
  nodes: readonly NetworkNode[];
  edges: readonly NetworkEdge[];
  messages: readonly NetworkMessage[];
  pulses: readonly NetworkPulse[];
  end: number;
  growStart: number;
  zoomStart: number;
  storyEdges: number;
  salt: number;
  previous?: { network: AgentNetwork; root: { x: number; y: number }; at: number };
}

interface AgentNetworkAgent {
  label: string;
  avatar: number;
  mark: number;
}

export interface AgentNetworkGrowth {
  seed: number;
  avatarCount: number;
  markCount: number;
}

export interface AgentNetworkInput extends AgentNetworkGrowth {
  agents: readonly [AgentNetworkAgent, AgentNetworkAgent, AgentNetworkAgent];
  messages: readonly [string, string, string];
  hubLabel: string;
}

export interface NetworkAssets {
  avatars: readonly (CanvasImageSource | undefined)[];
  avatarColors: readonly string[];
  marks: readonly (CanvasImageSource | undefined)[];
  font: string;
  colors: {
    hub: string;
    hubEye: string;
    dot: string;
    badge: string;
    canvas: string;
    bubble: string;
    bubbleBorder: string;
    bubbleText: string;
    label: string;
    hubPulse: string;
  };
}

export interface NetworkView {
  width: number;
  height: number;
  top: number;
  narrow: boolean;
}

const NODE_POP = 0.38;
const EDGE_DRAW = 0.24;
const GROW_START = 5.3;
const GROW_DURATION = 4.4;
const ZOOM_START = 5.1;
const ZOOM_DURATION = 5;
const REGROW_START = 0.2;
const REGROW_DURATION = 2.8;
const PAN_DURATION = 0.7;
const LEAVE_DURATION = 0.45;

const AGENT_RADIUS = 34;
const GROWN_RADIUS = 28;
const LEAD_RADIUS = 46;
const TEAM_RADIUS = 18;
const HUB_SIDE = 78;
const DOT_SPACING = 15;
const DOT_RADIUS = 3;
const BADGE_MIN_RADIUS = 8;
const PULSE_TRAIL = 5;
const PULSE_SPEED = 420;
const WORLD_RX = 1700;
const WORLD_RY = 1000;
const MAX_GROWN = 320;
const RIPPLE_SPEED = 1500;
const BROADCAST_SPEED = 1100;
const ECHO_SPEED = 900;
const RIPPLE_WIDTH = 220;
const RIPPLE_END = Math.hypot(WORLD_RX, WORLD_RY);
const REACT_DURATION = 0.55;
const PRESS_DURATION = 0.35;
const STORY_WIDTH = 1080;
const NARROW_STORY_WIDTH = 800;
const STORY_HEIGHT = 600;
const STORY_CENTRE = { x: -20, y: -30 };

const AMBIENT_SLOT = 0.035;
const AMBIENT_MAX_DURATION = 0.7;

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(index: number): number {
  let value = Math.imul(index ^ 0x9e3779b9, 0x85ebca6b);
  value ^= value >>> 13;
  value = Math.imul(value, 0xc2b2ae35);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967296;
}

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const easeOutCubic = (value: number) => 1 - (1 - value) ** 3;
export const easeInOutCubic = (value: number) => (value < 0.5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2);
const easeOutBack = (value: number) => 1 + 2.2 * (value - 1) ** 3 + 1.2 * (value - 1) ** 2;

function nodeReach(node: NetworkNode): number {
  return node.avatar === HUB ? (HUB_SIDE / 2) * 1.15 : node.radius;
}

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = clamp01(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function makeEdge(nodes: readonly NetworkNode[], from: number, to: number, at: number): NetworkEdge {
  const a = nodes[from];
  const b = nodes[to];
  if (!a || !b) throw new Error("A network edge names a node that does not exist.");
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const ux = (b.x - a.x) / length;
  const uy = (b.y - a.y) / length;
  const start = nodeReach(a) + 9;
  const span = length - start - nodeReach(b) - 9;
  const count = Math.max(2, Math.floor(span / DOT_SPACING) + 1);
  const step = span / (count - 1);
  const dots = new Float32Array(count * 2);
  for (let index = 0; index < count; index += 1) {
    dots[index * 2] = a.x + ux * (start + step * index);
    dots[index * 2 + 1] = a.y + uy * (start + step * index);
  }
  return { from, to, at, dots, length };
}

export function buildAgentNetwork(input: AgentNetworkInput): AgentNetwork {
  const next = random(input.seed);
  const [first, second, third] = input.agents;
  const nodes: NetworkNode[] = [
    { x: 0, y: 0, at: 0.05, radius: HUB_SIDE / 2, avatar: HUB, mark: -1, label: input.hubLabel, busy: false, phase: 0 },
    { x: -310, y: 10, at: 0, radius: AGENT_RADIUS, ...first, busy: false, phase: 0 },
    { x: 255, y: -165, at: 1.62, radius: AGENT_RADIUS, ...second, busy: false, phase: 0 },
    { x: 255, y: 185, at: 3.12, radius: AGENT_RADIUS, ...third, busy: false, phase: 0 },
  ];
  const edges: NetworkEdge[] = [
    makeEdge(nodes, 1, 0, 0.18),
    makeEdge(nodes, 0, 2, 1.62 - EDGE_DRAW),
    makeEdge(nodes, 0, 3, 3.12 - EDGE_DRAW),
  ];
  const pulses: NetworkPulse[] = [
    { edge: 0, reverse: false, at: 0.95, duration: 0.62, sender: 1 },
    { edge: 1, reverse: false, at: 1.6, duration: 0.5, sender: 1 },
    { edge: 1, reverse: true, at: 2.75, duration: 0.5, sender: 2 },
    { edge: 2, reverse: false, at: 3.1, duration: 0.5, sender: 2 },
    { edge: 2, reverse: true, at: 4.3, duration: 0.5, sender: 3 },
    { edge: 0, reverse: true, at: 4.8, duration: 0.62, sender: 3 },
  ];
  const [firstText, secondText, thirdText] = input.messages;
  const messages: NetworkMessage[] = [
    { node: 1, text: firstText, at: 0.62, until: 5.25 },
    { node: 2, text: secondText, at: 2.5, until: 5.25 },
    { node: 3, text: thirdText, at: 4.0, until: 5.45 },
  ];

  growAround(nodes, edges, next, { ...input, growStart: GROW_START, growDuration: GROW_DURATION });
  return complete(
    { nodes, edges, messages, pulses, growStart: GROW_START, zoomStart: ZOOM_START, storyEdges: 3 },
    next,
  );
}

export function regrowAgentNetwork(
  network: AgentNetwork,
  root: number,
  at: number,
  input: AgentNetworkGrowth,
): AgentNetwork {
  const origin = network.nodes[root];
  if (!origin || origin.avatar === HUB) throw new Error("A network grows again only from an agent.");
  const next = random(input.seed);
  const nodes: NetworkNode[] = [
    { x: 0, y: 0, at: -1, radius: origin.radius, avatar: origin.avatar, mark: origin.mark, busy: false, phase: 0 },
  ];
  const edges: NetworkEdge[] = [];
  growAround(nodes, edges, next, { ...input, growStart: REGROW_START, growDuration: REGROW_DURATION });
  const { previous: _older, ...replaced } = network;
  return {
    ...complete(
      { nodes, edges, messages: [], pulses: [], growStart: REGROW_START, zoomStart: -ZOOM_DURATION, storyEdges: 0 },
      next,
    ),
    previous: { network: replaced, root: { x: origin.x, y: origin.y }, at },
  };
}

type NetworkParts = Omit<AgentNetwork, "end" | "salt" | "previous">;

function complete(parts: NetworkParts, next: () => number): AgentNetwork {
  return {
    ...parts,
    end: Math.max(parts.zoomStart + ZOOM_DURATION, (parts.edges.at(-1)?.at ?? 0) + EDGE_DRAW),
    salt: Math.floor(next() * 1_000_000) * 3,
  };
}

function growAround(
  nodes: NetworkNode[],
  edges: NetworkEdge[],
  next: () => number,
  options: AgentNetworkGrowth & { growStart: number; growDuration: number },
): void {
  const firstGrown = nodes.length;
  type Place = { x: number; y: number; parent: number };
  const grown: Place[] = [];
  const parentEdges: [number, number][] = edges.map((edge) => [edge.from, edge.to]);
  const isLead = (node: NetworkNode) => node.radius === LEAD_RADIUS;
  const sizeFor = (parent: NetworkNode) => {
    if (isLead(parent)) return TEAM_RADIUS;
    return next() < 0.12 ? LEAD_RADIUS : GROWN_RADIUS;
  };
  const isFree = (x: number, y: number, parent: number, radius: number) => {
    if ((x / WORLD_RX) ** 2 + (y / WORLD_RY) ** 2 > 1) return false;
    const origin = nodes[parent];
    if (!origin) return false;
    for (const [index, node] of nodes.entries()) {
      if (Math.hypot(node.x - x, node.y - y) < nodeReach(node) + radius + 46) return false;
      if (index !== parent && segmentDistance(node.x, node.y, origin.x, origin.y, x, y) < nodeReach(node) + 22) {
        return false;
      }
    }
    for (const [from, to] of parentEdges) {
      const a = nodes[from];
      const b = nodes[to];
      if (a && b && segmentDistance(x, y, a.x, a.y, b.x, b.y) < radius + 18) return false;
    }
    return true;
  };

  const queue: number[] = nodes.map((_, index) => index);
  const childCount = (parent: number) => {
    if (parent === 0) return 7;
    const node = nodes[parent];
    if (node && isLead(node)) return 4 + Math.floor(next() * 3);
    return 1 + Math.floor(next() * 3);
  };
  while (grown.length < MAX_GROWN) {
    let parent = queue.shift();
    if (parent === undefined) parent = Math.floor(next() * nodes.length);
    const origin = nodes[parent];
    if (!origin) break;
    const outward = parent === 0 ? next() * Math.PI * 2 : Math.atan2(origin.y, origin.x);
    let placed = 0;
    const wanted = childCount(parent);
    for (let attempt = 0; attempt < 12 && placed < wanted; attempt += 1) {
      const lead = isLead(origin);
      const spread = lead ? Math.PI * 2 : 2.3;
      const angle = parent === 0 ? outward + (attempt / 12) * Math.PI * 2 : outward + (next() - 0.5) * spread;
      const near = 128 + next() * 60;
      let radius = sizeFor(origin);
      const room = Math.max(0, origin.radius - GROWN_RADIUS) + (radius - GROWN_RADIUS);
      const distance = lead ? origin.radius + radius + 44 + next() * 16 : near + room;
      const x = origin.x + Math.cos(angle) * distance;
      const y = origin.y + Math.sin(angle) * distance;
      if (radius === LEAD_RADIUS && !isFree(x, y, parent, radius + 50)) radius = GROWN_RADIUS;
      if (!isFree(x, y, parent, radius)) continue;
      const index = nodes.length;
      nodes.push({
        x,
        y,
        at: 0,
        radius,
        avatar: Math.floor(next() * options.avatarCount),
        mark: Math.floor(next() * options.markCount),
        busy: next() < 0.16,
        phase: next() * Math.PI * 2,
      });
      grown.push({ x, y, parent });
      parentEdges.push([parent, index]);
      if (radius === LEAD_RADIUS) queue.unshift(index);
      else queue.push(index);
      placed += 1;
    }
    if (queue.length === 0 && grown.length > 0 && next() < 0.02) break;
  }

  for (const [order, place] of grown.entries()) {
    const node = nodes[firstGrown + order];
    const parent = nodes[place.parent];
    if (!node || !parent) continue;
    const scheduled = options.growStart + options.growDuration * ((order + 1) / grown.length) ** (1 / 2.3);
    node.at = Math.max(scheduled, parent.at + NODE_POP * 0.6 + EDGE_DRAW);
    edges.push(makeEdge(nodes, place.parent, firstGrown + order, node.at - EDGE_DRAW));
  }

  const linked = new Set(parentEdges.map(([a, b]) => (a < b ? `${a}:${b}` : `${b}:${a}`)));
  for (let index = firstGrown; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (!node || next() > 0.4) continue;
    let nearest = -1;
    let nearestDistance = 190;
    for (const [other, candidate] of nodes.entries()) {
      if (other === index || linked.has(other < index ? `${other}:${index}` : `${index}:${other}`)) continue;
      const distance = Math.hypot(candidate.x - node.x, candidate.y - node.y);
      if (distance >= nearestDistance) continue;
      const blocked = nodes.some(
        (third, thirdIndex) =>
          thirdIndex !== index &&
          thirdIndex !== other &&
          segmentDistance(third.x, third.y, node.x, node.y, candidate.x, candidate.y) < nodeReach(third) + 14,
      );
      if (!blocked) {
        nearest = other;
        nearestDistance = distance;
      }
    }
    const partner = nodes[nearest];
    if (!partner) continue;
    linked.add(nearest < index ? `${nearest}:${index}` : `${index}:${nearest}`);
    edges.push(makeEdge(nodes, index, nearest, Math.max(node.at, partner.at) + 0.12));
  }
  edges.sort((a, b) => a.at - b.at);
}

interface Camera {
  scale: number;
  x: number;
  y: number;
  start: number;
}

interface Pan {
  x: number;
  y: number;
}

const NO_PAN: Pan = { x: 0, y: 0 };

function panLeft(t: number): number {
  return 1 - easeInOutCubic(clamp01(t / PAN_DURATION));
}

function camera(view: NetworkView, network: AgentNetwork, t: number, pan: Pan): Camera {
  const storyWidth = view.narrow ? NARROW_STORY_WIDTH : STORY_WIDTH;
  const start = Math.min(1, view.width / storyWidth, (view.height - view.top) / STORY_HEIGHT);
  const fill = Math.max(view.width / (2 * WORLD_RX * 0.92), view.height / (2 * WORLD_RY * 0.92));
  const end = Math.min(start * 0.62, fill);
  const progress = easeInOutCubic(clamp01((t - network.zoomStart) / ZOOM_DURATION));
  const left = network.previous ? panLeft(t) : 0;
  const root = network.previous?.root ?? NO_PAN;
  return {
    scale: start + (end - start) * progress,
    x: STORY_CENTRE.x * (1 - progress) - root.x * left + pan.x,
    y: STORY_CENTRE.y * (1 - progress) - root.y * left + pan.y,
    start,
  };
}

function projector(view: NetworkView, network: AgentNetwork, t: number, pan: Pan) {
  const cam = camera(view, network, t, pan);
  return {
    cam,
    toX: (x: number) => (x - cam.x) * cam.scale + view.width / 2,
    toY: (y: number) => (y - cam.y) * cam.scale + view.top + (view.height - view.top) / 2,
  };
}

export function agentNetworkNodeAt(network: AgentNetwork, view: NetworkView, t: number, x: number, y: number): number {
  const { cam, toX, toY } = projector(view, network, t, NO_PAN);
  for (const [index, node] of network.nodes.entries()) {
    if (node.at > t || node.avatar === HUB) continue;
    const reach = Math.max(12, node.radius * cam.scale * 1.15);
    if (Math.hypot(toX(node.x) - x, toY(node.y) - y) <= reach) return index;
  }
  return -1;
}

export function agentNetworkNodePoint(
  network: AgentNetwork,
  view: NetworkView,
  t: number,
  index: number,
): { x: number; y: number; radius: number } | undefined {
  const node = network.nodes[index];
  if (!node) return undefined;
  const { cam, toX, toY } = projector(view, network, t, NO_PAN);
  return { x: toX(node.x), y: toY(node.y), radius: node.radius * cam.scale };
}

export function agentNetworkHubAt(network: AgentNetwork, view: NetworkView, t: number, x: number, y: number): boolean {
  const hub = network.nodes.find((node) => node.avatar === HUB);
  if (!hub || hub.at > t) return false;
  const { cam, toX, toY } = projector(view, network, t, NO_PAN);
  const reach = Math.max(16, (HUB_SIDE / 2) * cam.scale * 1.15);
  return Math.abs(toX(hub.x) - x) <= reach && Math.abs(toY(hub.y) - y) <= reach;
}

export const HUB_SIGNAL_STYLES = ["ripple", "broadcast", "echo"] as const;
export type HubSignalStyle = (typeof HUB_SIGNAL_STYLES)[number];

export const randomHubSignalStyle = (): HubSignalStyle =>
  HUB_SIGNAL_STYLES[Math.floor(Math.random() * HUB_SIGNAL_STYLES.length)] ?? "ripple";

export interface HubSignal {
  style: HubSignalStyle;
  at: number;
  reach: readonly number[];
  pulses: readonly NetworkPulse[];
  returns: readonly number[];
  end: number;
}

function signalPaths(network: AgentNetwork, hub: number, at: number) {
  const count = network.nodes.length;
  const distance: number[] = Array.from({ length: count }, () => Number.POSITIVE_INFINITY);
  const via: number[] = Array.from({ length: count }, () => -1);
  const links: [number, number][][] = Array.from({ length: count }, () => []);
  for (const [index, edge] of network.edges.entries()) {
    if (edge.at + EDGE_DRAW > at) continue;
    links[edge.from]?.push([edge.to, index]);
    links[edge.to]?.push([edge.from, index]);
  }
  distance[hub] = 0;
  const done = new Set<number>();
  for (;;) {
    let best = -1;
    for (let index = 0; index < count; index += 1) {
      const value = distance[index] ?? Number.POSITIVE_INFINITY;
      if (!done.has(index) && value < (distance[best] ?? Number.POSITIVE_INFINITY)) best = index;
    }
    if (best < 0) break;
    done.add(best);
    const base = distance[best] ?? 0;
    for (const [other, edgeIndex] of links[best] ?? []) {
      const length = network.edges[edgeIndex]?.length ?? 0;
      if (base + length < (distance[other] ?? Number.POSITIVE_INFINITY)) {
        distance[other] = base + length;
        via[other] = edgeIndex;
      }
    }
  }
  return { distance, via };
}

export function startHubSignal(network: AgentNetwork, style: HubSignalStyle, at: number): HubSignal | undefined {
  const hub = network.nodes.findIndex((node) => node.avatar === HUB);
  const origin = network.nodes[hub];
  if (!origin || origin.at > at) return undefined;
  const pulses: NetworkPulse[] = [];
  const returns: number[] = [];
  const spatial = (node: NetworkNode) =>
    node.at <= at ? Math.hypot(node.x - origin.x, node.y - origin.y) / RIPPLE_SPEED : -1;
  let reach: number[];
  if (style === "ripple") {
    reach = network.nodes.map(spatial);
  } else {
    const { distance, via } = signalPaths(network, hub, at);
    const parentOf = (node: number, edge: NetworkEdge) => (edge.from === node ? edge.to : edge.from);
    if (style === "broadcast") {
      reach = distance.map((value) => (Number.isFinite(value) ? value / BROADCAST_SPEED : -1));
      for (const [node, edgeIndex] of via.entries()) {
        const edge = network.edges[edgeIndex];
        if (!edge) continue;
        const parent = parentOf(node, edge);
        pulses.push({
          edge: edgeIndex,
          reverse: edge.to === parent,
          at: at + (distance[parent] ?? 0) / BROADCAST_SPEED,
          duration: edge.length / BROADCAST_SPEED,
          sender: hub,
        });
      }
    } else {
      reach = network.nodes.map(spatial);
      for (const [index, first] of via.entries()) {
        if (first < 0) continue;
        let time = at + (reach[index] ?? 0) + 0.12 + hash(index * 7 + 3) * 0.35;
        let node = index;
        let edgeIndex = first;
        for (let edge = network.edges[edgeIndex]; edge; edge = network.edges[edgeIndex]) {
          const duration = edge.length / ECHO_SPEED;
          pulses.push({ edge: edgeIndex, reverse: edge.to === node, at: time, duration, sender: index });
          time += duration;
          node = parentOf(node, edge);
          edgeIndex = via[node] ?? -1;
        }
        returns.push(time);
      }
    }
  }
  const last = Math.max(
    style === "broadcast" ? 0 : RIPPLE_END / RIPPLE_SPEED,
    ...reach.map((value) => value + REACT_DURATION),
  );
  const end = Math.max(
    at + last,
    ...pulses.map((pulse) => pulse.at + pulse.duration * 1.6),
    ...returns.map((value) => value + 0.4),
  );
  return { style, at, reach, pulses, returns, end };
}

const WORD_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "word" });

function wrapUnits(text: string): string[] {
  const units: string[] = [];
  for (const { segment, isWordLike } of WORD_SEGMENTER.segment(text)) {
    const last = units.length - 1;
    if (!isWordLike && !/\s/u.test(segment) && last >= 0) units[last] += segment;
    else units.push(segment);
  }
  return units;
}

function wrapText(context: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const segment of wrapUnits(text)) {
    const candidate = line + segment;
    if (line.trim() && context.measureText(candidate.trimEnd()).width > width) {
      lines.push(line.trimEnd());
      line = segment.trimStart();
    } else {
      line = candidate;
    }
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines;
}

function balancedLines(context: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines = wrapText(context, text, width);
  let low = width / 2;
  let high = width;
  while (high - low > 4) {
    const middle = (low + high) / 2;
    if (wrapText(context, text, middle).length > lines.length) low = middle;
    else high = middle;
  }
  return wrapText(context, text, high);
}

export function drawAgentNetwork(
  context: CanvasRenderingContext2D,
  network: AgentNetwork,
  assets: NetworkAssets,
  view: NetworkView,
  t: number,
  ambient: boolean,
  signals: readonly HubSignal[] = [],
): void {
  context.clearRect(0, 0, view.width, view.height);
  const previous = network.previous;
  if (previous && t < LEAVE_DURATION) {
    const moved = 1 - panLeft(t);
    const pan = { x: previous.root.x * moved, y: previous.root.y * moved };
    drawNetwork(context, previous.network, assets, view, previous.at + t, ambient, 1 - t / LEAVE_DURATION, pan, []);
  }
  drawNetwork(context, network, assets, view, t, ambient, 1, NO_PAN, signals);
}

function drawNetwork(
  context: CanvasRenderingContext2D,
  network: AgentNetwork,
  assets: NetworkAssets,
  view: NetworkView,
  t: number,
  ambient: boolean,
  opacity: number,
  pan: Pan,
  signals: readonly HubSignal[],
): void {
  const { width, height } = view;
  const { cam, toX, toY } = projector(view, network, t, pan);
  const margin = 40;
  const onScreen = (x: number, y: number, reach: number) =>
    x > -reach - margin && x < width + reach + margin && y > -reach - margin && y < height + reach + margin;
  const colorOf = (node: NetworkNode | undefined) =>
    !node || node.avatar === HUB
      ? assets.colors.hubPulse
      : (assets.avatarColors[node.avatar] ?? assets.colors.hubPulse);

  context.globalAlpha = opacity;
  const dotRadius = Math.max(0.9, DOT_RADIUS * cam.scale);

  context.fillStyle = assets.colors.dot;
  context.beginPath();
  for (const edge of network.edges) {
    if (edge.at > t) break;
    const count = edge.dots.length / 2;
    const shown = Math.ceil(count * easeOutCubic(clamp01((t - edge.at) / EDGE_DRAW)));
    for (let index = 0; index < shown; index += 1) {
      const x = toX(edge.dots[index * 2] ?? 0);
      const y = toY(edge.dots[index * 2 + 1] ?? 0);
      if (!onScreen(x, y, 0)) continue;
      context.moveTo(x + dotRadius, y);
      context.arc(x, y, dotRadius, 0, Math.PI * 2);
    }
  }
  context.fill();

  const hub = network.nodes.find((node) => node.avatar === HUB);
  for (const signal of signals) {
    if (!hub || signal.style === "broadcast") continue;
    const front = (t - signal.at) * RIPPLE_SPEED;
    const fade = 1 - front / RIPPLE_END;
    if (front <= 0 || fade <= 0) continue;
    context.strokeStyle = assets.colors.hubPulse;
    context.lineWidth = 1.5;
    context.globalAlpha = (signal.style === "echo" ? 0.4 : 0.2) * fade * opacity;
    context.beginPath();
    context.arc(toX(hub.x), toY(hub.y), front * cam.scale, 0, Math.PI * 2);
    context.stroke();
    if (signal.style !== "ripple") continue;
    context.fillStyle = assets.colors.hubPulse;
    for (const edge of network.edges) {
      if (edge.at > signal.at) break;
      for (let index = 0; index < edge.dots.length; index += 2) {
        const wx = edge.dots[index] ?? 0;
        const wy = edge.dots[index + 1] ?? 0;
        const behind = front - Math.hypot(wx - hub.x, wy - hub.y);
        if (behind < 0 || behind > RIPPLE_WIDTH) continue;
        const strength = (1 - behind / RIPPLE_WIDTH) * fade;
        const x = toX(wx);
        const y = toY(wy);
        if (!onScreen(x, y, 0)) continue;
        context.globalAlpha = strength * opacity;
        context.beginPath();
        context.arc(x, y, dotRadius * (1 + 0.7 * strength), 0, Math.PI * 2);
        context.fill();
      }
    }
  }
  context.globalAlpha = opacity;

  const drawPulse = (pulse: NetworkPulse) => {
    const edge = network.edges[pulse.edge];
    if (!edge) return;
    const progress = (t - pulse.at) / pulse.duration;
    if (progress < 0 || progress > 1 + PULSE_TRAIL / (edge.dots.length / 2)) return;
    const count = edge.dots.length / 2;
    const head = progress * (count - 1);
    const color = colorOf(network.nodes[pulse.sender]);
    for (let step = 0; step <= PULSE_TRAIL; step += 1) {
      const position = Math.floor(head) - step;
      if (position < 0 || position >= count) continue;
      const index = pulse.reverse ? count - 1 - position : position;
      const x = toX(edge.dots[index * 2] ?? 0);
      const y = toY(edge.dots[index * 2 + 1] ?? 0);
      const strength = 1 - (head - position) / (PULSE_TRAIL + 1);
      context.globalAlpha = clamp01(strength) * opacity;
      context.fillStyle = color;
      context.beginPath();
      context.arc(x, y, dotRadius * (1 + 0.55 * strength), 0, Math.PI * 2);
      context.fill();
      if (step === 0) {
        context.fillStyle = assets.colors.hubPulse;
        context.beginPath();
        context.arc(x, y, dotRadius * 0.7, 0, Math.PI * 2);
        context.fill();
      }
    }
    context.globalAlpha = opacity;
  };
  for (const pulse of network.pulses) drawPulse(pulse);
  for (const signal of signals) {
    for (const pulse of signal.pulses) {
      if (pulse.at <= t && pulse.at + pulse.duration * 1.6 >= t) drawPulse(pulse);
    }
  }
  if (ambient && t > network.growStart) {
    const last = Math.floor((t - network.growStart) / AMBIENT_SLOT);
    const firstSlot = Math.max(0, Math.floor((t - network.growStart - AMBIENT_MAX_DURATION) / AMBIENT_SLOT));
    for (let slot = firstSlot; slot <= last; slot += 1) {
      const at = network.growStart + slot * AMBIENT_SLOT;
      let visible = 0;
      while (visible < network.edges.length && (network.edges[visible]?.at ?? Infinity) + EDGE_DRAW < at) visible += 1;
      const story = network.storyEdges;
      if (visible <= story || hash(network.salt + slot * 3) > Math.min(0.85, visible / 260)) continue;
      const edgeIndex = story + Math.floor(hash(network.salt + slot * 3 + 1) * (visible - story));
      const edge = network.edges[edgeIndex];
      if (!edge) continue;
      const reverse = hash(network.salt + slot * 3 + 2) < 0.5;
      drawPulse({
        edge: edgeIndex,
        reverse,
        at,
        duration: Math.min(AMBIENT_MAX_DURATION * 0.75, edge.length / PULSE_SPEED),
        sender: reverse ? edge.to : edge.from,
      });
    }
  }

  context.textAlign = "center";
  context.textBaseline = "top";
  const labelAlpha = clamp01((cam.scale / cam.start - 0.78) / 0.14);
  for (const [nodeIndex, node] of network.nodes.entries()) {
    if (node.at > t) continue;
    const pop = clamp01((t - node.at) / NODE_POP);
    const x = toX(node.x);
    const y = toY(node.y);
    let react = -1;
    let bump = 0;
    for (const signal of signals) {
      const reach = signal.reach[nodeIndex] ?? -1;
      if (reach < 0) continue;
      const since = (t - signal.at - reach) / REACT_DURATION;
      if (since >= 0 && since < 1) {
        react = Math.max(react, since);
        bump = Math.max(bump, 0.22 * Math.sin(Math.PI * since));
      }
      if (node.avatar === HUB) {
        const press = (t - signal.at) / PRESS_DURATION;
        if (press >= 0 && press < 1) bump = Math.min(bump, -0.1 * Math.sin(Math.PI * press));
        let replies = 0;
        for (const back of signal.returns) {
          const since = (t - back) / 0.25;
          if (since >= 0 && since < 1) replies += Math.sin(Math.PI * since);
        }
        bump += Math.min(0.2, replies * 0.025);
      }
    }
    const radius = node.radius * cam.scale * easeOutBack(pop) * (1 + bump);
    if (radius <= 0 || !onScreen(x, y, radius * 2)) continue;
    context.globalAlpha = clamp01(pop * 2.5) * opacity;

    if (node.avatar === HUB) {
      const side = radius * 2;
      const unit = side / APP_LOGO_SIZE;
      context.fillStyle = assets.colors.hub;
      context.beginPath();
      context.roundRect(x - radius, y - radius, side, side, APP_LOGO_CORNER * unit);
      context.fill();
      context.strokeStyle = assets.colors.hubEye;
      context.lineWidth = 9.5 * unit;
      context.lineCap = "round";
      context.lineJoin = "round";
      for (const points of [APP_LOGO_EYE_POINTS.left, APP_LOGO_EYE_POINTS.right]) {
        const values = points.split(" ").map(Number);
        context.beginPath();
        for (let index = 0; index < values.length; index += 2) {
          const px = x - radius + (values[index] ?? 0) * unit;
          const py = y - radius + (values[index + 1] ?? 0) * unit;
          if (index === 0) context.moveTo(px, py);
          else context.lineTo(px, py);
        }
        context.stroke();
      }
    } else {
      const image = assets.avatars[node.avatar];
      if (image) {
        context.drawImage(image, x - radius, y - radius, radius * 2, radius * 2);
      } else {
        context.fillStyle = colorOf(node);
        context.beginPath();
        context.arc(x, y, radius * 0.8, 0, Math.PI * 2);
        context.fill();
      }
      const mark = assets.marks[node.mark];
      const badge = Math.max(radius * 0.42, Math.min(BADGE_MIN_RADIUS, radius * 0.75));
      if (mark && radius >= 4) {
        const bx = x + radius * 0.74;
        const by = y - radius * 0.74;
        context.fillStyle = assets.colors.canvas;
        context.beginPath();
        context.arc(bx, by, badge + Math.max(1.5, badge * 0.18), 0, Math.PI * 2);
        context.fill();
        context.fillStyle = assets.colors.badge;
        context.beginPath();
        context.arc(bx, by, badge, 0, Math.PI * 2);
        context.fill();
        const size = badge * 1.3;
        context.drawImage(mark, bx - size / 2, by - size / 2, size, size);
      }
      if (node.busy && radius >= 7) {
        const typing = Math.sin(t * 0.9 + node.phase);
        if (typing > 0.25) {
          const pillHeight = Math.max(radius * 0.42, Math.min(BADGE_MIN_RADIUS * 1.2, radius * 0.8));
          const pillWidth = pillHeight * 2.3;
          const px = x - radius * 0.55 - pillWidth;
          const py = y - radius * 0.8 - pillHeight / 2;
          context.globalAlpha = clamp01(pop * 2.5) * clamp01((typing - 0.25) * 5) * opacity;
          context.fillStyle = assets.colors.badge;
          context.beginPath();
          context.roundRect(px, py, pillWidth, pillHeight, pillHeight / 2);
          context.fill();
          context.fillStyle = assets.colors.bubbleText;
          for (let dot = 0; dot < 3; dot += 1) {
            const lift = Math.max(0, Math.sin(t * 7 - dot * 0.9 + node.phase)) * pillHeight * 0.12;
            context.beginPath();
            context.arc(
              px + pillWidth * (0.28 + dot * 0.22),
              py + pillHeight / 2 - lift,
              pillHeight * 0.12,
              0,
              Math.PI * 2,
            );
            context.fill();
          }
        }
      }
    }

    if (react >= 0) {
      const halo = radius * (1.15 + 0.8 * easeOutCubic(react));
      context.globalAlpha = (1 - react) * 0.7 * opacity;
      context.strokeStyle = colorOf(node);
      context.lineWidth = Math.max(1, 2.5 * cam.scale);
      context.beginPath();
      if (node.avatar === HUB) {
        context.roundRect(x - halo, y - halo, halo * 2, halo * 2, (APP_LOGO_CORNER / APP_LOGO_SIZE) * halo * 2);
      } else {
        context.arc(x, y, halo, 0, Math.PI * 2);
      }
      context.stroke();
      context.globalAlpha = opacity;
    }

    if (node.label && labelAlpha > 0) {
      context.globalAlpha = clamp01(pop * 2.5) * labelAlpha * opacity;
      context.fillStyle = assets.colors.label;
      context.font = `500 13px ${assets.font}`;
      context.fillText(node.label, x, y + radius + 9);
    }
    context.globalAlpha = opacity;
  }

  context.textAlign = "left";
  context.font = `400 14px ${assets.font}`;
  const lineHeight = 20;
  for (const [order, message] of network.messages.entries()) {
    const following = network.messages[order + 1];
    const until = view.narrow && following ? Math.min(message.until, following.at) : message.until;
    const appear = clamp01((t - message.at) / 0.3);
    const leave = clamp01((t - until) / 0.25);
    const alpha = easeOutCubic(appear) * (1 - leave);
    const node = network.nodes[message.node];
    if (alpha <= 0 || !node) continue;
    const lines = balancedLines(context, message.text, Math.min(320, width - 32) - 28);
    const textWidth = Math.max(...lines.map((line) => context.measureText(line).width));
    const boxWidth = textWidth + 28;
    const boxHeight = lines.length * lineHeight + 18;
    const anchorX = toX(node.x);
    const left = Math.min(width - 16 - boxWidth, Math.max(16, anchorX - boxWidth / 2));
    const below = view.narrow && node.y > 0;
    const reach = node.radius * cam.scale;
    const top =
      (below ? toY(node.y) + reach + 34 : toY(node.y) - reach - 12 - boxHeight) +
      (1 - easeOutCubic(appear)) * (below ? -8 : 8);
    context.globalAlpha = alpha * opacity;
    context.fillStyle = assets.colors.bubble;
    context.strokeStyle = assets.colors.bubbleBorder;
    context.lineWidth = 1;
    context.beginPath();
    context.roundRect(left, top, boxWidth, boxHeight, 12);
    context.fill();
    context.stroke();
    context.fillStyle = assets.colors.bubbleText;
    for (const [index, line] of lines.entries()) {
      context.fillText(line, left + 14, top + 10 + index * lineHeight);
    }
    context.globalAlpha = opacity;
  }
  context.globalAlpha = 1;
}
