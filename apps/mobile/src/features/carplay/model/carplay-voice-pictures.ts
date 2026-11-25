import { avatarHeadColor, avatarStyleForSeed } from "@openbot/brand/bloub-avatar";
import type { AvatarMood } from "@openbot/brand/bloub-avatar-motion";
import { ClipOp, ImageFormat, type SkCanvas, Skia } from "@shopify/react-native-skia";
import { Directory, File, Paths } from "expo-file-system";
import { drawFlat, flatRestFrame } from "@/features/agents/model/plush/flat-draw";
import { loadPlushArt } from "@/features/agents/model/plush/plush-assets";
import { drawPlush } from "@/features/agents/model/plush/plush-draw";
import { type PlushSequence, plushGeometry, preparePlushLoop } from "@/features/agents/model/plush/plush-frames";
import { nameHash, PLUSH_STYLE } from "@/features/agents/model/plush/plush-picture";
import { supportLog, supportLogValue } from "@/features/support/model/support-log";
import { savedAgentAvatar } from "@/features/workspace/model/agent-avatar-cache";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import type { CarPlayVoiceFrames, CarPlayVoiceState } from "../carplay-native";
import { carPlayAgentKey } from "./carplay-home";
import { carPlayPicturePaths } from "./carplay-pictures";

const FOLDER = "carplay-voice";
const PIXELS = 256;
const FRAME_STEP = 6;
const AVATAR_ZOOM = 1.3;
const DONE_FILE = "frames.json";

const STATE_MOOD: Readonly<Record<CarPlayVoiceState, AvatarMood>> = {
  listening: "idle",
  muted: "idle",
  thinking: "working",
  speaking: "responded",
  offline: "asleep",
  unavailable: "failed",
};

const ANIMATED: ReadonlySet<CarPlayVoiceState> = new Set(["listening", "thinking", "speaking"]);
const STATES: readonly CarPlayVoiceState[] = ["listening", "muted", "thinking", "speaking", "offline", "unavailable"];

type VoiceAgent = Pick<MobileAgent, "serverId" | "id" | "avatarUrl" | "avatarSeed" | "avatarHue" | "avatarColor">;

const NO_FRAMES: CarPlayVoiceFrames = {
  listening: [],
  muted: [],
  thinking: [],
  speaking: [],
  offline: [],
  unavailable: [],
};
const preparing = new Map<string, Promise<readonly string[]>>();
let generation = 0;

class FramesStopped extends Error {}

function voiceFolder(): Directory {
  return new Directory(Paths.cache, FOLDER);
}

const nextTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function soon(callback: () => void): () => void {
  const timer = setTimeout(callback, 0);
  return () => clearTimeout(timer);
}

function encode(draw: (canvas: SkCanvas) => void): Uint8Array {
  const surface = Skia.Surface.Make(PIXELS, PIXELS);
  if (!surface) throw new Error("The CarPlay picture surface is unavailable.");
  draw(surface.getCanvas());
  surface.flush();
  return surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG);
}

function encodeAvatar(draw: (canvas: SkCanvas) => void): Uint8Array {
  return encode((canvas) => {
    const middle = PIXELS / 2;
    canvas.translate(middle, middle);
    canvas.scale(AVATAR_ZOOM, AVATAR_ZOOM);
    canvas.translate(-middle, -middle);
    draw(canvas);
  });
}

function plushLoop(seed: string, mood: AvatarMood): Promise<PlushSequence> {
  return new Promise((resolve) => preparePlushLoop(plushGeometry(seed, mood), resolve, soon));
}

async function* avatarFrames(agent: VoiceAgent, state: CarPlayVoiceState): AsyncGenerator<Uint8Array> {
  const mood = STATE_MOOD[state];
  const color = avatarHeadColor(agent.avatarSeed, agent.avatarHue, agent.avatarColor);
  if (avatarStyleForSeed(agent.avatarSeed) === "flat") {
    yield encodeAvatar((canvas) => drawFlat(canvas, flatRestFrame(agent.avatarSeed, mood), color, PIXELS, 1));
    return;
  }
  const geometry = plushGeometry(agent.avatarSeed, mood);
  const [sequence, art] = await Promise.all([
    plushLoop(agent.avatarSeed, mood),
    loadPlushArt(geometry.shape, color, PIXELS),
  ]);
  const frames = ANIMATED.has(state)
    ? sequence.frames.filter((_, index) => index % FRAME_STEP === 0)
    : sequence.frames.slice(0, 1);
  for (const frame of frames) {
    await nextTurn();
    yield encodeAvatar((canvas) => drawPlush(canvas, frame, art, PIXELS, 1));
  }
}

