import {
  BlendMode,
  FilterMode,
  MipmapMode,
  PaintStyle,
  type SkCanvas,
  type SkImage,
  Skia,
  type SkPaint,
  type SkRect,
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

/** The pictures of one plush: its tinted body and felt balls, and the shared eye pads. */
export interface PlushArt {
  body: SkImage;
  padX: SkImage;
  padY: SkImage;
  /** The felt ball in the agent colour: the thinking dots. */
  dot: SkImage;
  /** The blue felt ball of `notify`. */
  notif: SkImage;
  /** The agent colour: the z's of sleep. */
  ink: string;
}

function concat(canvas: SkCanvas, [a, b, c, d, e, f]: Matrix) {
  "worklet";
  canvas.concat(Skia.Matrix([a, c, e, b, d, f, 0, 0, 1]));
}

function opacityPaint(opacity: number): SkPaint {
  "worklet";
  const paint = Skia.Paint();
  paint.setAlphaf(opacity);
  return paint;
}

/**
 * Draws `source` of `image`, or all of it, into a rectangle. Do not give a worklet parameter a default
 * that reads a closure value: on the UI runtime the default runs before the closure is read.
 */
function drawPicture(
  canvas: SkCanvas,
  image: SkImage,
  x: number,
  y: number,
  width: number,
  height: number,
  paint: SkPaint,
  source: SkRect | null,
) {
  "worklet";
  canvas.drawImageRectOptions(
    image,
    source ?? Skia.XYWHRect(0, 0, image.width(), image.height()),
    Skia.XYWHRect(x, y, width, height),
    FilterMode.Linear,
    MipmapMode.Linear,
    paint,
  );
}

/**
 * One eye: the felt pad in pieces that add up (`plus`) in their own layer, under the lids of a
 * blink, and the closed line of sleep.
 */
function drawEye(canvas: SkCanvas, eye: PlushEye, art: PlushArt) {
  "worklet";
  const opacity = eye.alpha * eye.pad;
  if (opacity > 0.001) {
    if (eye.lid) canvas.saveLayer();
    canvas.save();
    concat(canvas, eye.matrix);
    if (eye.inner) concat(canvas, eye.inner);
    canvas.saveLayer(opacityPaint(opacity));
    const piecePaint = Skia.Paint();
    if (eye.pieces.length > 1) piecePaint.setBlendMode(BlendMode.Plus);
    for (const piece of eye.pieces) {
      const image = piece.src === 0 ? art.padX : art.padY;
      const width = image.width();
      const height = image.height();
      drawPicture(
        canvas,
        image,
        piece.x,
        piece.y,
        piece.w,
        piece.h,
        piecePaint,
        Skia.XYWHRect(piece.sx * width, piece.sy * height, piece.sw * width, piece.sh * height),
      );
    }
    canvas.restore();
    canvas.restore();
    if (eye.lid) {
      const lid = eye.lid;
      const mask = Skia.Paint();
      mask.setBlendMode(BlendMode.DstIn);
      canvas.saveLayer(mask);
      canvas.translate(lid.cx, lid.cy);
      canvas.scale(1, lid.s);
      canvas.translate(-lid.cx, -lid.cy);
      concat(canvas, eye.matrix);
      if (eye.inner) concat(canvas, eye.inner);
      const band = Skia.Paint();
      band.setAntiAlias(true);
      band.setColor(Skia.Color("white"));
      for (const { w, h, r, alpha } of lid.bands) {
        band.setAlphaf(alpha);
        canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(-w, -h, 2 * w, 2 * h), r, r), band);
      }
      canvas.restore();
      canvas.restore();
    }
  }
  if (eye.closed && eye.closed.opacity > 0.001) {
    const { w } = eye.closed;
    const line = Skia.Paint();
    line.setAntiAlias(true);
    line.setStyle(PaintStyle.Stroke);
    line.setStrokeCap(StrokeCap.Round);
    line.setStrokeWidth(w * CLOSED_EYE_STROKE);
    line.setColor(Skia.Color(CLOSED_EYE_COLOR));
    line.setAlphaf(eye.alpha * eye.closed.opacity);
    canvas.save();
    concat(canvas, eye.matrix);
    canvas.drawPath(
      Skia.PathBuilder.Make()
        .moveTo(-w / 2, 0)
        .quadTo(0, w * CLOSED_EYE_BEND, w / 2, 0)
        .build(),
      line,
    );
    canvas.restore();
  }
}

/** The colour matrix of SVG `saturate`. */
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

/**
 * Draws a plush frame: the whole viewBox in a square of `size` pixels. It runs on the UI thread for a
 * moving avatar and on the JS thread for a still picture, so both show the same pixels. `saturation`
 * below 1 greys the plush, as a disconnected agent shows.
 */
export function drawPlush(canvas: SkCanvas, frame: PlushFrame, art: PlushArt, size: number, saturation = 1) {
  "worklet";
  const scale = size / VIEW_BOX;
  canvas.save();
  canvas.translate(size / 2, size / 2);
  canvas.scale(scale, scale);
  const grey = saturation < 1;
  if (grey) {
    const paint = Skia.Paint();
    paint.setColorFilter(Skia.ColorFilter.MakeMatrix(saturationMatrix(saturation)));
    canvas.saveLayer(paint);
  }
  const faded = frame.bodyAlpha < 1;
  if (faded) canvas.saveLayer(opacityPaint(frame.bodyAlpha));
  drawPicture(canvas, art.body, -HALF_VIEW_BOX, -HALF_VIEW_BOX, VIEW_BOX, VIEW_BOX, Skia.Paint(), null);
  for (const eye of frame.eyes) drawEye(canvas, eye, art);
  if (faded) canvas.restore();
  for (const dot of frame.dots)
    drawPicture(canvas, art.dot, dot.x, dot.y, dot.size, dot.size, opacityPaint(dot.opacity), null);
  if (frame.notif) {
    const { x, y, size: ball } = frame.notif;
    drawPicture(canvas, art.notif, x, y, ball, ball, Skia.Paint(), null);
  }
  if (frame.zs.length > 0) {
    const stroke = Skia.Paint();
    stroke.setAntiAlias(true);
    stroke.setStyle(PaintStyle.Stroke);
    stroke.setStrokeCap(StrokeCap.Round);
    stroke.setStrokeJoin(StrokeJoin.Round);
    stroke.setColor(Skia.Color(art.ink));
    for (const z of frame.zs) {
      stroke.setStrokeWidth(z.width);
      stroke.setAlphaf(z.opacity);
      const path = Skia.PathBuilder.Make()
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
