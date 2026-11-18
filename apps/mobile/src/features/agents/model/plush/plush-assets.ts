import type { ShapeId } from "@norbert_bodziony/bloub";
import {
  AlphaType,
  ColorType,
  FilterMode,
  MipmapMode,
  type SkImage,
  Skia,
  type SkRuntimeEffect,
  TileMode,
} from "@shopify/react-native-skia";
import { Image } from "react-native";
import type { PlushArt } from "./plush-draw";
import { NOTIFY_COLOR, tintRamp } from "./plush-felt";

/*
 * The felt pictures come from the bloub package (see `metro.config.js`). A body is grey, and the app
 * tints it in the agent colour once for each size it shows. The eye pads are large photos of felt;
 * they are reduced once, to a size that still has detail for the largest avatar.
 */
const BODIES: Readonly<Record<ShapeId, number>> = {
  cercle: require("@norbert_bodziony/bloub/assets/forme-cercle.webp"),
  galet: require("@norbert_bodziony/bloub/assets/forme-galet.webp"),
  squircle: require("@norbert_bodziony/bloub/assets/forme-squircle.webp"),
  capsule: require("@norbert_bodziony/bloub/assets/forme-capsule.webp"),
  triangle: require("@norbert_bodziony/bloub/assets/forme-triangle.webp"),
  hexagone: require("@norbert_bodziony/bloub/assets/forme-hexagone.webp"),
  nuage: require("@norbert_bodziony/bloub/assets/forme-nuage.webp"),
  goutte: require("@norbert_bodziony/bloub/assets/forme-goutte.webp"),
  carre: require("@norbert_bodziony/bloub/assets/forme-carre.webp"),
  losange: require("@norbert_bodziony/bloub/assets/forme-losange.webp"),
  pentagone: require("@norbert_bodziony/bloub/assets/forme-pentagone.webp"),
};
const PAD_X = require("@norbert_bodziony/bloub/assets/fred-oeil0-x.webp");
const PAD_Y = require("@norbert_bodziony/bloub/assets/fred-oeil0-y.webp");
const BALL = require("@norbert_bodziony/bloub/assets/boule.webp");

/** The longest side of a reduced eye pad. A 144 point avatar draws a pad at about 150 pixels. */
const PAD_PIXELS = 512;
/** A felt ball is at most a fifth of the avatar. */
const BALL_PART = 0.2;
/** Avatar sizes share a picture for each step of this many pixels. */
const PIXEL_STEP = 32;
/** Decoded grey bodies: each is 768 pixels square, so few stay. */
const MAX_SOURCES = 2;
/**
 * Most avatars draw a body this wide or smaller. Each shape keeps a grey body of this size, so a list
 * of many shapes does not decode the large pictures again for each new colour or size.
 */
const REDUCED_PIXELS = 384;
const MAX_ART = 32;

const TINT = `
uniform shader image;
uniform shader ramp;
half4 main(float2 position) {
  half4 color = image.eval(position);
  if (color.a <= 0.0) return half4(0.0);
  half grey = clamp(color.r / color.a, 0.0, 1.0);
  half3 tinted = ramp.eval(float2(floor(grey * 255.0 + 0.5) + 0.5, 0.5)).rgb;
  return half4(tinted * color.a, color.a);
}`;

let tintEffect: SkRuntimeEffect | null | undefined;
function tint(): SkRuntimeEffect {
  tintEffect ??= Skia.RuntimeEffect.Make(TINT);
  if (!tintEffect) throw new Error("The plush tint did not compile.");
  return tintEffect;
}

async function decode(module: number): Promise<SkImage> {
  const asset = Image.resolveAssetSource(module);
  if (!asset) throw new Error("A plush picture is not in the bundle.");
  const image = Skia.Image.MakeImageFromEncoded(await Skia.Data.fromURI(asset.uri));
  if (!image) throw new Error("A plush picture could not be decoded.");
  return image;
}

