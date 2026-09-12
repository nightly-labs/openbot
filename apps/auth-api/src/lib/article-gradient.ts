// Every article's artwork is derived from its title and nothing else, so the card
// on an index, the live shader that replaces it on hover, and the og:image baked at
// build time all agree without anyone keeping three things in step. It also means
// a published article keeps its colours forever: change the derivation and you
// silently re-colour every social card already shared, which is why
// test/content-metadata.test.ts pins the output for a fixed title.
//
// The hexes below are copies of brand tokens. A WebGL uniform needs a real colour,
// not a var(), and this module is read by the build-time generator where no
// document exists to resolve one. The same test pins them to tokens.css.

/** `--openbot-logo-production` */
const LOGO_PRODUCTION = "#d6adf2";
/** `--openbot-warning`, which `--openbot-logo-dev` aliases */
const LOGO_DEV = "#ff9412";
/** `--openbot-success`, which `--openbot-logo-preview` aliases */
const LOGO_PREVIEW = "#31cf76";
/** `--openbot-accent` */
const ACCENT = "#007cf7";
/** `--openbot-unread-surface` */
const UNREAD = "#74b9ff";
/** `--openbot-onboarding-desktop-indigo` */
const INDIGO = "#6f7de8";
/** `--openbot-chart-series-grok` */
const CYAN = "#6bc7d9";
/** `--openbot-provider-claude` */
const TERRACOTTA = "#d97757";
/** `--openbot-danger-text` */
const CORAL = "#ff6069";
/** `--openbot-badge-new` */
const MAGENTA = "#ff1e5e";
/** `--openbot-text-dim` */
const DIM = "#6a6a6a";
/** `--openbot-bg-canvas`, the page behind the card */
const CANVAS = "#1a1a1a";

export const ARTICLE_GRADIENT_BRAND_HEXES = {
  "--openbot-logo-production": LOGO_PRODUCTION,
  "--openbot-warning": LOGO_DEV,
  "--openbot-success": LOGO_PREVIEW,
  "--openbot-accent": ACCENT,
  "--openbot-unread-surface": UNREAD,
  "--openbot-onboarding-desktop-indigo": INDIGO,
  "--openbot-chart-series-grok": CYAN,
  "--openbot-provider-claude": TERRACOTTA,
  "--openbot-danger-text": CORAL,
  "--openbot-badge-new": MAGENTA,
  "--openbot-text-dim": DIM,
  "--openbot-bg-canvas": CANVAS,
} as const;

// Four deep anchors that are not brand tokens. Nothing in the product is this
// dark and this saturated, and the mesh needs somewhere for a hue to go before it
// reaches the page colour, or every card ends the same muddy grey.
const VIOLET_DEEP = "#7b3fa8";
const RED_DEEP = "#f2564a";
const GREEN_DEEP = "#1d7a5a";
const BLUE_DEEP = "#0a3f7d";
const PLUM_DEEP = "#a83f7b";
const SILVER = "#c8c8c8";

// Twelve families, each one hue band rather than a spread of the whole wheel: a
// dominant brand colour, two neighbours, and an anchor. A card is meant to read as
// one colour seen from several sides, which is also what keeps a row of them
// looking like one system rather than a swatch page. Every family ends on the
// canvas colour, and that is what makes a card fade into the page at its edges
// instead of sitting on it as a rectangle.
const FAMILIES = [
  // Lilac
  [LOGO_PRODUCTION, VIOLET_DEEP, INDIGO, ACCENT, CANVAS],
  // Ember
  [LOGO_DEV, RED_DEEP, CORAL, TERRACOTTA, CANVAS],
  // Mint
  [LOGO_PREVIEW, GREEN_DEEP, CYAN, ACCENT, CANVAS],
  // Deep water
  [ACCENT, BLUE_DEEP, UNREAD, INDIGO, CANVAS],
  // Sunset
  [LOGO_DEV, LOGO_PRODUCTION, PLUM_DEEP, MAGENTA, CANVAS],
  // Graphite
  [SILVER, DIM, LOGO_PRODUCTION, UNREAD, CANVAS],
  // Terracotta
  [TERRACOTTA, LOGO_DEV, PLUM_DEEP, VIOLET_DEEP, CANVAS],
  // Lagoon
  [CYAN, ACCENT, LOGO_PREVIEW, UNREAD, CANVAS],
  // Magenta
  [MAGENTA, PLUM_DEEP, LOGO_PRODUCTION, VIOLET_DEEP, CANVAS],
  // Indigo
  [INDIGO, VIOLET_DEEP, UNREAD, LOGO_PRODUCTION, CANVAS],
  // Rosewood
  [CORAL, MAGENTA, INDIGO, LOGO_PRODUCTION, CANVAS],
  // Forest
  [GREEN_DEEP, LOGO_PREVIEW, CYAN, BLUE_DEEP, CANVAS],
] as const;

