import { BotEngine } from "@norbert_bodziony/bloub";
import { makeMutable } from "react-native-reanimated";

const ORBIT_FPS = 30;
export const ORBIT_CYCLE = 3.6;
const ORBIT_START = 1.2;
const FRAME_TOTAL = Math.round(ORBIT_CYCLE * ORBIT_FPS);
const BATCH = 6;

export interface OrbitRing {
  id: string;
  width: number;
  gradient: { x1: number; y1: number; x2: number; y2: number; stops: string[] };
}

export interface OrbitArc {
  front: string;
  back: string;
  opacity: number;
}

const NO_ARC: OrbitArc = { front: "", back: "", opacity: 0 };

let rings: OrbitRing[] | null = null;

export function orbitRings(): OrbitRing[] {
  rings ??= new BotEngine(100, "orbit")
    .sample(ORBIT_START)
    .arcs.map((arc) => ({ id: arc.id, width: arc.width, gradient: arc.grad }));
  return rings;
}

export const orbitFrames = makeMutable<OrbitArc[][]>([]);

let preparing = false;

export function prepareOrbitFrames(): void {
  if (preparing) return;
  preparing = true;
  const ids = orbitRings().map((ring) => ring.id);
  const engine = new BotEngine(100, "orbit");
  const frames: OrbitArc[][] = [];
  const batch = () => {
    for (let count = 0; count < BATCH && frames.length < FRAME_TOTAL; count += 1) {
      const arcs = engine.sample(frames.length / ORBIT_FPS).arcs;
      frames.push(
        ids.map((id) => {
          const arc = arcs.find((candidate) => candidate.id === id);
          return arc ? { front: arc.front, back: arc.back, opacity: arc.opacity } : NO_ARC;
        }),
      );
    }
    if (frames.length < FRAME_TOTAL) requestIdleCallback(batch);
    else orbitFrames.set(frames);
  };
  requestIdleCallback(batch);
}

export function orbitFrameIndex(clock: number, count: number): number {
  "worklet";
  return Math.floor(((clock + ORBIT_START) % ORBIT_CYCLE) * ORBIT_FPS) % count;
}
