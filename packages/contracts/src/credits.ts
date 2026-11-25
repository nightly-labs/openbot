import { BILLING_CURRENCIES, type BillingCurrency, isStripeCheckoutUrl } from "./billing";
import { isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "./runtime-values";

export type CreditTier = "basic" | "plus" | "max";
export type CreditServerRole = "owner" | "admin" | "member";
export type CreditTransferDirection = "to_server" | "to_personal";

export interface CreditStop {
  index: number;
  eurMinor: number;
  credits: number;
  regularEurMinor: number;
  discount: number;
}

interface CreditPriceStep {
  eurMinor: number;
  eur: number;
  usd: number;
}

export const CREDITS_PER_EUR = 15;

const CREDIT_PRICE_STEPS: readonly CreditPriceStep[] = [
  { eurMinor: 1_000, eur: 167, usd: 145 },
  { eurMinor: 2_000, eur: 350, usd: 305 },
  { eurMinor: 3_000, eur: 540, usd: 470 },
  { eurMinor: 5_000, eur: 940, usd: 820 },
  { eurMinor: 10_000, eur: 2_000, usd: 1_750 },
  { eurMinor: 15_000, eur: 3_100, usd: 2_700 },
  { eurMinor: 20_000, eur: 4_250, usd: 3_700 },
  { eurMinor: 30_000, eur: 6_650, usd: 5_800 },
  { eurMinor: 50_000, eur: 11_750, usd: 10_250 },
  { eurMinor: 75_000, eur: 18_250, usd: 15_750 },
  { eurMinor: 100_000, eur: 25_000, usd: 21_750 },
];

const CREDIT_COLUMN: Readonly<Record<BillingCurrency, "eur" | "usd">> = {
  eur: "eur",
  usd: "usd",
  pln: "eur",
  brl: "eur",
};

function stopsFor(currency: BillingCurrency): readonly CreditStop[] {
  return CREDIT_PRICE_STEPS.map((step, index) => {
    const regularEurMinor = (step.eur * 100) / CREDITS_PER_EUR;
    return {
      index,
      eurMinor: step.eurMinor,
      credits: step[CREDIT_COLUMN[currency]],
      regularEurMinor,
      discount: Math.round((1 - step.eurMinor / regularEurMinor) * 100),
    };
  });
}

const CREDIT_STOPS: Readonly<Record<BillingCurrency, readonly CreditStop[]>> = {
  eur: stopsFor("eur"),
  usd: stopsFor("usd"),
  pln: stopsFor("pln"),
  brl: stopsFor("brl"),
};

export const CREDIT_STOP_COUNT = CREDIT_PRICE_STEPS.length;
export const CREDIT_PACK_INDEXES: readonly number[] = [0, 3, 4, 6, 8, 10];
export const CREDIT_POPULAR_INDEX = 4;
export const CREDIT_TIER_START_INDEX: Readonly<Record<CreditTier, number>> = { basic: 0, plus: 4, max: 8 };

export function creditStops(currency: BillingCurrency): readonly CreditStop[] {
  return CREDIT_STOPS[currency];
}

export function creditStopAt(index: number, currency: BillingCurrency): CreditStop {
  const stops = CREDIT_STOPS[currency];
  const last = stops.length - 1;
  const stop = stops[Math.min(last, Math.max(0, Math.round(index)))];
  if (!stop) throw new Error("No credit stops");
  return stop;
}

export type CreditMediaKind = "video" | "image" | "avatar" | "edit" | "audio";

export const CREDIT_MEDIA_KINDS: readonly CreditMediaKind[] = ["video", "image", "avatar", "edit", "audio"];

export type CreditModelUnit = "image" | "clip";

export type CreditModelMaker =
  | "alibaba"
  | "bfl"
  | "bytedance"
  | "google"
  | "heygen"
  | "ideogram"
  | "kling"
  | "meigen"
  | "meta"
  | "minimax"
  | "mirelo"
  | "openai"
  | "pixverse"
  | "recraft"
  | "sync"
  | "tencent"
  | "topaz"
  | "veed"
  | "vidu"
  | "xai";

export const CREDIT_MODEL_MAKERS: Readonly<Record<CreditModelMaker, string>> = {
  alibaba: "Alibaba",
  bfl: "Black Forest Labs",
  bytedance: "ByteDance",
  google: "Google",
  heygen: "HeyGen",
  ideogram: "Ideogram",
  kling: "Kling",
  meigen: "MeiGen",
  meta: "Meta",
  minimax: "MiniMax",
  mirelo: "Mirelo",
  openai: "OpenAI",
  pixverse: "PixVerse",
  recraft: "Recraft",
  sync: "Sync Labs",
  tencent: "Tencent",
  topaz: "Topaz Labs",
  veed: "VEED",
  vidu: "Vidu",
  xai: "xAI",
};

export interface CreditModelCost {
  modelId: string;
  name: string;
  maker: CreditModelMaker;
  kind: CreditMediaKind;
  unit: CreditModelUnit;
  credits: number;
  variant?: string;
}

export const CREDIT_MODEL_COSTS: readonly CreditModelCost[] = [
  { modelId: "veo-3.1", name: "Veo 3.1", maker: "google", kind: "video", unit: "clip", credits: 65 },
  { modelId: "seedance-2.5", name: "Seedance 2.5", maker: "bytedance", kind: "video", unit: "clip", credits: 39 },
  {
    modelId: "wand-vega-1.5-pro",
    name: "WAND-Vega 1.5 Pro",
    maker: "tencent",
    kind: "video",
    unit: "clip",
    credits: 31,
  },
  { modelId: "kling-4.0", name: "Kling 4.0", maker: "kling", kind: "video", unit: "clip", credits: 26.5 },
  { modelId: "kling-4.0-omni", name: "Kling 4.0 Omni", maker: "kling", kind: "video", unit: "clip", credits: 26.5 },
  { modelId: "seedance-2.0", name: "Seedance 2.0", maker: "bytedance", kind: "video", unit: "clip", credits: 25.5 },
  {
    modelId: "seedance-2.5-flash",
    name: "Seedance 2.5 Flash",
    maker: "bytedance",
    kind: "video",
    unit: "clip",
    credits: 25.5,
  },
  {
    modelId: "grok-imagine-video-1.5",
    name: "Grok Imagine Video 1.5",
    maker: "xai",
    kind: "video",
    unit: "clip",
    credits: 23.5,
  },
  { modelId: "happy-horse-1.0", name: "Happy Horse 1.0", maker: "alibaba", kind: "video", unit: "clip", credits: 23 },
  { modelId: "happy-horse-1.1", name: "Happy Horse 1.1", maker: "alibaba", kind: "video", unit: "clip", credits: 23 },
  { modelId: "wan-3.0-prime", name: "Wan 3.0 Prime", maker: "alibaba", kind: "video", unit: "clip", credits: 23 },
  {
    modelId: "kling-video-v3-pro",
    name: "Kling Video v3 Pro",
    maker: "kling",
    kind: "video",
    unit: "clip",
    credits: 21,
  },
  {
    modelId: "seedance-2.0-fast",
    name: "Seedance 2.0 Fast",
    maker: "bytedance",
    kind: "video",
    unit: "clip",
    credits: 20.5,
  },
  {
    modelId: "wand-vega-1.0-pro",
    name: "WAND-Vega 1.0 Pro",
    maker: "tencent",
    kind: "video",
    unit: "clip",
    credits: 20.5,
  },
  { modelId: "kling-3.0-omni", name: "Kling 3.0 Omni", maker: "kling", kind: "video", unit: "clip", credits: 18 },
  { modelId: "kling-3.0-turbo", name: "Kling 3.0 Turbo", maker: "kling", kind: "video", unit: "clip", credits: 19 },
  {
    modelId: "gemini-omni-flash-1.1",
    name: "Gemini Omni Flash 1.1",
    maker: "google",
    kind: "video",
    unit: "clip",
    credits: 17,
  },
  { modelId: "veo-3.1-fast", name: "Veo 3.1 Fast", maker: "google", kind: "video", unit: "clip", credits: 17 },
  { modelId: "vidu-q3-mix", name: "Vidu Q3 Mix", maker: "vidu", kind: "video", unit: "clip", credits: 17 },
  { modelId: "vidu-q3-pro", name: "Vidu Q3 Pro", maker: "vidu", kind: "video", unit: "clip", credits: 17 },
  { modelId: "wan-3.0", name: "Wan 3.0", maker: "alibaba", kind: "video", unit: "clip", credits: 17 },
  { modelId: "vidu-v4", name: "Vidu v4", maker: "vidu", kind: "video", unit: "clip", credits: 16 },
  { modelId: "vidu-v4-reference", name: "Vidu v4 Reference", maker: "vidu", kind: "video", unit: "clip", credits: 16 },
  {
    modelId: "wand-vega-1.0-pro-fast",
    name: "WAND-Vega 1.0 Pro Fast",
    maker: "tencent",
    kind: "video",
    unit: "clip",
    credits: 17,
  },
  { modelId: "kling-o1-video", name: "Kling O1", maker: "kling", kind: "video", unit: "clip", credits: 14.5 },
  {
    modelId: "minimax-h3",
    name: "MiniMax H3",
    maker: "minimax",
    kind: "video",
    unit: "clip",
    credits: 13,
    variant: "768p",
  },
  {
    modelId: "minimax-h3-max",
    name: "MiniMax H3 Max",
    maker: "minimax",
    kind: "video",
    unit: "clip",
    credits: 13,
    variant: "768p",
  },
  {
    modelId: "seedance-2.0-mini",
    name: "Seedance 2.0 Mini",
    maker: "bytedance",
    kind: "video",
    unit: "clip",
    credits: 13,
  },
  {
    modelId: "gemini-omni-1.2-flash",
    name: "Gemini Omni 1.2 Flash",
    maker: "google",
    kind: "video",
    unit: "clip",
    credits: 12,
  },
  {
    modelId: "wand-vega-1.0-pro-mini",
    name: "WAND-Vega 1.0 Pro Mini",
    maker: "tencent",
    kind: "video",
    unit: "clip",
    credits: 11,
  },
  { modelId: "vidu-q3", name: "Vidu Q3", maker: "vidu", kind: "video", unit: "clip", credits: 10 },
  { modelId: "vidu-q3-turbo", name: "Vidu Q3 Turbo", maker: "vidu", kind: "video", unit: "clip", credits: 10.5 },
  { modelId: "pixverse-c1", name: "PixVerse C1", maker: "pixverse", kind: "video", unit: "clip", credits: 9.5 },
  {
    modelId: "wand-vega-1.0-lite",
    name: "WAND-Vega 1.0 Lite",
    maker: "tencent",
    kind: "video",
    unit: "clip",
    credits: 9.5,
    variant: "768p",
  },
  {
    modelId: "hailuo-h3-regen",
    name: "Hailuo H3 Regen",
    maker: "minimax",
    kind: "video",
    unit: "clip",
    credits: 8.5,
    variant: "2K",
  },
  { modelId: "pixverse-v6", name: "PixVerse V6", maker: "pixverse", kind: "video", unit: "clip", credits: 8.5 },
  { modelId: "veo-3.1-lite", name: "Veo 3.1 Lite", maker: "google", kind: "video", unit: "clip", credits: 8.5 },
  {
    modelId: "hailuo-2.3",
    name: "Hailuo 2.3",
    maker: "minimax",
    kind: "video",
    unit: "clip",
    credits: 7.5,
    variant: "768p",
  },
  { modelId: "mingmou-1", name: "Mingmou 1", maker: "tencent", kind: "video", unit: "clip", credits: 8 },
  { modelId: "kling-2.6", name: "Kling 2.6", maker: "kling", kind: "video", unit: "clip", credits: 7.5 },
  {
    modelId: "hailuo-2.3-fast",
    name: "Hailuo 2.3 Fast",
    maker: "minimax",
    kind: "video",
    unit: "clip",
    credits: 5.5,
    variant: "768p",
  },
  {
    modelId: "heygen-video-1",
    name: "HeyGen Video 1",
    maker: "heygen",
    kind: "video",
    unit: "clip",
    credits: 3,
    variant: "768p",
  },
  { modelId: "gpt-image-2.6", name: "GPT Image 2.6 Flare", maker: "openai", kind: "image", unit: "image", credits: 4 },
  {
    modelId: "gpt-image-2.6-sunburst",
    name: "GPT Image 2.6 Sunburst",
    maker: "openai",
    kind: "image",
    unit: "image",
    credits: 4,
  },
  { modelId: "nano-banana-pro", name: "Nano Banana Pro", maker: "google", kind: "image", unit: "image", credits: 4.5 },
  { modelId: "ideogram-4.5", name: "Ideogram 4.5", maker: "ideogram", kind: "image", unit: "image", credits: 3.5 },
  { modelId: "flux-kontext-max", name: "Flux Kontext Max", maker: "bfl", kind: "image", unit: "image", credits: 3 },
  {
    modelId: "qwen-image-layered",
    name: "Qwen Image Layered",
    maker: "alibaba",
    kind: "image",
    unit: "image",
    credits: 2,
  },
  { modelId: "nano-banana-2.1", name: "Nano Banana 2.1", maker: "google", kind: "image", unit: "image", credits: 1.8 },
  { modelId: "recraft-v4.1", name: "Recraft V4.1", maker: "recraft", kind: "image", unit: "image", credits: 1.5 },
  {
    modelId: "seedream-5.0-lite",
    name: "Seedream 5.0 Lite",
    maker: "bytedance",
    kind: "image",
    unit: "image",
    credits: 1.5,
  },
  {
    modelId: "seedream-5.0-pro",
    name: "Seedream 5.0 Pro",
    maker: "bytedance",
    kind: "image",
    unit: "image",
    credits: 2,
  },
  { modelId: "grok-imagine", name: "Grok Imagine", maker: "xai", kind: "image", unit: "image", credits: 1 },
  { modelId: "kling-image-3.0", name: "Kling Image 3.0", maker: "kling", kind: "image", unit: "image", credits: 1 },
  {
    modelId: "kling-image-3.0-omni",
    name: "Kling Image 3.0 Omni",
    maker: "kling",
    kind: "image",
    unit: "image",
    credits: 1,
  },
  { modelId: "kling-o1-image", name: "Kling O1", maker: "kling", kind: "image", unit: "image", credits: 1 },
  { modelId: "seedream-5.5", name: "Seedream 5.5", maker: "bytedance", kind: "image", unit: "image", credits: 1 },
  {
    modelId: "seedream-5.5-layers",
    name: "Seedream 5.5 Layers",
    maker: "bytedance",
    kind: "image",
    unit: "image",
    credits: 1,
  },
  { modelId: "z-image-turbo", name: "Z-Image Turbo", maker: "alibaba", kind: "image", unit: "image", credits: 0.6 },
  { modelId: "veed-fabric-1.0", name: "VEED Fabric 1.0", maker: "veed", kind: "avatar", unit: "clip", credits: 25 },
  { modelId: "sync-lipsync-3", name: "Sync Lipsync 3", maker: "sync", kind: "avatar", unit: "clip", credits: 22 },
  { modelId: "omnihuman-1.5", name: "OmniHuman 1.5", maker: "bytedance", kind: "avatar", unit: "clip", credits: 20 },
  {
    modelId: "kling-avatar-2.0-pro",
    name: "Kling Avatar 2.0 Pro",
    maker: "kling",
    kind: "avatar",
    unit: "clip",
    credits: 18,
  },
  {
    modelId: "heygen-avatar-6",
    name: "HeyGen Avatar 6",
    maker: "heygen",
    kind: "avatar",
    unit: "clip",
    credits: 17,
    variant: "1080p",
  },
  {
    modelId: "sync-lipsync-2-pro",
    name: "Sync Lipsync 2 Pro",
    maker: "sync",
    kind: "avatar",
    unit: "clip",
    credits: 14,
  },
  { modelId: "omnihuman-2", name: "OmniHuman 2", maker: "bytedance", kind: "avatar", unit: "clip", credits: 12 },
  { modelId: "infinitetalk", name: "InfiniteTalk", maker: "meigen", kind: "avatar", unit: "clip", credits: 10 },
  {
    modelId: "infinitetalk-video",
    name: "InfiniteTalk Video",
    maker: "meigen",
    kind: "avatar",
    unit: "clip",
    credits: 10,
  },
  { modelId: "kling-avatar-2.0", name: "Kling Avatar 2.0", maker: "kling", kind: "avatar", unit: "clip", credits: 9 },
  {
    modelId: "heygen-avatar-6-turbo",
    name: "HeyGen Avatar 6 Turbo",
    maker: "heygen",
    kind: "avatar",
    unit: "clip",
    credits: 8.5,
    variant: "1080p",
  },
  { modelId: "sync-lipsync-2", name: "Sync Lipsync 2", maker: "sync", kind: "avatar", unit: "clip", credits: 8.5 },
  {
    modelId: "pixverse-lipsync",
    name: "PixVerse Lipsync",
    maker: "pixverse",
    kind: "avatar",
    unit: "clip",
    credits: 6.5,
  },
  { modelId: "kling-lipsync", name: "Kling Lipsync", maker: "kling", kind: "avatar", unit: "clip", credits: 2.5 },
  { modelId: "veed-lipsync", name: "VEED Lipsync", maker: "veed", kind: "avatar", unit: "clip", credits: 1.5 },
  { modelId: "latentsync", name: "LatentSync", maker: "bytedance", kind: "avatar", unit: "clip", credits: 1 },
  {
    modelId: "topaz-image-upscale-creative",
    name: "Topaz Image Upscale Creative",
    maker: "topaz",
    kind: "edit",
    unit: "image",
    credits: 10,
  },
  { modelId: "wand", name: "WAND", maker: "tencent", kind: "edit", unit: "clip", credits: 5 },
  {
    modelId: "ideogram-vectorize",
    name: "Ideogram Vectorize",
    maker: "ideogram",
    kind: "edit",
    unit: "image",
    credits: 3.5,
  },
  {
    modelId: "topaz-image-upscale",
    name: "Topaz Image Upscale",
    maker: "topaz",
    kind: "edit",
    unit: "image",
    credits: 3.5,
  },
  {
    modelId: "depth-anything-v3-video",
    name: "Depth Anything V3 Video",
    maker: "bytedance",
    kind: "edit",
    unit: "clip",
    credits: 1,
  },
  { modelId: "topaz-video", name: "Topaz Video", maker: "topaz", kind: "edit", unit: "clip", credits: 1 },
  {
    modelId: "video-depth-anything",
    name: "Video Depth Anything",
    maker: "bytedance",
    kind: "edit",
    unit: "clip",
    credits: 1,
  },
  { modelId: "sam-3", name: "SAM 3", maker: "meta", kind: "edit", unit: "image", credits: 0.5 },
  { modelId: "veed-subtitles", name: "VEED Subtitles", maker: "veed", kind: "edit", unit: "clip", credits: 0.5 },
  { modelId: "veed-dubbing", name: "VEED Dubbing", maker: "veed", kind: "audio", unit: "clip", credits: 18 },
  { modelId: "mirelo-sfx-2.0", name: "Mirelo SFX 2.0", maker: "mirelo", kind: "audio", unit: "clip", credits: 3.5 },
];

export const CREDIT_CLIP_SECONDS = 5;
export const CREDIT_WELCOME = 10;

export const CREDIT_PRICES_URL = "https://openbot.run/credits";

export const CREDIT_MIN_RATE = 0.1;

export function creditUnitRate(credits: number): number {
  return Math.max(CREDIT_MIN_RATE, creditCharge(credits));
}

export function creditModelRate(model: CreditModelCost): number {
  return creditUnitRate(model.unit === "clip" ? model.credits / CREDIT_CLIP_SECONDS : model.credits);
}

export const CREDIT_TENTHS = 10;

export function creditTenths(credits: number): number {
  return Math.round(credits * CREDIT_TENTHS);
}

export function creditsFromTenths(tenths: number): number {
  return tenths / CREDIT_TENTHS;
}

export function creditCharge(credits: number): number {
  return creditsFromTenths(Math.ceil(Math.round(credits * CREDIT_TENTHS * 100) / 100));
}

export function isCreditAmount(value: unknown): value is number {
  if (!isNumber(value) || !Number.isFinite(value) || value < 0) return false;
  const tenths = creditTenths(value);
  return Number.isSafeInteger(tenths) && Math.abs(value * CREDIT_TENTHS - tenths) < 1e-6;
}

export function creditModelCharge(model: CreditModelCost): number {
  const units = model.unit === "clip" ? CREDIT_CLIP_SECONDS : 1;
  return creditCharge(creditModelRate(model) * units);
}

export const CREDIT_ESTIMATE_MODEL_IDS: readonly string[] = ["nano-banana-pro", "seedance-2.5"];

export function creditEstimateModels(): CreditModelCost[] {
  return CREDIT_MODEL_COSTS.filter((model) => CREDIT_ESTIMATE_MODEL_IDS.includes(model.modelId));
}
export const CREDIT_PRODUCT_ID = "openbot_credits";
export const CREDIT_METADATA_KIND = "credits";
export const CREDIT_METADATA = {
  kind: "openbot_kind",
  userId: "openbot_user_id",
  serverId: "openbot_server_id",
  credits: "openbot_credits",
} as const;

const CURRENCY_RATIO: Readonly<Record<BillingCurrency, number>> = { eur: 1, usd: 1, pln: 4.5, brl: 7 };

export function creditStop(credits: number, currency: BillingCurrency): CreditStop | null {
  return CREDIT_STOPS[currency].find((stop) => stop.credits === credits) ?? null;
}

export function creditStopPrice(stop: Pick<CreditStop, "eurMinor">, currency: BillingCurrency): number {
  return Math.round(stop.eurMinor * CURRENCY_RATIO[currency]);
}

export function creditRegularPrice(stop: CreditStop, currency: BillingCurrency): number {
  return creditStopPrice({ eurMinor: stop.regularEurMinor }, currency);
}

export function creditTier(stop: Pick<CreditStop, "index">): CreditTier {
  if (stop.index >= CREDIT_TIER_START_INDEX.max) return "max";
  return stop.index >= CREDIT_TIER_START_INDEX.plus ? "plus" : "basic";
}

export function creditLookupKey(stop: Pick<CreditStop, "eurMinor">): string {
  return `openbot_credits_price_${stop.eurMinor}`;
}

export const CREDIT_LOOKUP_KEYS: readonly string[] = CREDIT_PRICE_STEPS.map(creditLookupKey);

export interface CreditExpiring {
  credits: number;
  expiresAt: number;
}

export interface CreditServerWallet {
  serverId: string;
  name: string;
  role: CreditServerRole;
  balance: number;
  expiring?: CreditExpiring;
}

export interface CreditsState {
  available: boolean;
  currency: BillingCurrency;
  currencies: BillingCurrency[];
  balance: number;
  servers: CreditServerWallet[];
  expiring?: CreditExpiring;
  welcome?: number;
}

export const CREDITS_UNAVAILABLE_STATE: CreditsState = {
  available: false,
  currency: "eur",
  currencies: [],
  balance: 0,
  servers: [],
};

export interface CreditCheckoutRequest {
  credits: number;
  currency: BillingCurrency;
  serverId?: string;
  earlyStart?: true;
}

export interface CreditTransferRequest {
  serverId: string;
  direction: CreditTransferDirection;
  credits: number;
}

export interface CreditRedeemRequest {
  code: string;
  serverId?: string;
}

export interface CreditRedeemResult {
  credits: number;
  state: CreditsState;
}

export const CREDIT_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const CREDIT_CODE_LENGTH = 16;
const CREDIT_CODE_GROUP = 4;
const MAX_CREDIT_CODE_INPUT = 64;

export function normalizeCreditCode(value: string): string {
  return value.toUpperCase().replace(/[^0-9A-Z]/gu, "");
}

export function isCreditCode(value: string): boolean {
  return (
    value.length === CREDIT_CODE_LENGTH && [...value].every((character) => CREDIT_CODE_ALPHABET.includes(character))
  );
}

export function formatCreditCode(value: string): string {
  const code = normalizeCreditCode(value).slice(0, CREDIT_CODE_LENGTH);
  const groups: string[] = [];
  for (let start = 0; start < code.length; start += CREDIT_CODE_GROUP)
    groups.push(code.slice(start, start + CREDIT_CODE_GROUP));
  return groups.join("-");
}

export const CREDIT_CODE_INPUT_LENGTH = CREDIT_CODE_LENGTH + CREDIT_CODE_LENGTH / CREDIT_CODE_GROUP - 1;

const CREDIT_SERVER_ROLES: readonly CreditServerRole[] = ["owner", "admin", "member"];
const CREDIT_TRANSFER_DIRECTIONS: readonly CreditTransferDirection[] = ["to_server", "to_personal"];
const MAX_TRANSFER_CREDITS = 10_000_000;
const MIN_TRANSFER_CREDITS = 1 / CREDIT_TENTHS;
const MAX_SERVER_ID_LENGTH = 128;

function isTimestamp(value: unknown): value is number {
  return isNumber(value) && Number.isSafeInteger(value) && value >= 0;
}

function isServerId(value: unknown): value is string {
  return isString(value) && value.length > 0 && value.length <= MAX_SERVER_ID_LENGTH;
}

function parseExpiring(value: unknown): CreditExpiring | null {
  if (!isDynamicRecord(value) || !isCreditAmount(value.credits) || value.credits === 0 || !isTimestamp(value.expiresAt))
    return null;
  return { credits: value.credits, expiresAt: value.expiresAt };
}

function parseServerWallet(value: unknown): CreditServerWallet | null {
  if (
    !isDynamicRecord(value) ||
    !isServerId(value.serverId) ||
    !isString(value.name) ||
    !isOneOf(CREDIT_SERVER_ROLES, value.role) ||
    !isCreditAmount(value.balance)
  )
    return null;
  const wallet: CreditServerWallet = {
    serverId: value.serverId,
    name: value.name,
    role: value.role,
    balance: value.balance,
  };
  const expiring = parseExpiring(value.expiring);
  if (expiring) wallet.expiring = expiring;
  return wallet;
}

export function parseCreditsState(value: unknown): CreditsState | null {
  if (
    !isDynamicRecord(value) ||
    !isBoolean(value.available) ||
    !isOneOf(BILLING_CURRENCIES, value.currency) ||
    !isCreditAmount(value.balance) ||
    !Array.isArray(value.servers) ||
    !Array.isArray(value.currencies)
  )
    return null;
  const servers: CreditServerWallet[] = [];
  for (const item of value.servers) {
    const wallet = parseServerWallet(item);
    if (wallet) servers.push(wallet);
  }
  const offered: unknown[] = value.currencies;
  const currencies = BILLING_CURRENCIES.filter((currency) => offered.includes(currency));
  if (value.available && !currencies.includes(value.currency)) return null;
  const state: CreditsState = {
    available: value.available,
    currency: value.currency,
    currencies,
    balance: value.balance,
    servers,
  };
  const expiring = parseExpiring(value.expiring);
  if (expiring) state.expiring = expiring;
  if (isCreditAmount(value.welcome) && value.welcome > 0) state.welcome = Math.min(value.welcome, value.balance);
  return state;
}

export function parseCreditCheckoutRequest(value: unknown): CreditCheckoutRequest | null {
  if (!isDynamicRecord(value) || !isOneOf(BILLING_CURRENCIES, value.currency)) return null;
  if (!isNumber(value.credits) || !creditStop(value.credits, value.currency)) return null;
  const request: CreditCheckoutRequest = { credits: value.credits, currency: value.currency };
  if (value.serverId !== undefined) {
    if (!isServerId(value.serverId)) return null;
    request.serverId = value.serverId;
  }
  if (value.earlyStart === true) request.earlyStart = true;
  return request;
}

export function parseCreditTransferRequest(value: unknown): CreditTransferRequest | null {
  if (
    !isDynamicRecord(value) ||
    !isServerId(value.serverId) ||
    !isOneOf(CREDIT_TRANSFER_DIRECTIONS, value.direction) ||
    !isCreditAmount(value.credits) ||
    value.credits < MIN_TRANSFER_CREDITS ||
    value.credits > MAX_TRANSFER_CREDITS
  )
    return null;
  return { serverId: value.serverId, direction: value.direction, credits: value.credits };
}

export function parseCreditRedeemRequest(value: unknown): CreditRedeemRequest | null {
  if (!isDynamicRecord(value) || !isString(value.code) || value.code.length > MAX_CREDIT_CODE_INPUT) return null;
  const request: CreditRedeemRequest = { code: value.code };
  if (value.serverId !== undefined) {
    if (!isServerId(value.serverId)) return null;
    request.serverId = value.serverId;
  }
  return request;
}

export function parseCreditRedeemResult(value: unknown): CreditRedeemResult | null {
  if (!isDynamicRecord(value) || !isCreditAmount(value.credits) || value.credits <= 0) return null;
  const state = parseCreditsState(value.state);
  return state ? { credits: value.credits, state } : null;
}

export function parseCreditCheckoutUrl(value: unknown): string | null {
  return isDynamicRecord(value) && isStripeCheckoutUrl(value.url) ? value.url : null;
}

export type CreditActivityKind = "generation" | "purchase" | "move" | "free" | "expired" | "refund";
export type CreditActivityStatus = "running" | "failed" | "canceled";
export type CreditActivityActor = "you" | "member" | "openbot";

export interface CreditActivityEntry {
  id: string;
  kind: CreditActivityKind;
  at: number;
  credits: number;
  actor: CreditActivityActor;
  actorName?: string;
  serverId?: string;
  otherServerId?: string;
  modelName?: string;
  maker?: string;
  status?: CreditActivityStatus;
}

export interface CreditActivity {
  entries: CreditActivityEntry[];
}

export const CREDIT_ACTIVITY_LIMIT = 50;
export const EMPTY_CREDIT_ACTIVITY: CreditActivity = { entries: [] };

const CREDIT_ACTIVITY_KINDS: readonly CreditActivityKind[] = [
  "generation",
  "purchase",
  "move",
  "free",
  "expired",
  "refund",
];
const CREDIT_ACTIVITY_STATUSES: readonly CreditActivityStatus[] = ["running", "failed", "canceled"];
const CREDIT_ACTIVITY_ACTORS: readonly CreditActivityActor[] = ["you", "member", "openbot"];
const MAX_ACTIVITY_TEXT_LENGTH = 200;

function isActivityText(value: unknown): value is string {
  return isString(value) && value.length > 0 && value.length <= MAX_ACTIVITY_TEXT_LENGTH;
}

function parseActivityEntry(value: unknown): CreditActivityEntry | null {
  if (
    !isDynamicRecord(value) ||
    !isActivityText(value.id) ||
    !isOneOf(CREDIT_ACTIVITY_KINDS, value.kind) ||
    !isTimestamp(value.at) ||
    !isNumber(value.credits) ||
    !Number.isFinite(value.credits) ||
    !isOneOf(CREDIT_ACTIVITY_ACTORS, value.actor)
  )
    return null;
  const entry: CreditActivityEntry = {
    id: value.id,
    kind: value.kind,
    at: value.at,
    credits: value.credits,
    actor: value.actor,
  };
  if (isActivityText(value.actorName)) entry.actorName = value.actorName;
  if (isServerId(value.serverId)) entry.serverId = value.serverId;
  if (isServerId(value.otherServerId)) entry.otherServerId = value.otherServerId;
  if (isActivityText(value.modelName)) entry.modelName = value.modelName;
  if (isActivityText(value.maker)) entry.maker = value.maker;
  if (isOneOf(CREDIT_ACTIVITY_STATUSES, value.status)) entry.status = value.status;
  return entry;
}

export function parseCreditActivity(value: unknown): CreditActivity | null {
  if (!isDynamicRecord(value) || !Array.isArray(value.entries)) return null;
  const entries: CreditActivityEntry[] = [];
  for (const item of value.entries.slice(0, CREDIT_ACTIVITY_LIMIT)) {
    const entry = parseActivityEntry(item);
    if (entry) entries.push(entry);
  }
  return { entries };
}