export interface ArticleGradient {
  /** Up to `meshGradientMeta.maxColorCount` colours, as `#rrggbb`. */
  colors: readonly string[];
  /** Organic noise distortion, 0 to 1. */
  distortion: number;
  /** Vortex distortion, 0 to 1. */
  swirl: number;
  /** Grain worked into the shape edges, 0 to 1. */
  grainMixer: number;
  /** Degrees, 0 to 360. */
  rotation: number;
  /**
   * Milliseconds into the animation. With `speed: 0` this is the whole of the
   * shader's time input, so it is what makes a still render reproducible.
   */
  frame: number;
}

// FNV-1a. Chosen because it is eight lines and has no dependencies, not for any
// cryptographic property: the only requirement is that it never changes.
function hashTitle(title: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < title.length; index += 1) {
    hash ^= title.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

// Successive independent-ish draws from one hash. Mixing between reads keeps the
// low bits of the original hash from driving every parameter at once.
function createDraw(seed: number): (range: number) => number {
  let state = seed;
  return (range) => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;
    state >>>= 0;
    return state % range;
  };
}

export function articleGradient(title: string): ArticleGradient {
  const hash = hashTitle(title);
  const draw = createDraw(hash || 1);
  const family = FAMILIES[hash % FAMILIES.length] ?? FAMILIES[0];

  return {
    colors: [...family],
    // Kept well short of 1: past roughly 0.8 the colour spots smear into mud and
    // every article starts to look like the same brown cloud.
    distortion: round(0.55 + draw(26) / 100),
    swirl: round(0.08 + draw(22) / 100),
    grainMixer: round(0.1 + draw(16) / 100),
    rotation: draw(360),
    frame: draw(40_000),
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The mesh gradient's uniforms. Takes the colour converter as an argument rather
 * than importing it, so that this module — which the sitemap route and the feed
 * also pull in — never drags the shader library into the Worker bundle. The
 * browser component and the build-time generator both call this, which is what
 * makes the live shader and the baked image the same picture.
 */
export function articleGradientUniforms(
  gradient: ArticleGradient,
  toShaderColor: (hex: string) => number[],
): Record<string, number | number[] | number[][]> {
  return {
    u_colors: gradient.colors.map(toShaderColor),
    u_colorsCount: gradient.colors.length,
    u_distortion: gradient.distortion,
    u_swirl: gradient.swirl,
    u_grainMixer: gradient.grainMixer,
    u_grainOverlay: 0,
    // `worldWidth`/`worldHeight` of 0 means there is no fixed world to fit, so
    // `u_fit` has nothing to act on and scale alone decides the framing.
    u_fit: 0,
    u_scale: 1,
    u_rotation: gradient.rotation,
    u_originX: 0.5,
    u_originY: 0.5,
    u_offsetX: 0,
    u_offsetY: 0,
    u_worldWidth: 0,
    u_worldHeight: 0,
  };
}

/**
 * A plain CSS approximation of the same colours, used as the layer underneath the
 * generated image. It renders during SSR, covers the moment before the PNG
 * decodes, and is what the card falls back to if the image is ever missing — so a
 * failed generation degrades to a duller card rather than an empty grey box.
 */
export function articleGradientCss(gradient: ArticleGradient): string {
  const [first, second, third, fourth] = gradient.colors;
  // The last entry of a family is always the page colour, so it is the base the
  // spots sit on rather than a spot of its own.
  const base = gradient.colors[gradient.colors.length - 1];
  return [
    `radial-gradient(circle at 22% 26%, ${first} 0%, transparent 55%)`,
    `radial-gradient(circle at 78% 22%, ${second} 0%, transparent 52%)`,
    `radial-gradient(circle at 32% 82%, ${third} 0%, transparent 58%)`,
    `radial-gradient(circle at 84% 76%, ${fourth} 0%, transparent 54%)`,
    `linear-gradient(135deg, ${second} 0%, ${base} 100%)`,
  ].join(", ");
}
