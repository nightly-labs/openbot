import {
  BlendMode,
  FilterMode,
  MipmapMode,
  PaintStyle,
  type SkCanvas,
  type SkHostRect,
  type SkImage,
  Skia,
  type SkPaint,
  type SkPathBuilder,
  type SkPicture,
  type SkPictureRecorder,
  StrokeCap,
  StrokeJoin,
} from "@shopify/react-native-skia";
import {
  CLOSED_EYE_BEND,
  CLOSED_EYE_COLOR,
  CLOSED_EYE_STROKE,
  HALF_VIEW_BOX,
  type Matrix,
  type PlushEye,
  VIEW_BOX,
} from "./plush-felt";
import type { PlushFrame } from "./plush-frames";

export interface PlushArt {
  body: SkImage;
  padX: SkImage;
  padY: SkImage;
  dot: SkImage;
  notif: SkImage;
  ink: string;
}

interface PlushDrawKit {
  plain: SkPaint;
  alpha: SkPaint;
  plus: SkPaint;
  mask: SkPaint;
  band: SkPaint;
  line: SkPaint;
  stroke: SkPaint;
  strokeInk: string | null;
  grey: SkPaint;
  greySaturation: number | null;
  source: SkHostRect;
  target: SkHostRect;
  bandRect: { rect: SkHostRect; rx: number; ry: number };
  matrix: number[];
  path: SkPathBuilder;
  recorder: SkPictureRecorder;
  bounds: SkHostRect;
}

declare global {
  var openbotPlushDrawKit: PlushDrawKit | undefined;
}

function makeDrawKit(): PlushDrawKit {
  "worklet";
  const plus = Skia.Paint();
  plus.setBlendMode(BlendMode.Plus);
  const mask = Skia.Paint();
  mask.setBlendMode(BlendMode.DstIn);
  const band = Skia.Paint();
  band.setAntiAlias(true);
  band.setColor(Skia.Color("white"));
  const line = Skia.Paint();
  line.setAntiAlias(true);
  line.setStyle(PaintStyle.Stroke);
  line.setStrokeCap(StrokeCap.Round);
  line.setColor(Skia.Color(CLOSED_EYE_COLOR));
  const stroke = Skia.Paint();
  stroke.setAntiAlias(true);
  stroke.setStyle(PaintStyle.Stroke);
  stroke.setStrokeCap(StrokeCap.Round);
  stroke.setStrokeJoin(StrokeJoin.Round);
  return {
    plain: Skia.Paint(),
    alpha: Skia.Paint(),
    plus,
    mask,
    band,
    line,
    stroke,
    strokeInk: null,
    grey: Skia.Paint(),
    greySaturation: null,
    source: Skia.XYWHRect(0, 0, 0, 0),
    target: Skia.XYWHRect(0, 0, 0, 0),
    bandRect: { rect: Skia.XYWHRect(0, 0, 0, 0), rx: 0, ry: 0 },
    matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    path: Skia.PathBuilder.Make(),
    recorder: Skia.PictureRecorder(),
    bounds: Skia.XYWHRect(0, 0, 0, 0),
  };
}

function drawKit(): PlushDrawKit {
  "worklet";
  let kit = globalThis.openbotPlushDrawKit;
  if (!kit) {
    kit = makeDrawKit();
    globalThis.openbotPlushDrawKit = kit;
  }
  return kit;
}

function concat(canvas: SkCanvas, kit: PlushDrawKit, [a, b, c, d, e, f]: Matrix) {
  "worklet";
  const values = kit.matrix;
  values[0] = a;
  values[1] = c;
  values[2] = e;
  values[3] = b;
  values[4] = d;
  values[5] = f;
  canvas.concat(values);
}

function alphaPaint(kit: PlushDrawKit, opacity: number): SkPaint {
  "worklet";
  kit.alpha.setAlphaf(opacity);
  return kit.alpha;
}

function drawPicture(
  canvas: SkCanvas,
  kit: PlushDrawKit,
  image: SkImage,
  x: number,
  y: number,
  width: number,
  height: number,
  paint: SkPaint,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
) {
  "worklet";
  const imageWidth = image.width();
  const imageHeight = image.height();
  kit.source.setXYWH(sx * imageWidth, sy * imageHeight, sw * imageWidth, sh * imageHeight);
  kit.target.setXYWH(x, y, width, height);
  canvas.drawImageRectOptions(image, kit.source, kit.target, FilterMode.Linear, MipmapMode.Linear, paint);
}

