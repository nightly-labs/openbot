import { BotEngine, EXPRESSION_BY_ID, SHAPE_BY_ID } from "@norbert_bodziony/bloub";
import { bloubAvatarProfile } from "@openbot/brand/bloub-avatar";
import { type AvatarMood, avatarMoodPresentation } from "@openbot/brand/bloub-avatar-motion";
import { BlendMode, type SkCanvas, Skia } from "@shopify/react-native-skia";
import { saturationMatrix } from "./plush-draw";
import { type Matrix, matrixOf, PLUSH_BODY_SCALE, VIEW_BOX } from "./plush-felt";

/**
 * The flat face of a seed: the Bloub that agents had before the plush, as the desktop draws a seed of
 * the flat style. The mood only chooses the eyes, as on the desktop; the shape stays.
 */
export function flatGeometryKey(seed: string, mood: AvatarMood = "idle"): string {
  const profile = bloubAvatarProfile(seed, null);
  return `flat:${profile.shape}:${avatarMoodPresentation(mood).expression ?? profile.expression}`;
}

/** A still flat face, in the units of the bloub viewBox. */
interface FlatFrame {
  body: string;
  bodyAlpha: number;
  eyes: { d: string; alpha: number; matrix: Matrix }[];
}

const MAX_CACHED_FRAMES = 128;
/** A long list mounts many avatars with few distinct faces, so each face is sampled once. */
const frames = new Map<string, FlatFrame>();

export function flatRestFrame(seed: string, mood: AvatarMood = "idle"): FlatFrame {
  const key = flatGeometryKey(seed, mood);
  const cached = frames.get(key);
  if (cached) return cached;
  const profile = bloubAvatarProfile(seed, null);
  const silhouette = SHAPE_BY_ID.get(profile.shape);
  const expression = EXPRESSION_BY_ID.get(avatarMoodPresentation(mood).expression ?? profile.expression);
  if (!silhouette || !expression) throw new Error("The flat avatar face is unknown.");
  const sample = new BotEngine(100, "idle", silhouette.radii, expression).sample(0);
  const frame = {
    body: sample.bodyPath,
    bodyAlpha: sample.bodyAlpha,
    eyes: sample.eyes.map((eye) => ({ d: eye.d, alpha: eye.alpha, matrix: matrixOf(eye.matrix) })),
  };
  const oldest = frames.keys().next().value;
  if (frames.size >= MAX_CACHED_FRAMES && oldest !== undefined) frames.delete(oldest);
  frames.set(key, frame);
  return frame;
}

/**
 * Draws a flat face in a square of `size` pixels. The square is the box of a plush picture, which
 * reaches past the avatar by `PLUSH_BODY_SCALE`; the flat body fills the avatar box, as on the
 * desktop. The eyes are holes in the body, as the desktop mask cuts them.
 */
export function drawFlat(canvas: SkCanvas, frame: FlatFrame, color: string, size: number, saturation = 1) {
  const scale = size / (VIEW_BOX * PLUSH_BODY_SCALE);
  canvas.save();
  canvas.translate(size / 2, size / 2);
  canvas.scale(scale, scale);
  const layer = Skia.Paint();
  if (saturation < 1) layer.setColorFilter(Skia.ColorFilter.MakeMatrix(saturationMatrix(saturation)));
  canvas.saveLayer(layer);
  const body = Skia.Path.MakeFromSVGString(frame.body);
  if (body) {
    const paint = Skia.Paint();
    paint.setAntiAlias(true);
    paint.setColor(Skia.Color(color));
    paint.setAlphaf(frame.bodyAlpha);
    canvas.drawPath(body, paint);
  }
  const hole = Skia.Paint();
  hole.setAntiAlias(true);
  hole.setBlendMode(BlendMode.DstOut);
  for (const eye of frame.eyes) {
    const path = Skia.Path.MakeFromSVGString(eye.d);
    if (!path || eye.alpha <= 0.001) continue;
    const [a, b, c, d, e, f] = eye.matrix;
    hole.setAlphaf(eye.alpha);
    canvas.save();
    canvas.concat(Skia.Matrix([a, c, e, b, d, f, 0, 0, 1]));
    canvas.drawPath(path, hole);
    canvas.restore();
  }
  canvas.restore();
  canvas.restore();
}
