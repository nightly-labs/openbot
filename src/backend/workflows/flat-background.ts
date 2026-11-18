/**
 * Removes the flat background colour of a generated picture, for a model that cannot make clear
 * pixels itself (Grok Imagine). The step asks the model for one solid colour around the subject; the
 * colour of the picture's edge is that colour.
 */

/** Below this distance from the background colour a pixel is background. */
const CLEAR_DISTANCE = 48;
/** Above this distance a pixel is subject. Between the two, the pixel is part of each. */
const SOLID_DISTANCE = 120;
/** How many of the edge pixels must have the background colour for a picture to have a flat background. */
const FLAT_EDGE_SHARE = 0.85;
/** How far from the background a subject pixel can still have a tint of the background colour. */
const SPILL_REACH = 2;

function distance(pixels: Uint8Array, offset: number, key: readonly number[]): number {
  const a = (pixels[offset] ?? 0) - (key[0] ?? 0);
  const b = (pixels[offset + 1] ?? 0) - (key[1] ?? 0);
  const c = (pixels[offset + 2] ?? 0) - (key[2] ?? 0);
  return Math.sqrt(a * a + b * b + c * c);
}

function median(values: number[]): number {
  values.sort((left, right) => left - right);
  return values[Math.floor(values.length / 2)] ?? 0;
}

/**
 * Makes the background of `pixels` clear, in place. `pixels` holds four bytes for each pixel with the
 * alpha last; the order of the three colour bytes does not matter. The background grows from the edge
 * and from each pixel within `CLEAR_DISTANCE` of the edge colour, so a hole between an arm and the body
 * clears too. A subject part of nearly the key colour clears with it: the step asks the model for a key
 * colour that the subject does not have. A pixel at the
 * border of the subject gets part alpha, and the background colour is taken out of its colour. The
 * result is premultiplied, as Skia's bitmaps hold it.
 *
 * Returns false and changes nothing when the picture already has clear pixels, or when its edge is not
 * one flat colour.
 */
export function clearFlatBackground(pixels: Uint8Array, width: number, height: number): boolean {
  const count = width * height;
  if (width < 3 || height < 3 || pixels.length < count * 4) return false;
  for (let index = 3; index < count * 4; index += 4) if ((pixels[index] ?? 255) < 250) return false;

  const edge: number[] = [];
  for (let x = 0; x < width; x += 1) edge.push(x, (height - 1) * width + x);
  for (let y = 1; y < height - 1; y += 1) edge.push(y * width, y * width + width - 1);
  const channel = (offset: number) => median(edge.map((pixel) => pixels[pixel * 4 + offset] ?? 0));
  const key = [channel(0), channel(1), channel(2)];
  const flat = edge.filter((pixel) => distance(pixels, pixel * 4, key) < CLEAR_DISTANCE).length;
  if (flat < edge.length * FLAT_EDGE_SHARE) return false;

  // The background grows from the edge and from each pixel near the key colour, through the pixels
  // that are not clearly subject.
  const reached = new Uint8Array(count);
  const queue = new Int32Array(count);
  let tail = 0;
  const seed = (pixel: number) => {
    if (reached[pixel] || distance(pixels, pixel * 4, key) >= SOLID_DISTANCE) return;
    reached[pixel] = 1;
    queue[tail] = pixel;
    tail += 1;
  };
  for (const pixel of edge) seed(pixel);
  for (let pixel = 0; pixel < count; pixel += 1) if (distance(pixels, pixel * 4, key) < CLEAR_DISTANCE) seed(pixel);
  for (let head = 0; head < tail; head += 1) {
    const pixel = queue[head] ?? 0;
    const x = pixel % width;
    if (x > 0) seed(pixel - 1);
    if (x < width - 1) seed(pixel + 1);
    if (pixel >= width) seed(pixel - width);
    if (pixel < count - width) seed(pixel + width);
  }

  for (let pixel = 0; pixel < count; pixel += 1) {
    if (!reached[pixel]) continue;
    const offset = pixel * 4;
    const alpha = Math.min(
      1,
      Math.max(0, (distance(pixels, offset, key) - CLEAR_DISTANCE) / (SOLID_DISTANCE - CLEAR_DISTANCE)),
    );
    for (let part = 0; part < 3; part += 1) {
      const colour = pixels[offset + part] ?? 0;
      // The colour without the background in it, then premultiplied: colour - (1 - alpha) × key.
      const own = alpha === 0 ? 0 : (colour - (1 - alpha) * (key[part] ?? 0)) / alpha;
      pixels[offset + part] = Math.round(Math.min(255, Math.max(0, own)) * alpha);
    }
    pixels[offset + 3] = Math.round(alpha * 255);
  }
  removeSpill(pixels, width, height, reached, key);
  return true;
}

/**
 * A subject pixel at the border of the background mixes the subject with the background colour. When it
 * is too far from that colour to clear, it keeps a tint of it: a green line around a subject on green.
 * For each pixel within `SPILL_REACH` pixels of the background, the strong channels of the background
 * colour come down to the level of its weak channels. The values are premultiplied, so a scale of a
 * pixel's channels does not change the result.
 */
function removeSpill(
  pixels: Uint8Array,
  width: number,
  height: number,
  reached: Uint8Array,
  key: readonly number[],
): void {
  const strong = [0, 1, 2].filter((part) => (key[part] ?? 0) >= 128);
  const weak = [0, 1, 2].filter((part) => (key[part] ?? 0) < 128);
  if (strong.length === 0 || weak.length === 0) return;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const offset = pixel * 4;
      if ((pixels[offset + 3] ?? 0) === 0 || !nearBackground(reached, width, height, x, y)) continue;
      const values = (parts: number[]) => parts.map((part) => pixels[offset + part] ?? 0);
      const spill = Math.min(...values(strong)) - Math.max(...values(weak));
      if (spill <= 0) continue;
      for (const part of strong) pixels[offset + part] = (pixels[offset + part] ?? 0) - spill;
    }
  }
}

function nearBackground(reached: Uint8Array, width: number, height: number, x: number, y: number): boolean {
  for (let row = Math.max(0, y - SPILL_REACH); row <= Math.min(height - 1, y + SPILL_REACH); row += 1) {
    for (let column = Math.max(0, x - SPILL_REACH); column <= Math.min(width - 1, x + SPILL_REACH); column += 1) {
      if (reached[row * width + column]) return true;
    }
  }
  return false;
}