function photoFrame(uri: string): Uint8Array | null {
  const data = Skia.Data.fromBytes(new File(uri).bytesSync());
  const image = Skia.Image.MakeImageFromEncoded(data);
  if (!image) return null;
  const side = Math.min(image.width(), image.height());
  const source = Skia.XYWHRect((image.width() - side) / 2, (image.height() - side) / 2, side, side);
  return encode((canvas) => {
    canvas.clipRRect(Skia.RRectXY(Skia.XYWHRect(0, 0, PIXELS, PIXELS), PIXELS / 2, PIXELS / 2), ClipOp.Intersect, true);
    canvas.drawImageRect(image, source, Skia.XYWHRect(0, 0, PIXELS, PIXELS), Skia.Paint());
  });
}

function framesKey(agent: VoiceAgent, state: CarPlayVoiceState, photo: string | null): string {
  const look = photo ?? `${agent.avatarSeed}|${agent.avatarHue ?? ""}|${agent.avatarColor ?? ""}|${state}`;
  return nameHash(`${PLUSH_STYLE}|${look}|${PIXELS}|${FRAME_STEP}|${photo ? 1 : AVATAR_ZOOM}`);
}

function savedFrames(folder: Directory): string[] | null {
  const done = new File(folder, DONE_FILE);
  if (!done.exists) return null;
  const count = Number(done.textSync());
  if (!Number.isInteger(count) || count < 1) return null;
  const files = Array.from({ length: count }, (_, index) => new File(folder, `${index}.png`));
  return files.every((file) => file.exists) ? files.map((file) => file.uri) : null;
}

async function writeFrames(folder: Directory, frames: AsyncIterable<Uint8Array>, started: number): Promise<string[]> {
  if (folder.exists) folder.delete();
  folder.create({ intermediates: true, idempotent: true });
  const uris: string[] = [];
  for await (const frame of frames) {
    if (generation !== started) throw new FramesStopped();
    const file = new File(folder, `${uris.length}.png`);
    file.writeSync(frame);
    uris.push(file.uri);
  }
  if (generation !== started) throw new FramesStopped();
  new File(folder, DONE_FILE).writeSync(String(uris.length));
  return uris;
}

async function* single(frame: Uint8Array | null): AsyncGenerator<Uint8Array> {
  if (frame) yield frame;
}

function stateFrames(agent: VoiceAgent, state: CarPlayVoiceState, photo: string | null): Promise<readonly string[]> {
  const folder = new Directory(voiceFolder(), nameHash(agent.serverId), framesKey(agent, state, photo));
  const current = preparing.get(folder.uri);
  if (current) return current;
  const saved = savedFrames(folder);
  if (saved) return Promise.resolve(saved);
  const frames = photo ? single(photoFrame(photo)) : avatarFrames(agent, state);
  const work = writeFrames(folder, frames, generation).finally(() => preparing.delete(folder.uri));
  preparing.set(folder.uri, work);
  return work;
}

export async function carPlayVoiceFrames(agent: VoiceAgent): Promise<CarPlayVoiceFrames> {
  const photo = agent.avatarUrl ? savedAgentAvatar(agent.serverId, agent.id, agent.avatarUrl) : null;
  try {
    const frames = { ...NO_FRAMES };
    for (const state of STATES) frames[state] = [...(await stateFrames(agent, state, photo))];
    return frames;
  } catch (error) {
    if (!(error instanceof FramesStopped)) {
      supportLog.add("warn", "app", `CarPlay voice pictures not saved: ${supportLogValue(error)}`);
    }
    return NO_FRAMES;
  }
}

export function carPlayVoicePlaceholder(agent: VoiceAgent): CarPlayVoiceFrames {
  const uri = carPlayPicturePaths([agent]).get(carPlayAgentKey(agent));
  const files = uri && new File(uri).exists ? [uri] : [];
  return { listening: files, muted: files, thinking: files, speaking: files, offline: files, unavailable: files };
}

export async function prepareCarPlayVoiceFrames(agents: readonly VoiceAgent[], wanted: () => boolean): Promise<void> {
  const started = generation;
  for (const agent of agents) {
    if (!wanted() || generation !== started) return;
    await carPlayVoiceFrames(agent);
  }
}

export function deleteServerCarPlayVoiceFrames(serverId: string): void {
  generation += 1;
  preparing.clear();
  try {
    const folder = new Directory(voiceFolder(), nameHash(serverId));
    if (folder.exists) folder.delete();
  } catch (error) {
    supportLog.add("warn", "app", `CarPlay voice pictures not removed: ${supportLogValue(error)}`);
  }
}

export function resetCarPlayVoiceFrames(): void {
  generation += 1;
  preparing.clear();
  try {
    const folder = voiceFolder();
    if (folder.exists) folder.delete();
  } catch (error) {
    supportLog.add("warn", "app", `CarPlay voice pictures not removed: ${supportLogValue(error)}`);
  }
}
