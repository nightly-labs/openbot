import { serverPlushHex } from "@openbot/brand/bloub-avatar";
import type { ServerAppearance, ServerAppearanceShape } from "@openbot/contracts/team-protocol/host-appearance-v1";
import { ImageFormat, Skia } from "@shopify/react-native-skia";
import { useEffect, useState } from "react";
import { PixelRatio } from "react-native";
import { loadFurBody, plushPixels } from "@/features/agents/model/plush/plush-assets";
import { saturationMatrix } from "@/features/agents/model/plush/plush-draw";

/** Pictures kept in memory. A server list and the shape choices of the settings fit in it. */
const MAX_PICTURES = 32;

const pictures = new Map<string, Promise<string>>();
const ready = new Map<string, string>();

function remember<T>(cache: Map<string, T>, key: string, value: T): T {
  cache.delete(key);
  cache.set(key, value);
  const oldest = cache.keys().next().value;
  if (cache.size > MAX_PICTURES && oldest !== undefined) cache.delete(oldest);
  return value;
}

const pictureKey = (shape: ServerAppearanceShape, hex: string, pixels: number, saturation: number) =>
  `${shape}|${hex}|${pixels}|${saturation}`;

/**
 * The felt body of a server with no logo as a PNG `data:` URI: the shape in `hex`, with no eyes,
 * `pixels` square. `saturation` below 1 greys it, as a disconnected server shows.
 */
function loadServerPlush(shape: ServerAppearanceShape, hex: string, pixels: number, saturation: number) {
  const key = pictureKey(shape, hex, pixels, saturation);
  const cached = pictures.get(key);
  if (cached) return remember(pictures, key, cached);
  const loading = loadFurBody(shape, hex, pixels).then((body) => {
    const surface = Skia.Surface.Make(pixels, pixels);
    if (!surface) throw new Error("The plush surface is unavailable.");
    const paint = Skia.Paint();
    if (saturation < 1) paint.setColorFilter(Skia.ColorFilter.MakeMatrix(saturationMatrix(saturation)));
    surface.getCanvas().drawImage(body, 0, 0, paint);
    surface.flush();
    const uri = `data:image/png;base64,${surface.makeImageSnapshot().encodeToBase64(ImageFormat.PNG)}`;
    remember(ready, key, uri);
    return uri;
  });
  // A failed load tries again next time.
  loading.catch(() => pictures.delete(key));
  return remember(pictures, key, loading);
}

/**
 * The plush picture of `appearance` for a square of `size` points. `uri` is null while it is drawn;
 * `failed` is true when it cannot be drawn, so the caller shows its other look.
 */
export function useServerPlush(
  serverId: string,
  appearance: ServerAppearance | null | undefined,
  size: number,
  saturation: number,
): { uri: string | null; failed: boolean } {
  const shape = appearance?.shape ?? null;
  const hex = serverPlushHex(serverId, appearance?.color ?? null);
  const pixels = plushPixels(size, PixelRatio.get());
  const key = shape ? pictureKey(shape, hex, pixels, saturation) : null;
  const known = key ? (ready.get(key) ?? null) : null;
  const [loaded, setLoaded] = useState<{ key: string; uri: string | null } | null>(null);
  useEffect(() => {
    if (!shape || !key || known) return;
    let current = true;
    loadServerPlush(shape, hex, pixels, saturation).then(
      (uri) => {
        if (current) setLoaded({ key, uri });
      },
      () => {
        if (current) setLoaded({ key, uri: null });
      },
    );
    return () => {
      current = false;
    };
  }, [hex, key, known, pixels, saturation, shape]);
  if (known) return { uri: known, failed: false };
  if (!key || loaded?.key !== key) return { uri: null, failed: false };
  return { uri: loaded.uri, failed: loaded.uri === null };
}
