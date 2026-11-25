const CLEAR_DISTANCE = 48;
const SOLID_DISTANCE = 120;
const FLAT_EDGE_SHARE = 0.85;
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
      const own = alpha === 0 ? 0 : (colour - (1 - alpha) * (key[part] ?? 0)) / alpha;
      pixels[offset + part] = Math.round(Math.min(255, Math.max(0, own)) * alpha);
    }
    pixels[offset + 3] = Math.round(alpha * 255);
  }
  removeSpill(pixels, width, height, reached, key);
  return true;
}

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