function drawEye(canvas: SkCanvas, kit: PlushDrawKit, eye: PlushEye, art: PlushArt) {
  "worklet";
  const opacity = eye.alpha * eye.pad;
  if (opacity > 0.001) {
    if (eye.lid) canvas.saveLayer();
    canvas.save();
    concat(canvas, kit, eye.matrix);
    if (eye.inner) concat(canvas, kit, eye.inner);
    canvas.saveLayer(alphaPaint(kit, opacity));
    const piecePaint = eye.pieces.length > 1 ? kit.plus : kit.plain;
    for (const piece of eye.pieces) {
      const image = piece.src === 0 ? art.padX : art.padY;
      drawPicture(
        canvas,
        kit,
        image,
        piece.x,
        piece.y,
        piece.w,
        piece.h,
        piecePaint,
        piece.sx,
        piece.sy,
        piece.sw,
        piece.sh,
      );
    }
    canvas.restore();
    canvas.restore();
    if (eye.lid) {
      const lid = eye.lid;
      canvas.saveLayer(kit.mask);
      canvas.translate(lid.cx, lid.cy);
      canvas.scale(1, lid.s);
      canvas.translate(-lid.cx, -lid.cy);
      concat(canvas, kit, eye.matrix);
      if (eye.inner) concat(canvas, kit, eye.inner);
      const band = kit.bandRect;
      for (const { w, h, r, alpha } of lid.bands) {
        kit.band.setAlphaf(alpha);
        band.rect.setXYWH(-w, -h, 2 * w, 2 * h);
        band.rx = r;
        band.ry = r;
        canvas.drawRRect(band, kit.band);
      }
      canvas.restore();
      canvas.restore();
    }
  }
  if (eye.closed && eye.closed.opacity > 0.001) {
    const { w } = eye.closed;
    const line = kit.line;
    line.setStrokeWidth(w * CLOSED_EYE_STROKE);
    line.setAlphaf(eye.alpha * eye.closed.opacity);
    canvas.save();
    concat(canvas, kit, eye.matrix);
    canvas.drawPath(
      kit.path
        .reset()
        .moveTo(-w / 2, 0)
        .quadTo(0, w * CLOSED_EYE_BEND, w / 2, 0)
        .build(),
      line,
    );
    canvas.restore();
  }
}

export function saturationMatrix(s: number): number[] {
  "worklet";
  return [
    0.213 + 0.787 * s,
    0.715 - 0.715 * s,
    0.072 - 0.072 * s,
    0,
    0,
    0.213 - 0.213 * s,
    0.715 + 0.285 * s,
    0.072 - 0.072 * s,
    0,
    0,
    0.213 - 0.213 * s,
    0.715 - 0.715 * s,
    0.072 + 0.928 * s,
    0,
    0,
    0,
    0,
    0,
    1,
    0,
  ];
}

export function drawPlush(canvas: SkCanvas, frame: PlushFrame, art: PlushArt, size: number, saturation = 1) {
  "worklet";
  const kit = drawKit();
  const scale = size / VIEW_BOX;
  canvas.save();
  canvas.translate(size / 2, size / 2);
  canvas.scale(scale, scale);
  const grey = saturation < 1;
  if (grey) {
    if (kit.greySaturation !== saturation) {
      kit.grey.setColorFilter(Skia.ColorFilter.MakeMatrix(saturationMatrix(saturation)));
      kit.greySaturation = saturation;
    }
    canvas.saveLayer(kit.grey);
  }
  const faded = frame.bodyAlpha < 1;
  if (faded) canvas.saveLayer(alphaPaint(kit, frame.bodyAlpha));
  drawPicture(canvas, kit, art.body, -HALF_VIEW_BOX, -HALF_VIEW_BOX, VIEW_BOX, VIEW_BOX, kit.plain, 0, 0, 1, 1);
  for (const eye of frame.eyes) drawEye(canvas, kit, eye, art);
  if (faded) canvas.restore();
  for (const dot of frame.dots)
    drawPicture(canvas, kit, art.dot, dot.x, dot.y, dot.size, dot.size, alphaPaint(kit, dot.opacity), 0, 0, 1, 1);
  if (frame.notif) {
    const { x, y, size: ball } = frame.notif;
    drawPicture(canvas, kit, art.notif, x, y, ball, ball, kit.plain, 0, 0, 1, 1);
  }
  if (frame.zs.length > 0) {
    const stroke = kit.stroke;
    if (kit.strokeInk !== art.ink) {
      stroke.setColor(Skia.Color(art.ink));
      kit.strokeInk = art.ink;
    }
    for (const z of frame.zs) {
      stroke.setStrokeWidth(z.width);
      stroke.setAlphaf(z.opacity);
      const path = kit.path
        .reset()
        .moveTo(z.x - z.half, z.y - z.half)
        .lineTo(z.x + z.half, z.y - z.half)
        .lineTo(z.x - z.half, z.y + z.half)
        .lineTo(z.x + z.half, z.y + z.half)
        .build();
      canvas.drawPath(path, stroke);
    }
  }
  if (grey) canvas.restore();
  canvas.restore();
}

export function recordPlush(
  frame: PlushFrame | undefined,
  art: PlushArt | null,
  size: number,
  saturation: number,
): SkPicture {
  "worklet";
  const kit = drawKit();
  kit.bounds.setXYWH(0, 0, size, size);
  const canvas = kit.recorder.beginRecording(kit.bounds);
  if (art && frame) drawPlush(canvas, frame, art, size, saturation);
  return kit.recorder.finishRecordingAsPicture();
}
