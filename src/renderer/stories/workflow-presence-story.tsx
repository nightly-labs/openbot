/**
 * The presence feed of the workflow stories: a timer moves the other people on the canvas, as the
 * feed of a team server would. Each person moves from node to node on a slight curve, as a hand moves
 * a mouse, stops on a node for a moment and often selects it.
 */

import type { WfnPoint } from "@openbot/ui/features/workflows/workflow-board";
import {
  peersOf,
  WORKFLOW_PRESENCE_FEED_INTERVAL,
  type WorkflowPeerSpot,
  type WorkflowPresence,
} from "@openbot/ui/features/workflows/workflow-presence";
import { createStore, onCleanup } from "solid-js";
import { STORY_PRESENCE } from "../src/preview/fixtures";

interface Target {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A repeatable random sequence, so each story opens with the same movement. */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

interface Walk {
  id: string;
  next: () => number;
  from: WfnPoint;
  bend: WfnPoint;
  to: WfnPoint;
  /** The node that the person moves to, if any. */
  node: string | undefined;
  /** The selection that the person makes when the move ends. */
  select: string | undefined;
  start: number;
  duration: number;
  /** When the person moves again. */
  rest: number;
}

/** The nodes on the canvas, in world pixels, from their slots. */
function canvasTargets(): Target[] {
  return [...document.querySelectorAll<HTMLElement>(".wfn-slot[data-slot]")].map((slot) => ({
    id: slot.dataset.slot ?? "",
    x: Number.parseFloat(slot.style.left) || 0,
    y: Number.parseFloat(slot.style.top) || 0,
    width: slot.offsetWidth,
    height: slot.offsetHeight,
  }));
}

/** The people of the team fixtures, as the member `member-self` sees them, moved by a timer. */
export function createStoryPresence(): WorkflowPresence {
  const self = "member-self";
  const members = STORY_PRESENCE.members;
  const peers = peersOf({ self, members });
  const [spots, setSpots] = createStore<Record<string, WorkflowPeerSpot>>({});
  const walks = peers.map(
    (peer, index): Walk => ({
      id: peer.member.id,
      next: random(index + 7),
      from: { x: 0, y: 0 },
      bend: { x: 0, y: 0 },
      to: { x: 0, y: 0 },
      node: undefined,
      select: undefined,
      start: 0,
      duration: 0,
      rest: 0,
    }),
  );

  /** Starts the next move. Without `from`, the person appears at the end of the move. */
  const plan = (walk: Walk, nodes: readonly Target[], now: number, from: WfnPoint | undefined) => {
    const others = nodes.filter((node) => node.id !== walk.node);
    const node = others[Math.floor(walk.next() * others.length)] ?? nodes[0];
    if (!node) return false;
    const onNode = walk.next() < 0.8;
    const to = onNode
      ? { x: node.x + node.width * (0.25 + walk.next() * 0.5), y: node.y + node.height * (0.2 + walk.next() * 0.5) }
      : { x: node.x + node.width + 40 + walk.next() * 80, y: node.y + node.height * walk.next() };
    const start = from ?? to;
    const dx = to.x - start.x;
    const dy = to.y - start.y;
    const bend = (walk.next() - 0.5) * 0.5;
    walk.from = start;
    walk.to = to;
    walk.bend = { x: (start.x + to.x) / 2 - dy * bend, y: (start.y + to.y) / 2 + dx * bend };
    walk.node = onNode ? node.id : undefined;
    walk.select = onNode && walk.next() < 0.75 ? node.id : undefined;
    walk.start = now;
    walk.duration = from ? Math.min(2200, 450 + Math.hypot(dx, dy) * 1.2) : 0;
    walk.rest = now + walk.duration + 700 + walk.next() * 1900;
    return true;
  };

  const feed = () => {
    const now = performance.now();
    const nodes = canvasTargets();
    const ids = new Set(nodes.map((node) => node.id));
    setSpots((draft) => {
      for (const walk of walks) {
        const spot = draft[walk.id];
        if (!spot) {
          // The people start at different times, so they do not move together.
          if (plan(walk, nodes, now - walk.next() * 1500, undefined))
            draft[walk.id] = { at: walk.to, selected: undefined };
          continue;
        }
        if (now >= walk.rest) plan(walk, nodes, now, spot.at);
        const t = walk.duration ? easeInOut(Math.min(1, (now - walk.start) / walk.duration)) : 1;
        const u = 1 - t;
        const x = u * u * walk.from.x + 2 * u * t * walk.bend.x + t * t * walk.to.x;
        const y = u * u * walk.from.y + 2 * u * t * walk.bend.y + t * t * walk.to.y;
        if (x !== spot.at.x || y !== spot.at.y) spot.at = { x, y };
        const chosen = t === 1 ? walk.select : spot.selected;
        const selected = chosen && ids.has(chosen) ? chosen : undefined;
        if (selected !== spot.selected) spot.selected = selected;
      }
    });
  };

  const timer = setInterval(feed, WORKFLOW_PRESENCE_FEED_INTERVAL);
  onCleanup(() => clearInterval(timer));
  return { self, members, spots };
}