/** `image` drawn at `width` x `height` on a raster surface, with mipmaps, so a reduction keeps detail. */
function resized(image: SkImage, width: number, height: number): SkImage {
  const surface = Skia.Surface.Make(width, height);
  if (!surface) throw new Error("The plush surface is unavailable.");
  surface
    .getCanvas()
    .drawImageRectOptions(
      image,
      Skia.XYWHRect(0, 0, image.width(), image.height()),
      Skia.XYWHRect(0, 0, width, height),
      FilterMode.Linear,
      MipmapMode.Linear,
      Skia.Paint(),
    );
  surface.flush();
  return surface.makeImageSnapshot();
}

/** The grey picture `image` in `hex`, `pixels` square. */
function tinted(image: SkImage, hex: string, pixels: number): SkImage {
  return tintedGrey(resized(image, pixels, pixels), hex);
}

/** The grey picture `grey` in `hex`, at its own size. */
function tintedGrey(grey: SkImage, hex: string): SkImage {
  const width = grey.width();
  const height = grey.height();
  const rampImage = Skia.Image.MakeImage(
    { width: 256, height: 1, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Opaque },
    Skia.Data.fromBytes(tintRamp(hex)),
    256 * 4,
  );
  const surface = Skia.Surface.Make(width, height);
  if (!rampImage || !surface) throw new Error("The plush tint is unavailable.");
  const paint = Skia.Paint();
  paint.setShader(
    tint().makeShaderWithChildren(
      [],
      [
        grey.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Nearest, MipmapMode.None),
        rampImage.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Nearest, MipmapMode.None),
      ],
    ),
  );
  surface.getCanvas().drawRect(Skia.XYWHRect(0, 0, width, height), paint);
  surface.flush();
  return surface.makeImageSnapshot();
}

function remember<T>(cache: Map<string, T>, key: string, value: T, limit: number): T {
  cache.delete(key);
  cache.set(key, value);
  const oldest = cache.keys().next().value;
  if (cache.size > limit && oldest !== undefined) cache.delete(oldest);
  return value;
}

const sources = new Map<string, Promise<SkImage>>();
function source(module: number, key: string): Promise<SkImage> {
  const cached = sources.get(key);
  if (cached) return remember(sources, key, cached, MAX_SOURCES);
  const loading = decode(module);
  // A failed load tries again next time.
  loading.catch(() => sources.delete(key));
  return remember(sources, key, loading, MAX_SOURCES);
}

const reduced = new Map<ShapeId, Promise<SkImage>>();
function body(shape: ShapeId, pixels: number): Promise<SkImage> {
  if (pixels > REDUCED_PIXELS) return source(BODIES[shape], shape);
  const cached = reduced.get(shape);
  if (cached) return cached;
  const loading = source(BODIES[shape], shape).then((image) => resized(image, REDUCED_PIXELS, REDUCED_PIXELS));
  loading.catch(() => reduced.delete(shape));
  reduced.set(shape, loading);
  return loading;
}

let pads: Promise<{ x: SkImage; y: SkImage; ball: SkImage }> | null = null;
function felt() {
  if (pads) return pads;
  const loading = Promise.all([decode(PAD_X), decode(PAD_Y), decode(BALL)]).then(([x, y, ball]) => {
    const reduce = (image: SkImage) => {
      const scale = Math.min(1, PAD_PIXELS / Math.max(image.width(), image.height()));
      return resized(image, Math.round(image.width() * scale), Math.round(image.height() * scale));
    };
    return { x: reduce(x), y: reduce(y), ball };
  });
  // A failed load tries again next time.
  loading.catch(() => {
    pads = null;
  });
  pads = loading;
  return loading;
}

/** The pixels of a plush drawn `size` points wide, in steps, so that near sizes share their pictures. */
export function plushPixels(size: number, scale: number): number {
  return Math.max(PIXEL_STEP, Math.ceil((size * scale) / PIXEL_STEP) * PIXEL_STEP);
}

const art = new Map<string, Promise<PlushArt>>();
const ready = new Map<string, PlushArt>();
const artKey = (shape: ShapeId, color: string, pixels: number) => `${shape}|${color}|${pixels}`;

