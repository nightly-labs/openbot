import { tintRamp } from "@norbert_bodziony/bloub/plush";
import { type ServerPlushColor, serverPlushColor, serverPlushHex } from "@openbot/brand/bloub-avatar";
import type { ServerAppearance, ServerAppearanceShape } from "@openbot/contracts/team-protocol/host-appearance-v1";
import type { JSX } from "@solidjs/web";
import { createEffect, createSignal } from "solid-js";
import ambre from "./assets/plush/server/ambre.webp";
import bleu from "./assets/plush/server/bleu.webp";
import orange from "./assets/plush/server/orange.webp";
import rose from "./assets/plush/server/rose.webp";
import rouge from "./assets/plush/server/rouge.webp";
import capsule from "./assets/plush/server/shape/capsule.webp";
import carre from "./assets/plush/server/shape/carre.webp";
import cercle from "./assets/plush/server/shape/cercle.webp";
import galet from "./assets/plush/server/shape/galet.webp";
import hexagone from "./assets/plush/server/shape/hexagone.webp";
import losange from "./assets/plush/server/shape/losange.webp";
import nuage from "./assets/plush/server/shape/nuage.webp";
import pentagone from "./assets/plush/server/shape/pentagone.webp";
import squircle from "./assets/plush/server/shape/squircle.webp";
import triangle from "./assets/plush/server/shape/triangle.webp";
import turquoise from "./assets/plush/server/turquoise.webp";
import vert from "./assets/plush/server/vert.webp";
import violet from "./assets/plush/server/violet.webp";
import { cx } from "./utils";

const PICTURES: Readonly<Record<ServerPlushColor, string>> = {
  rouge,
  orange,
  ambre,
  vert,
  turquoise,
  bleu,
  violet,
  rose,
};

/**
 * The grey Bloub bodies, cropped to the fur as the pictures above are. `tintRamp` gives them a
 * colour in the browser.
 */
const GREY_BODIES: Readonly<Record<ServerAppearanceShape, string>> = {
  squircle,
  cercle,
  galet,
  capsule,
  carre,
  losange,
  triangle,
  pentagone,
  hexagone,
  nuage,
};

const tintedBodies = new Map<string, Promise<string>>();

/** The `data:` URL of a grey body in a colour. Each pair is drawn once per page. */
function tintedBody(shape: ServerAppearanceShape, hex: string): Promise<string> {
  const key = `${shape}|${hex}`;
  const cached = tintedBodies.get(key);
  if (cached) return cached;
  const result = drawTintedBody(GREY_BODIES[shape], hex);
  tintedBodies.set(key, result);
  result.catch(() => tintedBodies.delete(key));
  return result;
}

async function drawTintedBody(url: string, hex: string): Promise<string> {
  const image = new Image();
  image.src = url;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No 2D canvas.");
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const ramp = tintRamp(hex);
  const data = pixels.data;
  for (let index = 0; index < data.length; index += 4) {
    const grey = (data[index] ?? 0) * 3;
    data[index] = ramp[grey] ?? 0;
    data[index + 1] = ramp[grey + 1] ?? 0;
    data[index + 2] = ramp[grey + 2] ?? 0;
  }
  context.putImageData(pixels, 0, 0);
  return canvas.toDataURL("image/webp", 0.9);
}

/** True when the server looks as it does with no choice: the squircle in its automatic colour. */
function isAutomatic(appearance: ServerAppearance | null | undefined): appearance is null | undefined {
  return !appearance || (appearance.shape === "squircle" && appearance.color === null);
}

export interface ServerPlushLogoProps {
  /** The server ID. It chooses the colour when the server has no colour of its own. */
  seed: string;
  /** The shape and colour that an owner or admin chose. Null or absent gives the automatic look. */
  appearance?: ServerAppearance | null | undefined;
  class?: JSX.HTMLAttributes<HTMLImageElement>["class"];
}

/** The felt plush that a server shows when it has no logo of its own. */
export function ServerPlushLogo(props: ServerPlushLogoProps): JSX.Element {
  const [tinted, setTinted] = createSignal<{ key: string; url: string | null } | null>(null);
  const chosen = () => {
    const appearance = props.appearance;
    if (isAutomatic(appearance)) return null;
    const hex = serverPlushHex(props.seed, appearance.color);
    return { shape: appearance.shape, hex, key: `${appearance.shape}|${hex}` };
  };
  createEffect(chosen, (current) => {
    if (!current) return;
    let live = true;
    tintedBody(current.shape, current.hex).then(
      (url) => {
        if (live) setTinted({ key: current.key, url });
      },
      // A body that does not draw keeps the automatic picture.
      () => {
        if (live) setTinted({ key: current.key, url: null });
      },
    );
    return () => {
      live = false;
    };
  });
  const source = () => {
    const current = chosen();
    if (!current) return PICTURES[serverPlushColor(props.seed)];
    const drawn = tinted();
    // Until the body is drawn, the image stays empty and keeps its size.
    if (drawn?.key !== current.key) return undefined;
    return drawn.url ?? PICTURES[serverPlushColor(props.seed)];
  };
  return (
    <img class={cx("ui-server-plush-logo", props.class)} src={source()} alt="" draggable={false} aria-hidden="true" />
  );
}
