import type { BloubAvatarProfile } from "@openbot/ui/bloub-avatar";
import planet from "./felt-card/planet.webp";

/*
 * The pictures of the share card, cut from the "Filcowe karty agentów" and "Filcowe boty — 16
 * wymiennych min" frames of the design file. Each body is one shape in one colour with no eyes;
 * each eye layer is one expression for one shape, on the same square, so any pair lines up.
 *
 * Only the URLs are in the bundle. A picture is read when a card is drawn.
 */

const BODIES = import.meta.glob<string>("./felt-card/felt/*.webp", { eager: true, query: "?url", import: "default" });
const EYES = import.meta.glob<string>("./felt-card/eyes/*.webp", { eager: true, query: "?url", import: "default" });

/** The felt colours of the design file, one for each avatar hue. */
const FELT_COLOURS = [
  ["red", "#e8483f"],
  ["orange", "#f08a24"],
  ["yellow", "#f0b429"],
  ["lime", "#8ece34"],
  ["green", "#3ecf8e"],
  ["turquoise", "#2fbfa0"],
  ["blue", "#3b93f0"],
  ["indigo", "#5d67ee"],
  ["violet", "#8b5cf6"],
  ["magenta", "#e152b0"],
] as const;
type FeltColour = (typeof FELT_COLOURS)[number][0];

export interface FeltCardArt {
  planet: string;
  body: string;
  eyes: string;
}

export function feltCardArt(profile: BloubAvatarProfile): FeltCardArt {
  const colour = nearestFeltColour(profile.color);
  const body = BODIES[`./felt-card/felt/${profile.shape}-${colour}.webp`];
  const eyes = EYES[`./felt-card/eyes/${profile.shape}-${profile.expression}.webp`];
  if (!body || !eyes) throw new Error(`The share card has no felt for ${profile.shape}.`);
  return { planet, body, eyes };
}

/** The felt closest to the avatar's colour, so a colour that is not a hue still gets a body. */
function nearestFeltColour(hex: string): FeltColour {
  const [r, g, b] = rgb(hex);
  let best: FeltColour = "blue";
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [name, value] of FELT_COLOURS) {
    const [fr, fg, fb] = rgb(value);
    const distance = (fr - r) ** 2 + (fg - g) ** 2 + (fb - b) ** 2;
    if (distance < bestDistance) {
      best = name;
      bestDistance = distance;
    }
  }
  return best;
}

function rgb(hex: string): [number, number, number] {
  const channel = (offset: number) => Number.parseInt(hex.slice(1 + offset, 3 + offset), 16);
  return [channel(0), channel(2), channel(4)];
}
