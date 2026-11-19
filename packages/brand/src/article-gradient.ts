const LOGO_PRODUCTION = "#d6adf2";
const LOGO_DEV = "#ff9412";
const LOGO_PREVIEW = "#31cf76";
const ACCENT = "#007cf7";
const UNREAD = "#74b9ff";
const INDIGO = "#6f7de8";
const CYAN = "#6bc7d9";
const TERRACOTTA = "#d97757";
const CORAL = "#ff6069";
const MAGENTA = "#ff1e5e";
const DIM = "#6a6a6a";
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

const VIOLET_DEEP = "#7b3fa8";
const RED_DEEP = "#f2564a";
const GREEN_DEEP = "#1d7a5a";
const BLUE_DEEP = "#0a3f7d";
const PLUM_DEEP = "#a83f7b";
const SILVER = "#c8c8c8";

const FAMILIES = [
  [LOGO_PRODUCTION, VIOLET_DEEP, INDIGO, ACCENT, CANVAS],
  [LOGO_DEV, RED_DEEP, CORAL, TERRACOTTA, CANVAS],
  [LOGO_PREVIEW, GREEN_DEEP, CYAN, ACCENT, CANVAS],
  [ACCENT, BLUE_DEEP, UNREAD, INDIGO, CANVAS],
  [LOGO_DEV, LOGO_PRODUCTION, PLUM_DEEP, MAGENTA, CANVAS],
  [SILVER, DIM, LOGO_PRODUCTION, UNREAD, CANVAS],
  [TERRACOTTA, LOGO_DEV, PLUM_DEEP, VIOLET_DEEP, CANVAS],
  [CYAN, ACCENT, LOGO_PREVIEW, UNREAD, CANVAS],
  [MAGENTA, PLUM_DEEP, LOGO_PRODUCTION, VIOLET_DEEP, CANVAS],
  [INDIGO, VIOLET_DEEP, UNREAD, LOGO_PRODUCTION, CANVAS],
  [CORAL, MAGENTA, INDIGO, LOGO_PRODUCTION, CANVAS],
  [GREEN_DEEP, LOGO_PREVIEW, CYAN, BLUE_DEEP, CANVAS],
] as const;

export interface ArticleGradient {
  colors: readonly string[];
  distortion: number;
  swirl: number;
  grainMixer: number;
  rotation: number;
  frame: number;
}

function hashTitle(title: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < title.length; index += 1) {
    hash ^= title.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

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

export function articleGradientCss(gradient: ArticleGradient): string {
  const [first, second, third, fourth] = gradient.colors;
  const base = gradient.colors[gradient.colors.length - 1];
  return [
    `radial-gradient(circle at 22% 26%, ${first} 0%, transparent 55%)`,
    `radial-gradient(circle at 78% 22%, ${second} 0%, transparent 52%)`,
    `radial-gradient(circle at 32% 82%, ${third} 0%, transparent 58%)`,
    `radial-gradient(circle at 84% 76%, ${fourth} 0%, transparent 54%)`,
    `linear-gradient(135deg, ${second} 0%, ${base} 100%)`,
  ].join(", ");
}
