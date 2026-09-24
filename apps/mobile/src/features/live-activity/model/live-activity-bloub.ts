import { BotEngine } from "@norbert_bodziony/bloub";
import { type AvatarMood, avatarMoodPresentation } from "@openbot/brand/bloub-avatar-motion";
import type { AvatarHue } from "@openbot/contracts/ipc";
import { ImageFormat, Skia } from "@shopify/react-native-skia";
import { bloubActivityGeometry, getBloubAvatarColor } from "@/features/agents/model/bloub-activity";

const AVATAR_PAPER = "#f9f9f9";
/** The bloub view box is 316 units wide, centered on the origin. */
const VIEW_BOX = 316;

/**
 * Draws the agent bloub, with the face of `mood`, as a PNG data URL. The widget extension cannot
 * run the app's SVG views, so the app draws the picture once and the activity shows the file.
 */
export function renderBloubAvatar(seed: string, hue: AvatarHue | null, mood: AvatarMood, size: number): string | null {
  const surface = Skia.Surface.Make(size, size);
  if (!surface) return null;
  const geometry = bloubActivityGeometry(seed, mood);
  const frame = new BotEngine(100, avatarMoodPresentation(mood).state, geometry.radii, geometry.expression).sample(0);
  const color = getBloubAvatarColor(seed, hue);
  const canvas = surface.getCanvas();
  canvas.scale(size / VIEW_BOX, size / VIEW_BOX);
  canvas.translate(VIEW_BOX / 2, VIEW_BOX / 2);
  const fill = (hex: string, alpha: number) => {
    const paint = Skia.Paint();
    paint.setAntiAlias(true);
    paint.setColor(Skia.Color(hex));
    paint.setAlphaf(alpha);
    return paint;
  };
  const body = Skia.Path.MakeFromSVGString(frame.bodyPath);
  if (body) canvas.drawPath(body, fill(color, frame.bodyAlpha));
  for (const eye of frame.eyes) {
    const path = Skia.Path.MakeFromSVGString(eye.d);
    const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = eye.matrix.slice(7, -1).split(",").map(Number);
    if (path) canvas.drawPath(path.transform([a, c, e, b, d, f, 0, 0, 1]), fill(AVATAR_PAPER, eye.alpha));
  }
  for (const dot of frame.dots) canvas.drawCircle(dot.x, dot.y, dot.r, fill(color, dot.opacity));
  surface.flush();
  return `data:image/png;base64,${surface.makeImageSnapshot().encodeToBase64(ImageFormat.PNG)}`;
}