/** The pictures of a plush of `shape` in `color`, drawn `pixels` pixels wide. */
export function loadPlushArt(shape: ShapeId, color: string, pixels: number): Promise<PlushArt> {
  const key = artKey(shape, color, pixels);
  const cached = art.get(key);
  if (cached) return remember(art, key, cached, MAX_ART);
  const loading = Promise.all([body(shape, pixels), felt()]).then(([grey, felt]) => {
    const ball = Math.max(16, Math.ceil(pixels * BALL_PART));
    const loaded: PlushArt = {
      body: tinted(grey, color, pixels),
      padX: felt.x,
      padY: felt.y,
      dot: tinted(felt.ball, color, ball),
      notif: tinted(felt.ball, NOTIFY_COLOR, ball),
      ink: color,
    };
    remember(ready, key, loaded, MAX_ART);
    return loaded;
  });
  loading.catch(() => art.delete(key));
  return remember(art, key, loading, MAX_ART);
}

/** The pictures when they are loaded already, so a remount draws at once. */
export function loadedPlushArt(shape: ShapeId, color: string, pixels: number): PlushArt | null {
  return ready.get(artKey(shape, color, pixels)) ?? null;
}

/** The smallest alpha that is fur, as the desktop crops the server plush pictures. */
const FUR_ALPHA = 16;
const FUR_SOURCE_SCALE = 1.6;

/** The box of the fur of a body, in parts of its side. */
interface FurBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const furBoxes = new Map<ShapeId, FurBox>();

/** The box of the pixels of `image` with alpha `FUR_ALPHA` or more. Each shape is measured once. */
function furBox(shape: ShapeId, image: SkImage): FurBox {
  const known = furBoxes.get(shape);
  if (known) return known;
  const width = image.width();
  const height = image.height();
  const pixels = image.readPixels(0, 0, {
    width,
    height,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  });
  if (!pixels) throw new Error("The plush body could not be read.");
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((pixels[(y * width + x) * 4 + 3] ?? 0) < FUR_ALPHA) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  const box =
    right < left
      ? { x: 0, y: 0, width: 1, height: 1 }
      : { x: left / width, y: top / height, width: (right + 1 - left) / width, height: (bottom + 1 - top) / height };
  furBoxes.set(shape, box);
  return box;
}

const furBodies = new Map<string, Promise<SkImage>>();

/**
 * The body of `shape` in `color`, with no eyes, in a `pixels` square: its fur fills the square on its
 * longer side and is centred on the other, as the desktop draws the plush of a server with no logo.
 */
export function loadFurBody(shape: ShapeId, color: string, pixels: number): Promise<SkImage> {
  const key = artKey(shape, color, pixels);
  const cached = furBodies.get(key);
  if (cached) return remember(furBodies, key, cached, MAX_ART);
  // The fur is about two thirds of the side of a body, so the grey body is larger than the square.
  const loading = body(shape, Math.ceil(pixels * FUR_SOURCE_SCALE)).then((grey) => {
    const box = furBox(shape, grey);
    const greyWidth = grey.width();
    const greyHeight = grey.height();
    const scale = pixels / Math.max(box.width, box.height);
    const width = box.width * scale;
    const height = box.height * scale;
    const surface = Skia.Surface.Make(pixels, pixels);
    if (!surface) throw new Error("The plush surface is unavailable.");
    surface
      .getCanvas()
      .drawImageRectOptions(
        grey,
        Skia.XYWHRect(box.x * greyWidth, box.y * greyHeight, box.width * greyWidth, box.height * greyHeight),
        Skia.XYWHRect((pixels - width) / 2, (pixels - height) / 2, width, height),
        FilterMode.Linear,
        MipmapMode.Linear,
        Skia.Paint(),
      );
    surface.flush();
    return tintedGrey(surface.makeImageSnapshot(), color);
  });
  loading.catch(() => furBodies.delete(key));
  return remember(furBodies, key, loading, MAX_ART);
}
